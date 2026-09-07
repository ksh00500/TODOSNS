# 뭉실 베타 배포

## 학교 서버 스테이징 — 외부 포트 1개

1. `.env.example`을 `.env`로 복사하고 `PUBLIC_HOST`, `PUBLIC_PORT`, DB·JWT·MinIO·SMTP·시드 비밀값을 채웁니다. 8004를 할당받았다면 `PUBLIC_PORT=8004`로 지정합니다.
2. 서버에서 `npm ci && npm run db:generate`를 실행합니다.
3. `npm run compose:staging:up`으로 웹, API, PostgreSQL, Redis, MinIO를 시작합니다.
4. `http://PUBLIC_HOST:PUBLIC_PORT/api/v1/health`와 `/api/v1/ready`가 각각 200인지 확인합니다.
5. `docker compose --env-file .env -f infra/docker-compose.staging.yml exec api node apps/api/prisma/seed.cjs`로 운영자·데모 계정과 초대 코드를 생성합니다. 값은 `.env`의 `SEED_ADMIN_PASSWORD`, `SEED_DEMO_PASSWORD`, `SEED_INVITE_CODE`를 사용합니다. 데모 사용자와 예시 콘텐츠는 `SEED_DEMO_DATA=true`일 때만 생성합니다.

스테이징 Caddy는 같은 포트에서 웹, `/api`, `/mungsil-media`를 경로로 나눕니다. PostgreSQL·Redis·MinIO 관리 포트는 호스트에 공개하지 않습니다. HTTP 환경에서는 로그인 쿠키를 위해 `COOKIE_SECURE=false`를 사용하지만, PWA 설치와 운영 전환에는 도메인과 HTTPS를 적용하고 `COOKIE_SECURE=true`로 바꿔야 합니다.

## 도메인 운영 배포

1. `APP_DOMAIN`의 DNS를 서버의 Elastic IP로 연결하고 80/443을 엽니다.
2. 비공개 S3 버킷을 만들고 CORS에 `https://APP_DOMAIN`을 허용합니다. EC2에는 해당 버킷만 읽고 쓸 수 있는 IAM Role을 연결합니다.
3. `.env`의 `STORAGE_BUCKET`, `STORAGE_REGION`, SMTP와 모든 비밀값을 채웁니다. AWS S3에서는 `STORAGE_ENDPOINT`와 장기 Access Key를 설정하지 않습니다.
4. `npm run compose:up`을 실행합니다. 운영 Compose는 MinIO를 실행하지 않고 EC2 IAM Role의 임시 자격 증명으로 S3를 사용합니다.
5. API 컨테이너가 시작할 때 Prisma 마이그레이션을 먼저 적용하며, 실패하면 API가 열리지 않습니다.
6. `https://APP_DOMAIN/api/v1/ready`가 200인지 확인한 뒤 초대 코드를 배포합니다.

운영에서는 `SEED_DEMO_DATA=false`, `NEXT_PUBLIC_ENABLE_DEMO=false`를 유지합니다. 베타 검증 뒤 시드 데모 데이터를 제거할 때는 먼저 DB 백업을 만든 다음 아래의 범위가 제한된 스크립트를 한 번 실행합니다. 운영자 계정과 초대 코드는 보존됩니다.

### Google 로그인 활성화

1. Google Auth Platform의 브랜딩에서 앱 이름, 지원 이메일, 승인된 도메인 `mungsil.kro.kr`, 홈페이지 `https://mungsil.kro.kr`, 개인정보 처리방침 `https://mungsil.kro.kr/privacy`, 이용약관 `https://mungsil.kro.kr/terms`를 설정합니다.
2. 데이터 액세스는 로그인 기본 범위인 `openid`, `email`, `profile`만 사용합니다. 민감한 추가 범위는 요청하지 않습니다.
3. 클라이언트에서 애플리케이션 유형 `웹 애플리케이션`을 만들고 승인된 JavaScript 원본에 `https://mungsil.kro.kr`을 추가합니다. 로컬 검증이 필요하면 `http://localhost:3000`도 추가합니다. 현재 구현은 JavaScript 콜백 방식이므로 승인된 리디렉션 URI와 Client Secret은 필요하지 않습니다.
4. 발급된 공개 Client ID만 운영 `.env`의 `GOOGLE_CLIENT_ID`에 넣고 `GOOGLE_AUTH_ENABLED=true`로 바꿉니다. Client Secret이나 Google 사용자 토큰은 `.env`, Git, 채팅에 저장하지 않습니다.
5. API를 재시작한 뒤 `/api/v1/auth/config`에서 `googleAuthEnabled`가 `true`인지 확인합니다. `/start`에서 기존 Google 사용자의 즉시 로그인, 신규 사용자의 아이디·생년월일·초대 코드 보완 가입, 같은 이메일의 비밀번호 계정 충돌을 각각 확인합니다.

Android 앱은 웹을 신뢰해 실행하는 TWA이므로 같은 웹 Client ID를 사용합니다. 별도 Android OAuth Client ID는 이 로그인 방식에 필요하지 않습니다.

```sh
sh infra/remove-seed-demo-data.sh infra/docker-compose.yml /srv/mungsil/.env
```

## 백업과 복원 점검

매일 별도 디스크에 다음을 예약 실행합니다.

```sh
sh infra/backup.sh /absolute/backup/path infra/docker-compose.staging.yml
```

스테이징에서는 DB와 MinIO 파일을 함께 저장합니다. AWS 운영에서는 로컬 MinIO가 없으므로 IAM Role로 DB 덤프를 S3에 직접 전송합니다.

```sh
sh infra/backup-to-s3.sh "$STORAGE_BUCKET" infra/docker-compose.yml
```

EC2에서는 저장소의 systemd 유닛을 설치하면 매일 03:30 UTC(한국 시간 12:30)에 최대 10분의 무작위 지연을 두고 실행됩니다. 덤프는 로컬 파일을 만들지 않고 `backups/database/` 접두사로 바로 전송됩니다.

```sh
sudo install -m 0644 infra/systemd/mungsil-backup.service /etc/systemd/system/
sudo install -m 0644 infra/systemd/mungsil-backup.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now mungsil-backup.timer
systemctl list-timers mungsil-backup.timer
```

S3 수명 주기 만료는 운영자가 보존 기간을 결정한 뒤 `backups/database/` 접두사에만 별도로 적용합니다.

최소 주 1회 최근 DB 백업을 임시 데이터베이스에 복원해 확인합니다.

```sh
sh infra/restore-check.sh /absolute/backup/path/mungsil-YYYYMMDD-HHMMSS.sql.gz infra/docker-compose.staging.yml
```

장애 시에는 먼저 쓰기 트래픽을 막고 DB·MinIO 볼륨을 별도 보존한 뒤 복원합니다. 운영 볼륨에 바로 덮어쓰지 않습니다.
