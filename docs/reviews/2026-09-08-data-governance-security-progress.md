# 데이터 거버넌스·보안 구현 진행표

기준: 2026-09-08, 시작 commit `7926379`. 운영 DB·S3·실제 사용자 데이터는 변경하지 않았다.

상태는 `구현`, `합성 검증`, `실환경 검증 대기`, `정책 승인 대기`를 구분한다.

## 구현 결과

| 항목 | 상태 | 증거/제한 |
| --- | --- | --- |
| 데이터 inventory/L0~L3/보유 행렬 | 구현 | `docs/architecture/data-inventory-and-retention.md`; 기간·법적 근거는 허구로 채우지 않음 |
| DB 경계/ADR/PK-FK 정책 | 구현 | 6개 schema expand migration, AccountIdentity/ServiceProfile shadow, 기존 table DROP 없음 |
| DB capability role | 합성 DB 검증 | 동일 EC2 전용 network/volume의 빈 DB와 12→14 migration upgrade DB에서 허용/거부 query 통과 |
| 탈퇴 파기 outbox | 구현, 실제 DB 검증 대기 | 요청·세션 차단·즉시 실행 task를 한 transaction으로 처리; API 직후 시작 + 1분 재개, 집계 비의존 |
| S3 version/파생 삭제 | MinIO 합성 검증, AWS 대기 | 실제 SDK로 MinIO version ON/OFF 객체·version·delete marker·이웃 prefix 경계 통과. 전용 AWS S3는 생성 권한 대기 |
| 분석 기반 | 구현, 정책 승인 대기 | 목적/동의/보유/event/monthly/review/release schema. collection/export 기본 OFF, 실제 caller/endpoint 없음 |
| 월/연령 합성 함수 | 합성 검증 | 서울 월 경계, 활동 당시 decade, UNKNOWN, 필드 allowlist 테스트 |
| 운영 migration | 미적용 | 원격/실제 DB에 실행하지 않음 |
| 실제 파기/수집/외부 제공 | 미실행 | 별도 승인 전 금지 |

## SEC 진행

| SEC | 상태 | 변경/남은 위험 |
| --- | --- | --- |
| SEC-01 | 구현, 외부 확인 대기 | production HTTPS/secure cookie/custom endpoint fail-closed. `local-synthetic + SEED_DEMO_DATA=true`만 HTTP 예외. 실제 TLS 미확인 |
| SEC-02 | 구현, DB E2E 대기 | readableTodoList와 clone transaction에서 deletedAt 제외, Serializable 재조회. 실제 동시 삭제 PostgreSQL 검증 대기 |
| SEC-03 | 합성 검증 | JwtAuthGuard/Optional guard가 Session에 연결된 현재 DB role/email로 principal 갱신. 역할 변경 endpoint/세션 version 정책은 추가 가능 |
| SEC-04 | 구현, 브라우저/S3 검증 대기 | SW 정적 allowlist v2, navigation/API/임의 image/auth query 비캐시, media no-store, URL 5분 |
| SEC-05 | 구현, MinIO/AWS 검증 대기 | 변환 원본 실패 outbox, version/marker/파생 삭제 확인 및 재시도 |
| SEC-06 | 일부 기존 구현/후속 작업 | password reset 세션 폐기와 기존 관리자 권한 검사 유지. MFA·재인증·2인 복구는 미구현이며 관리자 화면 인터넷 공개 전 해결 조건 |
| SEC-07 | 미착수 | cookie auth Origin/Fetch Metadata/nonce 정책 필요 |
| SEC-08 | 기존 일부, 미착수 잔여 | process-local limit 존재. Redis IP+계정 제한, quota 원자 예약, socket 제한 남음 |
| SEC-09 | 구현, 실제 응답 검증 대기 | Next CSP 최소 강제(frame/object/base/form), X-Frame/Referrer/nosniff/Permissions. Google/Next production build 통과 |
| SEC-10 | 로컬 구현, DB 검증 대기 | 게시 시점 snapshot, 원본 범위 축소 시 조회·검색·이미지 URL·가져오기 차단, 삭제·탈퇴 시 파기. 기존 타인 복제본은 정책 대기 |
| SEC-11 | 일부 구현 | query 없는 request path와 제한된 request ID, 운영 content list 조회 감사. 사건 기반 열람 범위·로그 보유기간 남음 |
| SEC-12 | expand 구현, 운영 대기 | schema/capability role/backup 분리 문서. 현재 API와 migration DB credential 분리 미적용 |
| SEC-13 | 일부 검증 | `npm audit --omit=dev` 0건. git history secret/image/Android/SBOM 별도 검사 필요 |
| SEC-14 | 진행 | CI에 migration+실제 role SQL. Redis/MinIO/Mailpit/browser/AWS restore E2E는 대기 |

## 테스트 기록

- `npm run lint`: API/web 통과.
- `npm test`: API 69개 중 67 통과·실제 DB/객체 storage E2E 2 skip, web 50개 전부 통과.
- snapshot 합성 검증: 생성 시점 TODO 값 고정, 공개 범위 축소 차단, 삭제 scrub/outbox, legacy fail-closed backfill 계약 통과.
- `npm run build`: contracts/API/Next 24개 page production build 통과.
- `npm audit --omit=dev`: 알려진 취약점 0건.
- Prisma 6.12.0 schema validate: 통과. 새 cross-schema raw migration SQL 자체는 실제 PostgreSQL에서 아직 미검증.
- Compose production/staging config parse: 통과.
- 로컬 Docker/Compose: Docker Desktop Linux engine 미실행. 운영 EC2는 `t3.micro`/약 1 GiB RAM/8 GiB disk로 자원 부족이라 병행 실행하지 않으며, 승인된 별도 `t3.small` 검증 EC2는 AWS 생성 자격 증명 대기.
- 동일 EC2 축소 검증: PostgreSQL과 MinIO를 순차 실행해 빈 DB 14개 migration, 기존 합성 DB 12→14 upgrade, role/trigger, 객체 삭제 통과. 운영 API는 전후 healthy, 테스트 container/volume/network/path 정리 완료.

## 승인된 정책과 남은 결정

1. 승인: 게시 시점 snapshot. 원본 범위 축소 시 신규 조회·검색·이미지 제공·가져오기 제한, 삭제·탈퇴 시 snapshot 파기.
2. 승인: 탈퇴 확정 즉시 접근·신규 분석 수집 차단, 일률적인 유예 없이 파기 시작, 집계 완료 비의존.
3. 승인: 새 목적 분석 원문 적재와 외부 제공은 OFF. 기존 사진·채팅 기능은 유지.
4. 미결정: 기존 타인 복제본의 원본 삭제·탈퇴 후 처리.
5. 후속 보안 작업: 관리자 MFA·재인증·2인 복구. 구현 전 관리자 화면 인터넷 공개 금지.
6. 법률·운영 검토: 사진·채팅·신고·감사·보안 로그·backup·파기 증빙의 기산점/기간과 RPO/RTO. 미확정은 무기한 보유가 아니다.
7. 별도 승인 필요: 운영 migration, 실제 파기, 분석 수집, 외부 제공, 운영 배포·S3/IAM 변경.

## 다음 안전 단계

MinIO까지의 합성 검증은 완료했다. 전용 AWS S3 version/IAM 검증은 유효한 AWS Console/CLI 세션으로 테스트 bucket 한정 role을 만들 수 수행한다. 운영 자격 증명이나 기존 volume은 테스트에 사용하지 않는다.
