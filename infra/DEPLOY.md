# 뭉실 베타 배포

## 학교 서버 스테이징 — 외부 포트 1개

1. `.env.example`을 `.env`로 복사하고 `PUBLIC_HOST`, `PUBLIC_PORT`, DB·JWT·MinIO·SMTP·시드 비밀값을 채웁니다. 8004를 할당받았다면 `PUBLIC_PORT=8004`로 지정합니다.
2. 서버에서 `npm ci && npm run db:generate`를 실행합니다.
3. `npm run compose:staging:up`으로 웹, API, PostgreSQL, Redis, MinIO를 시작합니다.
4. `http://PUBLIC_HOST:PUBLIC_PORT/api/v1/health`와 `/api/v1/ready`가 각각 200인지 확인합니다.
5. `docker compose --env-file .env -f infra/docker-compose.staging.yml exec api node apps/api/prisma/seed.cjs`로 운영자·데모 계정과 초대 코드를 생성합니다. 값은 `.env`의 `SEED_ADMIN_PASSWORD`, `SEED_DEMO_PASSWORD`, `SEED_INVITE_CODE`를 사용합니다.

스테이징 Caddy는 같은 포트에서 웹, `/api`, `/mungsil-media`를 경로로 나눕니다. PostgreSQL·Redis·MinIO 관리 포트는 호스트에 공개하지 않습니다. HTTP 환경에서는 로그인 쿠키를 위해 `COOKIE_SECURE=false`를 사용하지만, PWA 설치와 운영 전환에는 도메인과 HTTPS를 적용하고 `COOKIE_SECURE=true`로 바꿔야 합니다.

## 도메인 운영 배포

1. `APP_DOMAIN`의 DNS를 서버의 Elastic IP로 연결하고 80/443을 엽니다.
2. 비공개 S3 버킷을 만들고 CORS에 `https://APP_DOMAIN`을 허용합니다. EC2에는 해당 버킷만 읽고 쓸 수 있는 IAM Role을 연결합니다.
3. `.env`의 `STORAGE_BUCKET`, `STORAGE_REGION`, SMTP와 모든 비밀값을 채웁니다. AWS S3에서는 `STORAGE_ENDPOINT`와 장기 Access Key를 설정하지 않습니다.
4. `npm run compose:up`을 실행합니다. 운영 Compose는 MinIO를 실행하지 않고 EC2 IAM Role의 임시 자격 증명으로 S3를 사용합니다.
5. API 컨테이너가 시작할 때 Prisma 마이그레이션을 먼저 적용하며, 실패하면 API가 열리지 않습니다.
6. `https://APP_DOMAIN/api/v1/ready`가 200인지 확인한 뒤 초대 코드를 배포합니다.

## 백업과 복원 점검

매일 별도 디스크에 다음을 예약 실행합니다.

```sh
sh infra/backup.sh /absolute/backup/path infra/docker-compose.staging.yml
```

스테이징에서는 DB와 MinIO 파일을 함께 저장합니다. AWS 운영에서는 로컬 MinIO가 없으므로 IAM Role로 DB 덤프를 S3에 직접 전송합니다.

```sh
sh infra/backup-to-s3.sh "$STORAGE_BUCKET" infra/docker-compose.yml
```

최소 주 1회 최근 DB 백업을 임시 데이터베이스에 복원해 확인합니다.

```sh
sh infra/restore-check.sh /absolute/backup/path/mungsil-YYYYMMDD-HHMMSS.sql.gz infra/docker-compose.staging.yml
```

장애 시에는 먼저 쓰기 트래픽을 막고 DB·MinIO 볼륨을 별도 보존한 뒤 복원합니다. 운영 볼륨에 바로 덮어쓰지 않습니다.
