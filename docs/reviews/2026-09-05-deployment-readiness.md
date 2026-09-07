# 뭉실 실제 서비스 배포 준비 검토

검토일: 2026-09-05 · 기준 커밋: `6fe0682` · 브랜치: `codex/beta-core`

## 1. 판단

**현재 상태로 실제 개인정보를 받는 서비스의 배포 승인을 내리기는 어렵다.** 기능과 화면은 상당 부분 구현되어 있지만, 계정 간 데이터 분리, 채팅 권한 회수, 실제 피드 요청, 탈퇴 후 데이터 처리에서 배포 전에 해결할 문제가 확인됐다.

새 기능을 늘리기보다 아래 차단 항목을 먼저 수정하고, 실제 DB·스토리지·메일·브라우저를 연결한 베타 검증을 완료하는 것이 다음 단계다. 의존성 감사와 빌드 성공은 확보했지만, 서비스의 정상 동작이나 보안을 모두 증명하지는 않는다.

이 문서는 코드·설정·기존 테스트와 공식 문서를 검토한 결과다. **서비스 코드 수정, 운영 DB 변경, 원격 서버 접속·배포는 수행하지 않았다.** 진단 스크립트와 이 보고서만 작성했다.

## 2. 검증 범위와 결과

| 검사 | 이번 결과 | 해석과 한계 |
| --- | --- | --- |
| `npm run lint` | 통과 | 웹/API 정적 검사 |
| `npm test` | API 37개 통과, 1개 건너뜀 / 웹 23개 통과 | 총 60개 통과. DB E2E는 실행하지 않음 |
| `npm run build` | contracts/API/웹 모두 통과 | 로컬 Node 22.16.0·Windows. Docker의 Node 24·Alpine 런타임 검증과 다름 |
| `npm audit --omit=dev --json` | 알려진 취약점 0건 | 조회 시점의 npm 운영 의존성 범위. 컨테이너 OS·설정·자체 코드 취약점은 포함하지 않음 |
| 추가 진단 | 아래 7개 문제 재현 | 실제 컴파일된 함수와 웹 API 코드를 실행하되 DB·Google·소켓 전송·브라우저 저장소는 메모리 대역 사용 |
| 로컬 웹 | `/challenges` HTTP 200 | 페이지 제공 확인. 실제 서버 데이터 연동 성공을 의미하지 않음 |
| 실제 DB/미디어/Docker 실행 | 미검증 | 로컬 Docker Desktop Linux 엔진이 실행 중이지 않음. 사용자 DB에 테스트 데이터를 쓰지 않음 |
| 학교 서버·HTTPS·메일 도착·백업 복원 | 미검증 | 현재 서버 설정이나 과거 배포 성공을 이번 코드의 검증 결과로 간주하지 않음 |
| 실기기 UX·접근성·LCP/CLS | 이번에 측정하지 않음 | 기존 UI 점검 문서의 기록과 잔여 과제를 검토함 |

Prisma 엔진 접근 때문에 최초 샌드박스 테스트·빌드는 실패했으며, 승인된 환경에서 재실행한 결과가 위의 최종 결과다.

진단 스크립트: [probes.cjs](/C:/Users/user/Documents/TODOSNS/outputs/deployment-review/probes.cjs). `outputs`는 Git 제외 경로다. API 빌드 후 저장소 루트에서 `node outputs/deployment-review/probes.cjs`로 실행할 수 있다. 운영 데이터나 비밀값을 사용하지 않는다.

| 재현 항목 | 관찰 결과 |
| --- | --- |
| 피드 쿼리 검증 | `mode`, `category`에 대해 HTTP 400 검증 예외 |
| 소켓 세션 폐기·탈퇴 | 세션 조회 0회, 연결 미종료, 멤버십 제거 후 이벤트 1건 수신 |
| Google 로그인 정지 사용자 | 정지 상태인데 세션 발급 경로 진입 |
| 일일 포인트 상한 | 기존 4건에서 2건 동시 지급 시 5건 상한을 넘어 6건 |
| 90일 뒤 시작하는 매일 TODO | 생성 발생 일정 0건, 첫 일정 조회 실패 |
| 계정 전환 캐시 | B 계정 조회에서 A 계정 TODO 반환, B 조회 함수 실행 안 됨 |
| 오프라인 API 저장 | `Response.clone: Body has already been consumed` 미처리 오류 |

## 3. 배포 전 해결할 주요 항목

### R01. 계정 전환 시 이전 계정의 개인 데이터가 화면에 남음 — 배포 차단

