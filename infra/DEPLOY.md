# 뭉실 베타 배포

## 학교 서버 스테이징 — 외부 포트 1개

1. `.env.example`을 `.env`로 복사하고 `PUBLIC_HOST`, `PUBLIC_PORT`, DB·JWT·MinIO·SMTP 비밀값을 채웁니다.
2. 서버에서 `npm ci && npm run db:generate`를 실행합니다.
3. `npm run compose:staging:up`으로 웹, API, PostgreSQL, Redis, MinIO를 시작합니다.
4. `http://PUBLIC_HOST:PUBLIC_PORT/api/v1/health`와 `/api/v1/ready`가 각각 200인지 확인합니다.
5. `npm run db:seed`로 운영자 계정과 `MUNGSIL-BETA` 초대 코드를 만든 뒤 기본 비밀번호를 즉시 바꿉니다.

스테이징 Caddy는 같은 포트에서 웹, `/api`, `/mungsil-media`를 경로로 나눕니다. PostgreSQL·Redis·MinIO 관리 포트는 호스트에 공개하지 않습니다. HTTP 환경에서는 로그인 쿠키를 위해 `COOKIE_SECURE=false`를 사용하지만, PWA 설치와 운영 전환에는 도메인과 HTTPS를 적용하고 `COOKIE_SECURE=true`로 바꿔야 합니다.

## 도메인 운영 배포

1. `APP_DOMAIN`과 `MEDIA_DOMAIN`의 DNS를 서버로 연결하고 80/443을 엽니다.
2. SMTP와 모든 비밀값을 채운 뒤 `npm run compose:up`을 실행합니다.
3. API 컨테이너가 시작할 때 Prisma 마이그레이션을 먼저 적용하며, 실패하면 API가 열리지 않습니다.
4. `https://APP_DOMAIN/api/v1/ready`가 200인지 확인한 뒤 초대 코드를 배포합니다.

## 백업과 복원 점검

매일 별도 디스크에 다음을 예약 실행합니다.

```sh
sh infra/backup.sh /absolute/backup/path infra/docker-compose.staging.yml
```

DB와 MinIO 파일을 함께 저장하고 14일보다 오래된 백업을 정리합니다. 최소 주 1회 최근 DB 백업을 임시 데이터베이스에 복원해 확인합니다.

```sh
sh infra/restore-check.sh /absolute/backup/path/mungsil-YYYYMMDD-HHMMSS.sql.gz infra/docker-compose.staging.yml
```

장애 시에는 먼저 쓰기 트래픽을 막고 DB·MinIO 볼륨을 별도 보존한 뒤 복원합니다. 운영 볼륨에 바로 덮어쓰지 않습니다.
