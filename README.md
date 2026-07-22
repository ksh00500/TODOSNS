# 뭉실 (MUNGSIL)

작은 실천을 완료하고 공유하며, 다른 사람의 좋은 습관을 내 TODO로 가져오는 TODO 기반 소셜 서비스입니다.

## 구성

- `apps/web`: Next.js 모바일 PWA
- `apps/api`: NestJS REST/WebSocket API
- `packages/contracts`: 공용 API 타입
- `infra`: Caddy, PostgreSQL, Redis, MinIO를 포함한 Docker Compose

## 로컬 실행

1. `.env.example`을 `.env`로 복사하고 값을 채웁니다.
2. `npm install`
3. `docker compose -f infra/docker-compose.dev.yml up -d`
4. `npm run db:generate && npm run db:migrate && npm run db:seed`
5. `npm run dev`

웹은 `http://localhost:3000`, API 문서는 `http://localhost:4000/api/docs`에서 확인할 수 있습니다.

## 온프레미스 배포

`infra/docker-compose.yml`은 80/443만 외부에 공개합니다. PostgreSQL, Redis, MinIO 관리 포트는 내부 Docker 네트워크에서만 접근합니다. 실제 배포 전 `APP_DOMAIN`, `API_DOMAIN`, Google OAuth, SMTP, 외부 백업 위치를 설정하세요.
