# 객체 저장소 수명주기와 파기

상태: 코드/정책안. 실제 S3 버킷·IAM·Lifecycle·복제 설정은 변경하지 않았다.

## 목적별 영역

| 영역 | 권장 버킷 | 주체 | 접근 | 파기 |
| --- | --- | --- | --- | --- |
| 운영 미디어 | `mungsil-media-*` | 사용자 | API media role만 쓰기/삭제, 승인된 서명/프록시 읽기 | 원본·full·thumb·모든 version/delete marker |
| 백업 | `mungsil-backup-*` | 서비스 전체 | backup writer, restore operator만 | 승인 기간 만료, 복원 후 삭제 재적용 |
| 제한 보존 | `mungsil-legal-hold-*` | 사건 대상 | 사건별 승인 역할 | 만료/재검토일 도달 후 파기 |
| 분석 결과 | restricted/release 분리 | 집단/가명 | ingest/reader/release 역할 분리 | 목적 종료·보유정책에 따름 |

동일 버킷 prefix를 쓰려면 별도 버킷과 동등한 IAM deny, KMS key policy, inventory, lifecycle, replication 통제를 증명해야 한다. 현재 `infra/backup-to-s3.sh`가 운영 media 버킷의 `backups/database/`를 쓸 수 있으므로 실제 적용 전 별도 backup 버킷/role로 변경해야 한다.

## 필수 통제

- Block Public Access 전체 활성화, ACL 사용 금지, TLS 강제, 서버 측 암호화(SSE-S3 또는 승인된 KMS), 최소 IAM.
- 앱 role은 backup/restricted/legal-hold prefix의 List/Get/Delete를 거부한다. backup role은 media 읽기를 거부한다.
- bucket/key/version 조회와 관리 변경은 감사하되 서명 URL, 원본명, 사용자 원문을 로그에 남기지 않는다.
- 리전, 복제 리전, 수탁자와 국외 이전 여부는 법률/계약 검토 목록이다.
- Object Lock은 기본 OFF다. 증거별 근거·기간 승인이 없는 media/전체 backup 잠금은 파기 의무와 충돌할 수 있다.

## 애플리케이션 구현

MediaService는 변환 결과를 `private, no-store`로 저장하고 읽기 URL 기본 수명을 300초(허용 60~900초)로 제한한다. 변환 후 업로드 원본 삭제가 실패하면 governance.ObjectDeletionTask에 media/user/bucket/key와 최소 오류 상태를 남긴다. cron은 `FOR UPDATE SKIP LOCKED`로 작업을 가져와 지수 backoff로 재시도한다.

삭제는 다음을 확인한다.

1. ListObjectVersions로 정확히 같은 key의 Versions와 DeleteMarkers를 페이지 전체에서 찾는다.
2. 최대 1,000개 단위 DeleteObjects로 versionId를 명시해 삭제한다.
3. unversioned 현재 객체에도 DeleteObject를 실행한다.
4. ListObjectVersions 결과가 비고 HeadObject가 404/NoSuchKey인지 확인한다.
5. 403, version lock, 삭제 error, 페이지 상한 초과는 완료가 아니라 실패다.

Lifecycle은 `uploads/` 미완료 임시 객체와 만료 자료 누락 정리의 보조 수단이다. Lifecycle 설정 또는 DeleteMarker 생성만으로 실제 파기 완료라고 기록하지 않는다.

게시물 또는 원본 TODO/루틴 삭제는 먼저 Post snapshot을 비우고 신규 서명 URL 발급을 차단한 다음 `POST_SNAPSHOT_ERASURE` 객체 삭제 task를 만든다. 원본 공개 범위 축소는 객체를 즉시 파기하지 않지만 게시물 조회 자체를 차단하므로 새 이미지 URL을 발급하지 않는다. 이미 발급된 URL의 최대 잔여 시간은 5분이다.

## 계정 파기

계정 파기 전에 subjectUserId에 연결된 pending ObjectDeletionTask와 Media의 objectKey/thumbnailKey를 모두 삭제·검증한다. 하나라도 실패하면 User/Media DB 행을 유지해 다음 재시도가 대상을 잃지 않게 한다. 모두 성공한 뒤 User 삭제와 ErasureRequest 완료를 transaction으로 처리한다.

이미 이용자가 내려받은 사본, 외부 브라우저 cache, 제3자 캡처는 서버가 회수했다고 주장하지 않는다. 서비스 워커는 v2부터 navigation, 인증 URL, API, 임의 이미지를 cache하지 않고 정적 allowlist만 cache하며 활성화 때 과거 shell cache를 삭제한다.

## 검증 행렬

| 경우 | MinIO 합성 | AWS 격리 | 성공 조건 |
| --- | --- | --- | --- |
| versioning OFF | 필수 | 필수 | LIST 없음 + HEAD 404 |
| versioning ON, 과거 version | 가능 범위 | 필수 | 모든 version/marker 없음 |
| full/thumb/source | 필수 | 필수 | 세 key 모두 없음 |
| DeleteObject/List 권한 거부 | 필수 | 필수 | task FAILED/pending, DB 추적 유지 |
| Object Lock | MinIO 한계 명시 | 필수 | 승인 예외 또는 미완료, 성공 오표시 금지 |
| replication 잔존 | 별도 target | 필수 | 대상 리전 inventory까지 확인 |
| multipart upload | 가능 범위 | 필수 | 미완료 upload abort/lifecycle 확인 |

현재 로컬 Docker Linux 엔진이 꺼져 있어 실제 MinIO 검증은 미실행이다. AWS 고유 versioning/Object Lock/replication 검증은 별도 인프라 승인 전 실행하지 않는다.
