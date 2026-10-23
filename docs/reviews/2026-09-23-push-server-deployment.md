# Android 푸시 서버 배포 — 2026-09-23

사용자의 3번 서버 작업 실행 요청에 따라 운영 서버에 접속해 DB migration과 API 배포를 완료했다. 최초 배포는 인증 파일 대기로 `PUSH_ENABLED=false`였으며, 이후 사용자가 제공한 서비스 계정 파일을 연결해 발송을 활성화했다. 최종 상태는 아래 후속 기록을 따른다. 클라이언트 AAB를 다시 만들거나 Play Console에 업로드하지 않았다.

## 실제 반영

- 대상: `mungsil.kro.kr`의 EC2 `3.27.27.110`, Compose 프로젝트 `mungsil`.
- 기존 소스/이미지 기준: `82d1361`, API `sha256:1d34fcacdeabc9d9f4b829d1352ac7fa4340f971fe7f9707d098cb563efcda5d`.
- 배포 manifest SHA-256: `6F2FD299734F2F50571260E888BE2F44D03D381BD331671E3481AE9F89C74563`.
- 새 API 이미지: `mungsil-api:push-6f2fd299734f`, ID `sha256:33e375c0f3a04d28d818d549bb71d6f2faf3732d78c2af3867e48968da761245`.
- 서버와 로컬의 package-lock 체크섬이 같음을 확인했다. 디스크 여유 약 1.6GB를 고려해 기존 API 이미지의 의존성을 재사용하고 로컬 Nest 컴파일 산출물과 Prisma schema/migrations를 추가했다. Prisma Client는 Linux 이미지 안에서 다시 생성했다. 이번 빌드는 Dockerfile 전체의 클린 빌드와 구분한다.
- 신규 `20260923020000_android_push_devices` migration 적용 및 재실행 통과. 적용 migration은 14개에서 15개가 됐다.
- `PushDevice` 생성 migration에 runtime DML/backup SELECT 권한을 명시했다. 운영 기본 정책상 새 테이블에 runtime 권한이 자동 부여되지 않는 누락을 배포 전에 발견했다. 5초 lock timeout과 120초 statement timeout, transaction을 적용했다. 권한 초기화 SQL도 새 테이블이 존재할 때 명시적으로 재부여한다.
- Firebase 프로젝트 `mungsill`, 발송 비활성화. 기존 Google 웹 OAuth ID와 활성화 상태는 유지됐다.

## 백업과 검증

- API lint 통과. API 테스트는 첫 실행에서 sandbox Prisma 다운로드가 거부됐고 허용된 네트워크 재실행에서 115건 중 111 통과/조건부 4 skip.
- Linux 새 이미지에서 푸시 동작 테스트 8/8 통과(FCM/DB 대역).
- 전용 내부 Docker 네트워크와 tmpfs PostgreSQL에서 이전 14개 migration → 신규 migration → 재실행 검증 통과. runtime DML 허용/TRUNCATE 거부, backup 읽기 허용/쓰기 거부 확인 후 전용 컨테이너·네트워크 제거.
- 운영 migration 전 기존 14개 checksum 일치와 신규 migration 하나만 pending임을 확인.
- 전용 backup LOGIN으로 custom dump 생성: 202,513 bytes. 기존 운영 S3 버킷의 `backups/database/mungsil-pre-push-20260923-083158.dump`에 AES256 암호화로 저장했다. 로컬 서버 덤프와 체크섬은 권한 0600인 배포 기록 디렉터리에 보관했다.
- 운영과 연결되지 않은 임시 PostgreSQL에 백업 전체 복원(`--no-owner --no-privileges --exit-on-error`) 및 14개 migration 확인. 최초 시도는 초기화 임시 서버 종료 시점에 연결해 실패했다. TCP 준비 확인으로 수정한 재실행은 통과했다. 실패 로그를 보존하고 임시 컨테이너는 제거했다. 복원 데이터 내용을 출력하거나 로컬 PC로 가져오지 않았다.
- 새 API healthy, 외부 `/api/v1/ready`의 DB/Redis/storage 모두 true, 웹 HTTP 200. 푸시 설정 API의 비인증 요청은 401.
- 실제 runtime LOGIN에서 `PushDevice` 읽기 가능 및 DML 권한, TRUNCATE·migration history 접근 거부 확인. backup SELECT만 허용.
- API 컨테이너만 교체됐다. web/PostgreSQL/Redis/Caddy 컨테이너 ID는 동일하다.

## 유지·롤백

