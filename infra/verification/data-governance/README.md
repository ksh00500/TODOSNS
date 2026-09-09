# 격리 데이터 거버넌스 검증

이 디렉터리는 운영 Compose, 운영 DB, 운영 S3를 사용하지 않고 PostgreSQL 17과 S3 호환 저장소에서 migration·trigger·capability role·객체 완전 삭제를 검증한다. 기본 Compose 프로젝트 이름은 `mungsil-dg-verify-20260909`이며 호스트 포트를 공개하지 않는다.

## 실행 전 경계 확인

- 운영 호스트 `/srv/mungsil`, Compose 프로젝트 `mungsil`, `mungsil_*` 볼륨·네트워크에서 실행하지 않는다.
- 권장 대상은 별도 임시 EC2 `mungsil-dg-verify-20260909`다. 운영 `t3.micro`에는 자원 부족 때문에 실행하지 않는다.
- 작업 디렉터리에 저장소 코드만 전송한다. `.env`, `.git`, 개인키, 운영 로그와 backup은 전송하지 않는다.
- 검증 EC2의 instance role에는 운영 버킷 권한을 부여하지 않는다.
- `ANALYTICS_COLLECTION_ENABLED=false`, `ANALYTICS_EXPORT_ENABLED=false`를 변경하지 않는다.

## 합성 검증 실행

`.env.example`을 별도 검증 EC2의 `.env.verify`로 복사하고 세 개의 합성 전용 비밀값만 난수로 교체한다. 비밀값은 터미널·로그·문서에 출력하지 않는다.

```sh
set -a
. ./.env.verify
set +a
bash infra/verification/data-governance/run.sh
```

`run.sh`는 다음 순서로 동작한다.

1. 전용 PostgreSQL과 MinIO를 시작한다.
2. 빈 DB에 전체 migration과 capability role 검증을 적용한다.
3. 마지막 두 migration 전 상태의 DB에 합성 계정·TODO·목록·게시·태그를 넣는다.
4. data-governance와 snapshot migration 및 legacy backfill을 적용한다.
5. shadow 동기화, cascade, 공개 범위 축소, 삭제 snapshot scrub, 역할 거부를 확인한다.
6. MinIO의 unversioned/versioned 버킷에서 실제 SDK 경로로 버전·delete marker·파생 객체를 삭제한다.
7. 로그를 `artifacts/`에 저장한 뒤 전용 컨테이너·네트워크·볼륨만 제거한다.

## AWS S3 추가 검증

전용 테스트 버킷을 연결할 때만 `.env.verify`에 `VERIFY_AWS_S3_BUCKET`을 설정한다. 버킷은 Public Access Block, SSE-S3, versioning을 활성화한다. EC2 role에는 아래 작업만 테스트 버킷 ARN에 한정해 허용한다.

- 버킷: `s3:ListBucket`, `s3:ListBucketVersions`, `s3:GetBucketVersioning`
- 객체: `s3:PutObject`, `s3:GetObject`, `s3:GetObjectVersion`, `s3:DeleteObject`, `s3:DeleteObjectVersion`

운영 버킷 ARN, `s3:*`, IAM 변경 권한은 넣지 않는다. 컨테이너가 instance role의 IMDSv2 임시 자격 증명을 받도록 테스트 EC2 metadata hop limit은 2로 제한한다. 장기 Access Key는 생성하거나 주입하지 않는다.

## 정리 경계

자동 정리는 Docker 프로젝트 `mungsil-dg-verify-20260909`의 리소스만 대상으로 한다. AWS 테스트 버킷과 임시 EC2 정리는 실행 결과를 회수한 다음 ARN과 instance ID를 다시 확인해 수행한다. 운영 migration, 실제 데이터 파기, 운영 배포는 이 절차에 포함되지 않는다.