- 근거: [app-providers.tsx:13](/C:/Users/user/Documents/TODOSNS/apps/web/components/app-providers.tsx:13), [api.ts:34](/C:/Users/user/Documents/TODOSNS/apps/web/lib/api.ts:34), [today/page.tsx:35](/C:/Users/user/Documents/TODOSNS/apps/web/app/(product)/today/page.tsx:35).
- 하나의 QueryClient가 로그인 전후에 유지된다. TODO 키는 `['todos', date]`, 그룹은 `['todo-lists']`이고 사용자 ID가 없다. `clearSession()`은 QueryClient를 비우지 않는다.
- 같은 브라우저에서 A 로그아웃 → B 로그인 시 A의 TODO가 남을 수 있다. 30초 freshness 안에서는 B의 데이터를 아예 요청하지 않는 상황도 진단에서 재현됐다.
- 개선: 사용자별 쿼리 키, 계정 변경 시 진행 중 요청 취소·개인 캐시 제거, 늦게 도착한 A 응답의 재저장 방지. 오프라인 캐시도 사용자별로 나누고 관리자 자료·민감 채팅은 저장 허용 목록에서 제외한다.
- 완료 조건: A/B 계정 전환, 느린 A 요청의 뒤늦은 응답, 새 탭, 오프라인에서 상대 계정 데이터가 한 프레임도 나타나지 않아야 한다.

### R02. 로그아웃·탈퇴·참여 취소가 기존 채팅 소켓에 반영되지 않음 — 배포 차단