서버 배포 기록: `/srv/mungsil/deploy-records/push-6f2fd299734f`.
정확한 소스/컴파일 산출물과 이미지 빌드 기록: `/srv/mungsil/releases/push-6f2fd299734f`.

현재 API를 재생성할 때는 다음 세 Compose 파일을 함께 사용한다.

```sh
docker compose --env-file /srv/mungsil/.env \
  -f /srv/mungsil/app/infra/docker-compose.yml \
  -f /srv/mungsil/deploy-82d1361.override.yml \
  -f /srv/mungsil/deploy-push-6f2fd299734f.override.yml \
  up -d --no-deps --no-build --wait --wait-timeout 180 api
```

앱 롤백은 위 명령에서 마지막 push override를 빼고 기존 API 이미지를 사용한다. 새 스키마는 이전 API와 호환되는 추가 변경이므로 자동 삭제하거나 운영 DB를 복원하지 않는다. 이전 이미지와 백업은 유지했다.

## 남은 작업

1. Firebase 프로젝트 `mungsill`에서 HTTP v1 발송 권한을 가진 인증 파일 또는 ADC 연결을 준비한다. 키는 채팅·저장소·이미지에 넣지 않고 서버 secrets 경로에 둔다.
2. API의 비root 사용자에게 필요한 읽기 권한만 부여해 파일을 마운트한다. 인증·FCM API 권한을 확인한 뒤 현재 배포 override에 마운트와 `PUSH_ENABLED=true`를 반영한다. 향후 배포에서도 해당 override를 유지한다.
3. Play 설치 앱에서 로그인·기기 등록·두 계정 푸시 수신과 로그아웃/계정 변경을 확인한다. 이 작업에서는 실제 FCM 요청이나 사용자 푸시를 보내지 않았다.

서비스 계정 파일 경로를 요청했으며 이 기록 시점에는 응답이 없었다. 실제 발송 활성화 완료로 표시하지 않는다.

## 후속: Firebase 인증 연결·발송 활성화 완료

- 활성화 시각: 2026-09-23 11:30:14 UTC (한국 시간 20:30:14).
- 사용자가 제공한 서비스 계정 JSON의 유형과 프로젝트 `mungsill`, Google OAuth 토큰 발급 URL을 확인했다. 비공개 키 내용과 access token을 출력하지 않았다.
- 서버 저장 경로: `/srv/mungsil/secrets/firebase-service-account.json`, 소유 UID/GID 1000:1000, 권한 0600. 앱 소스·Git·이미지에 복사하지 않았다.
- 기존 운영 push override에 API 전용 secret과 `GOOGLE_APPLICATION_CREDENTIALS=/run/secrets/firebase_service_account`, `PUSH_ENABLED=true`를 반영했다. 컨테이너 안의 Firebase/DB secret은 모두 읽기 전용 마운트임을 확인했다. 향후 API 재생성에도 위 세 Compose 파일을 모두 사용한다.
- API 교체 전 독립 컨테이너와 교체 후 실제 운영 API에서 FCM HTTP v1 `validate_only=true` 요청이 각각 HTTP 200으로 통과했다. 검증용 topic과 합성 data만 사용했고 실제 알림은 전달하지 않았다. 이는 [FCM 검증 전용 요청](https://firebase.google.com/docs/reference/fcm/rest/v1/projects.messages/send)이며 휴대폰 전달 검증을 대신하지 않는다.
- 운영 `PushService.enabled()`가 true, 프로젝트 ID 일치, 인증 파일 읽기 가능, runtime DB 역할 정상임을 확인했다. 점검 시 등록된 푸시 기기는 0대였다.
- API healthy, `/api/v1/ready`의 DB/Redis/storage 정상, 웹 HTTP 200. API만 재생성됐고 나머지 컨테이너 ID는 동일하다. 코드·이미지·DB migration은 이번 인증 연결에서 추가로 변경하지 않았다.
- 활성화 직전 override는 배포 기록의 `pre-fcm.override.yml`에 보관했다. 발송만 중단하려면 현재 override의 `PUSH_ENABLED`를 false로 바꾸고 같은 세 Compose 파일로 API만 재생성한다. 이미지 전체 롤백은 위 기존 절차를 따른다.
- 남은 검증: Play 설치 앱에서 로그인 후 `새 소식 알림 받기`를 켜고 OS 권한을 허용해 기기를 등록한다. 다른 테스트 계정의 응원·댓글·메시지 수신, 앱 전경/배경, 로그아웃·계정 변경 후 차단을 실제 휴대폰에서 확인한다.
