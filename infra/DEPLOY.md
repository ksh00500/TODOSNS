# 학교 서버 배포

1. 저장소 루트에서 `.env.example`을 `.env`로 복사하고 비밀값과 실제 도메인을 채웁니다.
2. 앱 도메인과 미디어 서브도메인의 DNS A/AAAA 레코드를 서버로 연결하고 80/443 포트를 엽니다.
3. `npm ci && npm run db:generate` 후 최초 스키마를 `npm run db:migrate -- --name init`으로 생성합니다.
4. `npm run compose:up`으로 서비스를 시작합니다.
5. API 컨테이너에서 `npx prisma migrate deploy --schema apps/api/prisma/schema.prisma`를 실행하고 필요하면 `npm run db:seed`를 실행합니다.

운영 전에는 기본 시드 비밀번호를 폐기하고, 매일 `infra/backup.ps1`을 예약 실행해 별도 디스크로 백업하세요.