- 근거: [chat.gateway.ts:10](/C:/Users/user/Documents/TODOSNS/apps/api/src/chat.gateway.ts:10), [challenge-chat.service.ts:69](/C:/Users/user/Documents/TODOSNS/apps/api/src/challenge-chat.service.ts:69), [mungsil.service.ts:725](/C:/Users/user/Documents/TODOSNS/apps/api/src/mungsil.service.ts:725).
- 소켓 연결은 JWT 서명만 확인하고 Session의 폐기·만료, 사용자 정지 상태를 조회하지 않는다. `join`은 멤버십만 확인한다. 이미 들어간 소켓을 탈퇴·로그아웃 시 방에서 내보내는 경로가 없다.
- 이벤트에는 새 메시지 본문과 사진 URL을 포함한 내용이 들어간다. 현재 UI가 이벤트를 새로고침 신호로만 쓰더라도, 권한을 잃은 연결에서 원문 이벤트를 받을 수 있다는 문제가 남는다.
- 개선: 연결·방 입장 시 세션 검증, 만료 시 연결 종료, 세션/사용자/방별 연결 추적, 로그아웃·정지·탈퇴 즉시 연결 또는 방 구독 회수. 이벤트를 수신 권한별로 보내거나 최소 ID 이벤트로 줄인다.
- 완료 조건: 실제 소켓에서 로그아웃·정지·멤버십 제거·JWT 만료 직후 본문과 사진 URL이 더 이상 전달되지 않아야 한다.
- 외부 기준: OWASP도 장기 WebSocket 연결의 세션 재검증과 로그아웃 즉시 연결 종료를 권고한다. [OWASP WebSocket Security](https://cheatsheetseries.owasp.org/cheatsheets/WebSocket_Security_Cheat_Sheet.html)

### R03. 실제 탐색 피드 쿼리가 서버 검증에서 거부됨 — 배포 차단

- 근거: [explore-feed.tsx:35](/C:/Users/user/Documents/TODOSNS/apps/web/components/explore-feed.tsx:35), [controllers.ts:56](/C:/Users/user/Documents/TODOSNS/apps/api/src/controllers.ts:56), [dtos.ts:10](/C:/Users/user/Documents/TODOSNS/apps/api/src/dtos.ts:10), [main.ts:37](/C:/Users/user/Documents/TODOSNS/apps/api/src/main.ts:37).
- 프론트는 기본 피드에서도 `limit`, `mode`, `category`를 보낸다. 서버의 `@Query() PageDto`에는 `limit`, `cursor`만 있고 `forbidNonWhitelisted: true`다. 별도의 `@Query('mode')`가 전체 PageDto 검증에서 해당 필드를 제거해주지는 않는다.
- 실제 ValidationPipe에 이 입력을 전달했을 때 `property mode should not exist`, `property category should not exist`가 재현됐다. 데모 경로는 이 검증을 통과하지 않으므로 화면 확인만으로 발견하기 어렵다.
- 개선: 검증 가능한 FeedQueryDto로 전체 쿼리를 통일하고 지원 정렬·카테고리 값을 정의한다.
- 완료 조건: 브라우저가 실제 만드는 URL로 비회원·로그인 피드, 필터, 다음 페이지, 잘못된 필터 입력을 API 통합 테스트한다.

### R04. 인증 진입점별 정지·탈퇴 검사 불일치 — 배포 전 필수, Google 사용 시 특히 중요

- 근거: [auth.ts:136](/C:/Users/user/Documents/TODOSNS/apps/api/src/auth.ts:136), [auth.ts:152](/C:/Users/user/Documents/TODOSNS/apps/api/src/auth.ts:152), [auth.ts:190](/C:/Users/user/Documents/TODOSNS/apps/api/src/auth.ts:190).
- 이메일/비밀번호 로그인과 refresh는 정지·탈퇴 상태를 검사하지만 Google 로그인과 메일 인증 성공 경로에는 같은 검사가 없다. 유효한 인증 증빙을 가진 정지 사용자의 Google 로그인에서 신규 세션 발급이 재현됐다.
- Google 로그인은 이메일이 같다는 이유로 기존 계정과 자동 연결한다. Google `sub` 불일치와 제3자 이메일 소유권을 더 엄격히 다뤄야 한다.
- 개선: 세션을 발급하는 공통 경로에서 계정 상태를 재검사하고, 기존 계정 연결에는 기존 계정 재인증을 요구한다. 검증이 끝날 때까지 Google 기능은 서버에서도 비활성 상태를 명시한다. 화면의 비활성 버튼만으로 API 접근이 차단되지는 않는다.
- 완료 조건: 정지·탈퇴 계정에 login/google/verify-email/refresh 모두 동일하게 세션을 거부하고, 불일치 Google 계정이 기존 계정에 연결되지 않아야 한다.
- 조건: 실제 서버에 `GOOGLE_CLIENT_ID`가 없다면 현재 Google 진입점은 거부된다. 이 설정은 이번에 읽지 않았다. Google은 Gmail/Workspace 외 이메일의 현재 소유권을 항상 보증하지 않는다고 안내한다. [Google ID token 검증](https://developers.google.com/identity/gsi/web/guides/verify-google-id-token)

### R05. 방장 탈퇴가 다른 참여자의 챌린지 기록까지 삭제할 수 있음 — 데이터 보존 차단 항목

- 근거: [schema.prisma:597](/C:/Users/user/Documents/TODOSNS/apps/api/prisma/schema.prisma:597), [schema.prisma:487](/C:/Users/user/Documents/TODOSNS/apps/api/prisma/schema.prisma:487), [maintenance.service.ts:25](/C:/Users/user/Documents/TODOSNS/apps/api/src/maintenance.service.ts:25).
- User → 생성한 Challenge → 참여자·인증·Conversation 관계가 Cascade 삭제다. 방장 계정의 7일 후 실제 삭제는 다른 사람의 참가 기록과 방 전체 대화까지 지우는 결과로 이어질 수 있다.
- 별도로 감사 기록이 있는 운영자 계정은 `AdminAuditLog.admin`의 Restrict 때문에 실제 탈퇴 삭제가 계속 실패할 수 있다.
- 개선: 일반 계정 탈퇴와 공동 콘텐츠 보존을 분리한다. 작성자 익명화, 운영자 소유권 이전, 진행 챌린지의 방장 변경 정책을 정하고 마이그레이션한다. 운영자 계정 삭제·감사 기록의 보존 근거도 별도로 정의한다.
- 완료 조건: 방장·일반 참여자·감사 이력이 있는 운영자의 탈퇴를 실제 DB에서 검증하고, 타인의 인증·순위·대화 보존 범위와 사진 삭제 범위를 확인한다.

### R06. Docker 빌드 컨텍스트에서 비밀·로컬 산출물 제외가 없음 — 배포 전 필수

- 근거: 저장소와 Dockerfile 주변에 `.dockerignore`가 없으며 [API Dockerfile:13](/C:/Users/user/Documents/TODOSNS/apps/api/Dockerfile:13), [웹 Dockerfile:13](/C:/Users/user/Documents/TODOSNS/apps/web/Dockerfile:13)이 `COPY . .`을 사용한다.
- `.env`, `.git`, 로컬 `node_modules`, 빌드 결과가 빌드 컨텍스트와 중간 레이어에 들어갈 수 있다. 로컬 모듈이 이미지에서 설치한 Linux 모듈을 덮어써 재현성도 떨어진다.
- 최종 공개 이미지나 브라우저에 비밀이 유출됐다는 증거를 확인한 것은 아니다. 문제는 비밀과 불필요한 파일이 빌더·캐시에 전달되는 경로가 열려 있다는 것이다.
- 개선: 기본/환경별 `.dockerignore`, 명시적 소스 COPY, 빌드·런타임 비밀 분리, 이미지 레이어 검사. 예시 비밀값은 길이 검사만 통과해도 허용하지 않도록 시작 검증을 강화한다.
- 완료 조건: 비밀 파일 없는 깨끗한 체크아웃으로 이미지 빌드·기동·마이그레이션을 통과하고, 최종 이미지와 빌드 산출물에 비밀이 없어야 한다. [Docker 빌드 컨텍스트](https://docs.docker.com/build/concepts/context/)

### R07. HTTP 스테이징을 실제 계정 운영 환경으로 쓰지 않도록 전환 필요

- 근거: [docker-compose.staging.yml](/C:/Users/user/Documents/TODOSNS/infra/docker-compose.staging.yml)은 HTTP origin과 `COOKIE_SECURE: false`를 고정한다. 도메인용 Compose/Caddy에는 HTTPS 구성이 별도로 있다.
- 현재 학교 서버가 어느 구성을 쓰는지는 확인하지 않았다. HTTP 설정으로 실제 계정을 받으면 비밀번호·토큰·사진 전송 보호가 충분하지 않다.
- 개선: 실제 사용자가 접속할 도메인과 TLS 종단을 확정하고 웹/API/미디어/Socket의 origin을 모두 맞춘다. 학교 단일 포트를 유지한다면 해당 포트의 TLS 또는 학교 HTTPS 프록시를 포함해 구성한다.
- 완료 조건: 외부 브라우저에서 HTTPS 로그인·쿠키 refresh·사진 PUT/GET·Socket 연결·PWA를 검증한다. DB·Redis·MinIO 관리 포트 비공개 정책을 유지한다.

## 4. 핵심 데이터·안정성 보완

| ID / 우선순위 | 확인 내용과 근거 | 개선·완료 조건 |
| --- | --- | --- |
| R08 / 높음 | 포인트 일일 상한의 count가 트랜잭션 밖이다. [reward:57](/C:/Users/user/Documents/TODOSNS/apps/api/src/mungsil.service.ts:57). 상한 5건에서 6건 지급 재현. | 사용자/일자 단위 원자적 집계 또는 잠금·직렬화와 재시도. 서로 다른 TODO 동시 완료 테스트. 동일 원본의 반복 가져오기에 대한 보상 정책도 명확히 함. |
| R09 / 높음 | TODO 완료·게시·보상·알림이 여러 트랜잭션으로 나뉜다. 메시지 저장 후 알림 실패도 전체 요청 실패가 될 수 있다. [completeTodo:321](/C:/Users/user/Documents/TODOSNS/apps/api/src/mungsil.service.ts:321), [send:51](/C:/Users/user/Documents/TODOSNS/apps/api/src/challenge-chat.service.ts:51). | 핵심 데이터 변경은 원자적으로 저장하고 메일·알림·이벤트는 재시도 가능한 outbox 작업으로 분리. 저장 후 응답 유실·알림 실패에서 중복 생성이 없어야 함. |
| R10 / 높음 | 프론트가 매 `apiFetch` 호출마다 새 Idempotency-Key를 만든다. 서버 키에는 본문 해시가 없고, 처리 도중 장애 시 불완전 키 또는 이미 저장된 데이터와 결과 저장이 어긋날 수 있다. [api.ts:102](/C:/Users/user/Documents/TODOSNS/apps/web/lib/api.ts:102), [idempotency.interceptor.ts:13](/C:/Users/user/Documents/TODOSNS/apps/api/src/idempotency.interceptor.ts:13). | 사용자 행동 하나에 키 하나를 재시도까지 유지. 동일 키·다른 본문은 거부. DB 커밋과 요청 결과의 복구 정책 마련. 멱등성이 없는 토글 API에는 목표 상태 지정도 검토. |
| R11 / 높음 | 반복 발생 범위가 시작일이 아니라 현재 시각+60일 기준이다. 90일 뒤 시작하는 반복 TODO는 발생 0건 후 오류. 연장 작업은 매일 500개만 조회하고 전체 순회·안정 정렬이 없다. [recurrence.service.ts:44](/C:/Users/user/Documents/TODOSNS/apps/api/src/recurrence.service.ts:44), [recurrence.service.ts:169](/C:/Users/user/Documents/TODOSNS/apps/api/src/recurrence.service.ts:169). | 먼 미래 시작일 허용 정책과 첫 발생 보장. 과거 날짜 생성량 제한, 모든 시리즈의 커서 순회, 마지막 생성 위치부터 연장. 501개 이상·일일 작업 누락 후 복구 검증. |
| R12 / 높음 | 사용자 timezone을 서버는 쓰지만 오늘 범위는 브라우저 현지 시간으로 계산한다. [date.ts:1](/C:/Users/user/Documents/TODOSNS/apps/web/lib/date.ts:1). 챌린지 일수는 UTC 날짜 기준이며 인증 일자는 사용자 시간대 기준이다. | TODO는 계정 시간대, 챌린지는 챌린지 고정 시간대 등 명확한 기준을 정한다. 여행/시간대 변경으로 일일 인증·보상을 추가 획득하거나 날짜가 어긋나지 않는지 테스트. |
| R13 / 높음 | 오프라인 API 캐시가 `response.json()` 뒤의 비동기 콜백에서 `response.clone()`을 호출한다. [api.ts:138](/C:/Users/user/Documents/TODOSNS/apps/web/lib/api.ts:138). 미처리 복제 오류 재현. | 본문을 읽기 전에 복제하고 캐시 실패를 처리. R01의 사용자 분리부터 함께 적용. 전체 GET 무차별 저장을 피하고 TTL/용량/계정별 삭제 규칙 적용. |
| R14 / 높음 | `pg_dump | gzip`에서 앞 명령 실패를 파이프가 숨길 수 있다. `gzip -t`는 빈 정상 gzip도 통과한다. 실행 중 MinIO 파일 tar와 DB 백업의 시점 일치도 보장되지 않는다. [backup.sh:21](/C:/Users/user/Documents/TODOSNS/infra/backup.sh:21). | 각 명령 실패 검출, 임시 파일 후 성공 시 확정, 별도 장애 영역 보관, 암호화와 접근 제한, DB+사진 실제 복원. SQL gzip 유효성만으로 성공 판정하지 않음. |
| R15 / 높음 | 미디어 삭제 실패를 무시한 뒤 DB 행을 삭제한다. READY 미연결 이미지는 정리 대상이 아니다. [media.service.ts:224](/C:/Users/user/Documents/TODOSNS/apps/api/src/media.service.ts:224), [media.service.ts:233](/C:/Users/user/Documents/TODOSNS/apps/api/src/media.service.ts:233). | 삭제 작업 상태와 재시도·경보를 남기고 객체 삭제 확인 후 DB 정리. 취소한 게시/프로필 교체/재제출의 고아 이미지 정리. 타인 챌린지 Cascade 삭제로 생기는 객체도 추적. |

백업 스크립트와 DB 복원 점검 스크립트가 이미 있는 점은 좋다. 다만 실제 운영 복구 절차는 계정/TODO/게시물/사진을 복구 후 조회해보는 데까지 확장해야 한다. PostgreSQL은 SQL dump와 파일 백업 등 각 방식의 보장 범위를 구분한다. [PostgreSQL 17 SQL Dump](https://www.postgresql.org/docs/17/backup-dump.html)

## 5. 보안·운영 추가 검토 항목

### 트래픽 제한과 자원 보호

- [main.ts:12](/C:/Users/user/Documents/TODOSNS/apps/api/src/main.ts:12)에 신뢰할 프록시 설정이 없고, [app.module.ts:28](/C:/Users/user/Documents/TODOSNS/apps/api/src/app.module.ts:28)은 기본 Throttler를 사용한다. Caddy 뒤에서는 동일 엔드포인트에 대한 여러 사용자의 제한 버킷이 프록시 IP 하나로 합쳐질 수 있다. 모든 API가 한 개의 총량 버킷이라는 뜻은 아니다.
- 신뢰할 Caddy/네트워크 범위만 지정하고, 인증·재발송은 IP+계정 기준의 짧은 간격/일일 상한을 둔다. 요청 수 제한을 여러 API 프로세스에서 공유하려면 Redis 저장소를 명시적으로 연결해야 한다. Redis 컨테이너 존재만으로 Throttler 저장소가 Redis로 바뀌지 않는다. [NestJS Rate Limiting](https://docs.nestjs.com/security/rate-limiting)
- 10MB 이미지·4천만 픽셀 제한과 WebP 재인코딩은 구현됐다. 다만 완성 처리 전 원문 전체를 메모리에 읽으며 변환 동시 실행량·계정별 저장 용량 제한이 없다. 업로드/다운로드 제한, 처리 큐, 동시성·타임아웃과 저장 용량 한도를 둔다.
- 공용 학교 서버에 배포하므로 컨테이너별 메모리/CPU/PID 한도, Docker 로그 회전, 디스크 여유 경보를 둔다. 현재 Compose에는 이 설정이 없다.

### 인증과 운영 권한

- 메모리 액세스 토큰·HttpOnly refresh 쿠키·토큰 해시·회전·일회용 검증 토큰은 구현되어 있다.
- refresh의 단일 실행 보호는 탭 안에만 있다. 두 탭이 같은 쿠키로 동시에 refresh하면 정상 사용도 재사용 감지로 세션이 폐기될 가능성이 있다. 다중 탭 동기화와 서버의 중복 refresh 처리 정책을 검증한다.
- 만료 액세스 토큰으로 logout하면 `/auth/*`의 자동 refresh 예외 때문에 로그아웃 요청이 실패하고 쿠키가 남을 수 있다. 현재 설정 화면은 실패 여부와 관계없이 클라이언트 세션을 지운 뒤 다시 세션을 조회한다. 실제 서버 세션 폐기·쿠키 삭제까지 보장하는 로그아웃 계약이 필요하다.
- 운영자 MFA/재인증과 복구 절차가 없다. 초대 베타에서도 관리자 계정은 별도 계정으로 운영하고, 최소 권한과 감사 기록 보존을 검증한다.
- [adminReportedContext:200](/C:/Users/user/Documents/TODOSNS/apps/api/src/challenge-chat.service.ts:200)은 신고 메시지와 앞뒤 3개 제한은 지키지만, **열람자 ID를 받지 않고 열람 감사 기록을 남기지 않는다.** 운영자가 누구의 대화를 어떤 신고로 읽었는지 남겨야 한다.
- 쿠키 관련 엔드포인트의 Origin/Fetch Metadata 및 CSRF 동작을 테스트한다. CORS와 SameSite 설정은 존재하지만 그것만으로 모든 인증 흐름 검증을 끝내지 않는다.
- Swagger는 운영에서도 공개된다. 이를 인증 없는 데이터 유출로 단정할 수는 없지만, 외부 공개 필요성을 결정하고 필요 없으면 운영에서 비활성화한다.

### 공개 데이터·미디어 수명

- 피드 권한, 소유권, 차단 관계 검사가 여러 경로에 존재한다. 그러나 [serializePost:1416](/C:/Users/user/Documents/TODOSNS/apps/api/src/mungsil.service.ts:1416)은 그룹의 현재 TODO 객체와 categoryRef를 그대로 포함한다. 그룹 항목의 삭제 상태 필터도 없다.
- [removeTodo:306](/C:/Users/user/Documents/TODOSNS/apps/api/src/mungsil.service.ts:306)는 단일 PostTodo 링크만 확인하므로 그룹으로 게시된 항목 삭제와 공개 응답의 관계를 놓칠 수 있다. 원본을 편집하거나 그룹에 새 항목을 넣었을 때 이미 게시한 내용까지 변경될지 제품 정책을 확정해야 한다.
- 공개 게시물을 스냅샷으로 만들지, 원본 변경을 반영할지 정하고 공개 DTO를 허용 필드로 제한한다. 개인 카테고리 이름/메모/삭제 항목이 기대와 다르게 노출되지 않는지 검증한다.
- 사진은 비공개 버킷의 1시간 서명 URL을 사용한다. 사진 응답에는 `private, max-age=31536000, immutable`이 설정된다. 서명 만료가 이미 다운로드한 브라우저 캐시까지 지우는 것은 아니다. 비공개 채팅/신고 사진에는 짧은 캐시 또는 no-store 정책을 적용한다.

## 6. 기능 완성도·사용성의 남은 차이

| 영역 | 코드에서 확인한 남은 차이 | 권장 조치 |
| --- | --- | --- |
| 추천순 | 화면에는 관심사 추천 설명이 있지만 `feed(..., _mode)`는 mode를 사용하지 않고 항상 최신순 | 베타에서는 정확한 이름/기능을 제공하거나 실제 정렬 구현 |
| 검색 | 결과 개수는 전체를 세지만 사용자 8명·게시물 20개 등으로 제한하며 후속 커서를 제공하지 않음 | 종류별 더 보기와 커서 구현, 검색어 포함 검색의 쿼리 계획 점검 |
| 관리자·연결 목록 | 여러 API가 take만 적용하고 `nextCursor: null` 반환 | 회원·콘텐츠·감사 로그·팔로워의 다음 페이지를 실제 데이터로 확인 |
| 대화방 참여자 | `members()`가 page.limit만 사용하고 cursor 무시 | 큰 방에서 모든 참여자 조회·제재 가능하도록 페이지네이션 |
| 목록 성능 | TODO/그룹/댓글/대화함에 전체 조회가 남아 있고, 방마다 안 읽음 count를 별도로 조회 | 기간/페이지 상한, 필요한 select, 집계 쿼리와 인덱스. 실제 크기의 데이터로 측정 |
| 초대 가입 | 서버는 초대 가입 비활성 설정이 있지만 폼은 초대 코드를 항상 필수로 표시 | 서버의 공개 가입 상태를 클라이언트와 일치시키기 |
| 인증 메일 | 실패 문구와 재발송은 있지만 발송 재시도 큐·운영 경보·실제 도착 검증 부족 | 발신 도메인 인증, SMTP 연결·메일 도착 smoke test, 실패 재시도 |
| 공통 오류 | API의 영어/내부 오류 메시지가 그대로 화면으로 올라갈 수 있음 | 오류 코드 계약, 한국어 안내, 요청 ID·재시도 버튼, 상세 원인은 서버 기록 |
| 모바일/PWA | 기존 문서에도 키보드·200% 확대·실제 업로드·다계정 E2E가 남아 있음 | 360/390/430px, Android Chrome/iOS Safari, 오프라인·재연결을 실제 빌드에서 검증 |

UI는 새로 갈아엎기보다 현재 Cloud Comfort와 5탭 구조를 유지하면서 실패·재시도·권한 만료 상태를 먼저 완성하는 편이 적절하다. 기존 [UI/UX 점검 기록](/C:/Users/user/Documents/TODOSNS/docs/design-system/uiux-review.md)의 ‘구현 완료’와 실제 계정 검증 완료를 별도로 관리해야 한다.

## 7. 실제 운영에 필요한 문서와 배포 체계

- 개인정보 처리방침과 이용약관은 [privacy/page.tsx:2](/C:/Users/user/Documents/TODOSNS/apps/web/app/privacy/page.tsx:2), [terms/page.tsx:2](/C:/Users/user/Documents/TODOSNS/apps/web/app/terms/page.tsx:2)에 명시적으로 초안 자리라고 적혀 있다. 실제 운영 주체·연락처·처리 항목·목적·보유 기간·권리 행사·위탁/이전 해당 여부·파기 절차를 서비스 동작과 맞춰야 한다. 개인정보 처리방침 수립·공개 사항은 [개인정보 보호법 제30조](https://www.law.go.kr/lsLawLinkInfo.do?chrClsCd=010202&lsJoLnkSeq=900078922)를 확인하되, 개별 적용 요건은 운영 방식에 맞춰 검토한다.
- 가입 화면의 약관 체크 값은 전송 전에 제거된다. 필요한 동의가 무엇인지 확정하고 필요한 항목별 버전·동의 시각·변경 이력을 보관하는 계약을 마련한다.
- 정책 문서에 7일 탈퇴 처리, 90일 챌린지 대화 수명, 신고 증거 보존, 백업에서의 파기 지연을 일관되게 설명한다. 탈퇴/삭제 실패에 운영 경보가 있어야 약속을 지킬 수 있다.
- 구조화 요청 로그와 health/ready는 있다. 별도 오류 수집, 5xx·로그인 실패·메일 실패·사진 처리 실패·인증 투표 대기·정리 작업 실패·디스크 사용량 경보와 대응 담당자는 확인되지 않았다.
- 운영 이미지의 mutable tag(`latest`, `24-alpine` 등)를 검증된 버전/digest로 고정하고 정기 업데이트 절차를 둔다. 업데이트하지 않는 고정도 안전하지 않으므로 감사와 갱신을 함께 운영한다.
- 웹/API 컨테이너의 healthcheck, readiness timeout, 종료 신호 처리, 배포 후 smoke test, 이전 이미지로 되돌리는 절차를 추가한다. DB 마이그레이션은 이미지 롤백만으로 되돌아가지 않으므로 이전 코드와 호환되는 변경 순서를 사용한다.
- 현재 API 시작 때마다 migration을 실행한다. 베타 단일 인스턴스에서도 사전 백업과 실패 시 대응을 명시하고, 확대 시 배포 작업 한 곳에서 실행하도록 분리한다.
- 학교 서버의 외부 포트·DNS/TLS·저장 공간·백업 위치·장애 대응 권한·상용 운영 허용 여부는 실제 관리자와 확인해야 하는 환경 항목이다. 기존 다른 프로젝트 DB 포트는 별도로 유지한다.

## 8. 테스트 체계에서 먼저 바꿀 것

[CI](/C:/Users/user/Documents/TODOSNS/.github/workflows/ci.yml)에는 설치·Prisma·lint·test·build·audit가 구성되어 있고 PostgreSQL 서비스 및 `RUN_DATABASE_E2E=1`도 있다. 좋은 기반이지만 현재 다음 한계가 있다.

1. 웹 테스트는 주로 파일 존재와 문자열/정규식 검사다. 컴포넌트를 실제로 렌더링하거나 버튼을 눌러 확인하지 않는다.
2. 채팅·관리자 테스트도 상당 부분 소스 정규식 검사다. REST 권한·Socket 세션·동시성·실제 업로드 성공을 증명하지 않는다.
3. [beta-flow.e2e.test.cjs](/C:/Users/user/Documents/TODOSNS/apps/api/tests/beta-flow.e2e.test.cjs)는 실제 DB 기반 REST 순환을 갖추고 있지만, 대부분의 사용자를 인증 완료 상태로 직접 DB에 만든다. 메일 도착·링크 인증·브라우저·사진·채팅은 이 테스트 범위가 아니다.
4. CI 서비스는 PostgreSQL뿐이다. 미디어·메일·Redis 의존 경로를 실제로 검증하는 별도 통합 테스트 환경이 필요하다.
5. CI 설정의 존재는 최근 GitHub Actions 실행 성공의 증거가 아니다. 이번에는 원격 CI 실행 결과를 조회하지 않았다.

우선 추가할 동작 테스트:

- 실제 브라우저 A 가입 → 인증메일 링크 → TODO 생성/완료/게시 → B 응원/댓글/가져오기/완료.
- R01~R04의 캐시·세션·소켓·피드 쿼리 회귀 테스트.
- 3계정 채팅 참여/탈퇴/차단/요청 수락/이미지 일부 실패/재접속.
- 8계정 사진 투표: 무효표 제외, 5명/7명 임계값, 동시 투표, 재제출, 참여자 부족·대기 처리.
- 실제 스토리지에서 타인 mediaId·중복 연결·손상 파일·10MB 초과·처리 실패·삭제 재시도.
- DB 마이그레이션과 방장 탈퇴/삭제, 90일 수명, 백업 DB+사진 복원.
- 네트워크 응답 유실 후 재시도, 중복 클릭, 여러 탭 refresh, 500개 넘는 반복 시리즈.

## 9. 실행 순서와 출시 조건

| 단계 | 작업 | 다음 단계로 가는 조건 |
| --- | --- | --- |
| 1. 기능·보안 차단 해소 | R01~R06, 실제 피드, 캐시·세션·소켓·탈퇴, Docker 컨텍스트 | 발견한 문제의 회귀 테스트와 실제 DB 권한 검사 통과 |
| 2. 핵심 데이터 안정화 | R08~R15, 메일·업로드 재시도, 포인트·일정·멱등성 | 장애를 주입해도 데이터 중복/유실 없음, 삭제·복원이 실제로 동작 |
| 3. 운영 준비 | HTTPS, 정책 문안, 관리자 보호, 모니터링, 로그/자원 제한, 백업·롤백 | 새 환경에서 배포·메일·이미지·DB 복원·오류 알림을 직접 확인 |
| 4. 초대형 베타 | 운영 모드로 10~30명 사용, 신고/피드백 수집 | 최소 10명이 1주일 핵심 순환을 사용하고 데이터 유실·치명적 오류 없음 |
| 5. 공개 서비스 | 남은 페이지네이션/성능/접근성/운영 병목 보완 | 측정한 수용량·지원 체계에 맞춰 가입 범위 확대 |

테스트 목표는 브라우저 폭 360/390/430px와 PC 프레임, 모바일 LCP 2.5초 이하·CLS 0.1 이하, 핵심 API의 합의한 응답시간/오류율이다. 현재 달성 수치로 표기하지 않는다. 초기 부하 시험은 30명 수준의 핵심 사용 패턴과 동시 이미지 처리부터 시작하고 서버 실측에 따라 한도를 정한다.

작업일을 확정하기보다는 단계별 통과 조건으로 관리하는 것을 권장한다. 지금 가장 우선할 묶음은 **계정 데이터 분리 → 채팅 권한 회수 → 인증 상태 통일 → 실제 피드 계약 수정 → 탈퇴 데이터 보존**이다.
