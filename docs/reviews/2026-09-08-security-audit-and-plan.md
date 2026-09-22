# 뭉실 보안 검토 및 개선 계획

검토일: 2026-09-08  
기준 커밋: `7926379` (`ops: serialize API image build on small hosts`)  
검토 시작 시 Git 작업 트리: 깨끗함  
이번 작업: 코드·설정 검토, 기존 테스트 실행, 개선안 작성. 제품 코드·운영 서버·계정·DB는 변경하지 않았다.

## 1. 결론

**보안 기반은 상당 부분 있지만, 현재 상태를 ‘안전한 운영 배포로 검증 완료’라고 판단할 수는 없다.**

JWT/세션 검증, 비밀번호 해시, 미디어 소유권·실제 이미지 검사, 채팅 권한 회수, 입력 DTO 검증 등은 이미 구현돼 있다. 그러나 삭제 데이터의 그룹 복제 경로, 관리자 권한 갱신, 개인 사진의 캐시·보관, 운영 구성 간 안전장치 차이는 추가 수정이 필요하다. 실제 운영 인프라의 TLS·IAM·방화벽·백업 권한도 별도로 확인해야 한다.

우선순위는 다음과 같다.

1. 실제 운영 구성을 확인하고 HTTP 실계정 운영과 공유 Docker 관리자 권한 위험을 해소한다.
2. 삭제 데이터 복제, 관리자 역할 재검증, 개인 미디어 캐시·원본 삭제를 수정한다.
3. 관리자 MFA·재인증, CSRF 방어, 자원 제한과 최소 권한을 강화한다.
4. 실제 DB/스토리지/브라우저 보안 회귀 테스트와 복원·사고 대응을 배포 승인 조건으로 만든다.

## 2. 범위와 검증 결과

### 확인 범위

- API: 인증·세션·Google 로그인, Guard/Controller, TODO/그룹/게시 공개 범위, 관리자 기능, 채팅, 미디어, 유지보수, 멱등성, DTO.
- 웹: 토큰·계정별 캐시, 서비스 워커, 인증 복귀 URL, 보안 헤더 설정.
- 인프라: 운영/학교 스테이징 Compose, Caddy, Dockerfile, 백업, CI, seed.
- Android: TWA Manifest·서명 설정의 정적 확인. Android 의존성 감사·릴리스 APK 검증은 하지 않았다.
- 공식 보안 지침: OWASP, AWS S3, Docker 문서.

### 실행 결과

| 검사 | 결과 | 해석 |
| --- | --- | --- |
| `npm audit --omit=dev --json` | 알려진 취약점 0건 | 검사 시점 npm 운영 의존성 기준. 논리 결함·컨테이너 OS·Android 라이브러리·향후 CVE를 보장하지 않음 |
| `npm test -w @mungsil/api` | 54개 통과, 0개 실패, 1개 건너뜀 | API 빌드 포함. 실제 DB 핵심 순환 E2E는 건너뜀 |
| Guard 합성 입력 검사 | 발급 당시 ADMIN 유지, 현재 DB 역할 조회 없음 | 실제 사용자/DB 없이 로컬 메모리 대역으로 실행. SEC-03의 코드 경로 확인 |
| 추적 파일명 점검 | `.env.example` 외 실제 `.env`·대표 서명키 확장자 발견 안 됨 | 전체 Git 이력/고엔트로피 시크릿 스캔은 아님 |

첫 API 테스트는 샌드박스의 Prisma 엔진 다운로드 제한으로 중단됐다. 승인된 재실행에서 다운로드·빌드·테스트가 통과했다. 기존 테스트 중 일부는 소스 구조/문자열 검사이므로 테스트 이름만으로 실제 공격 저항성을 인정하지 않는다.

### 이번에 확인하지 않은 것

실제 서버에 접속하거나 외부 포트를 스캔하지 않았다. 운영 도메인 TLS 응답, 적용 중인 Compose, AWS IAM/S3/보안 그룹, 학교 Docker 데몬 권한, 실제 비밀값 강도·유출 이력, 실제 DB 동시성·스토리지 실패, 브라우저 CSRF/XSS 공격 재현은 미확인이다. 운영 사진이나 개인정보를 내려받지 않았다.

## 3. 이미 갖춘 보호 장치

- bcrypt cost 12 비밀번호 해시, 랜덤 검증 토큰과 refresh 토큰 해시 저장.
- 15분 access token, 기기별 세션, refresh 회전·재사용 탐지, 로그아웃/정지/탈퇴 시 세션 차단.
- Google ID 토큰 audience 및 `email_verified` 확인, 같은 이메일 계정의 자동 연결 거부.
- access token 메모리 보관, HttpOnly refresh 쿠키, 계정별 API 캐시 분리·TTL/용량 제한.
- DTO whitelist/forbidNonWhitelisted, 다수 요청 길이·배열 수 제한, 인증·업로드 HTTP rate limit.
- 미디어 READY/소유권 확인, 크기·실제 형식·픽셀 수 검사, 회전 보정·WebP 변환.
- 채팅 REST 멤버십/차단 검사, 소켓 세션/멤버십 재검사 및 본문 없는 갱신 신호.
- 관리자 신고 메시지의 앞뒤 3개 맥락 조회와 열람 감사 기록.
- 운영 Docker의 API/웹 비root 실행, DB/Redis 외부 포트 미게시, 운영 Compose의 자원·로그 제한.
- 운영 시드의 필수 환경값 요구, 운영 Swagger 기본 비활성, JWT 예시값·동일 키 거부.

이 장치들은 유지하면서 남은 경계를 보완해야 한다. 이번 검토에서 일반 사용자의 임의 관리자 승격이나 무조건적인 전체 DB 노출을 재현한 것은 아니다.

## 4. 주요 발견과 개선안

분류: **코드 확인**은 해당 구현/누락을 확인했다는 뜻이며 실제 운영 악용 성공과 다르다. **운영 확인 필요**는 설정 파일만으로 현재 배포 상태를 단정할 수 없는 항목이다.

### SEC-01 · 배포 차단 조건 · HTTP/쿠키 안전장치의 환경별 차이

**근거:** `infra/docker-compose.staging.yml:74–97`, `infra/Caddyfile.staging`, `apps/api/src/config.ts`, `apps/api/src/auth.ts:560`.

학교 스테이징은 외부 URL이 `http://...`, `COOKIE_SECURE:"false"`, 데모 seed 기본값이 true다. 운영 Compose는 HTTPS와 secure cookie를 사용하지만 API 환경 검증 자체는 production의 HTTP origin/비보안 쿠키를 막지 않는다. 스테이징에는 운영 Compose의 자원·로그·프록시 설정도 일부 빠져 있다.

**영향:** 이 구성을 실계정 운영에 쓰면 전송 구간의 비밀번호·세션 보호가 부족하다. 다만 현재 서버가 이미 운영 HTTPS 구성으로 전환됐을 수 있으므로 ‘지금 운영 서버가 HTTP다’라고 단정하지 않는다.

**개선:** 실사용 환경은 TLS 종단, WEB/SITE/미디어 origin, secure cookie를 함께 검증하고 위험한 조합은 시작을 거부한다. HTTP 개발 환경은 명시적으로 구분한다. 스테이징도 실데이터를 쓰면 동일 기준을 적용한다. 데모 seed는 명시적 opt-in으로 통일한다.

**완료:** 실제 외부 응답의 TLS·리다이렉트·쿠키를 점검하고, HTTP/secure=false production 조합의 시작 실패 테스트를 둔다. JWT 헤더 하나만 보고 TLS 완료로 판단하지 않는다.

### SEC-02 · P1 · 삭제 TODO가 그룹 전체 복제에 포함될 수 있음 — 코드 확인

**근거:** `apps/api/src/mungsil.service.ts:310`의 `removeTodo`, `:215`의 `cloneTodoList`, `:1450`의 `readableTodoList`, `:1484` 부근의 `serializePost`.

단일 TODO 읽기와 게시물 직렬화는 `deletedAt`을 제외하지만, 그룹 읽기는 `items.todo`를 삭제 조건 없이 포함하고 그룹 복제는 모든 항목의 제목·메모 등을 새 TODO로 만든다. TODO 소프트 삭제는 그룹 연결을 제거하지 않는다. 단일 게시 링크가 없는, 공개/게시된 그룹 안의 항목을 삭제한 경우 이 차이가 문제다.

**영향:** 화면에서 사라진 항목이 다른 사용자의 전체 가져오기를 통해 되살아날 수 있다. 개인정보가 든 메모도 함께 복사될 수 있다.

**개선:** 복제 가능한 항목을 서버에서 공통으로 계산한다. 소유자 복구 권한과 다른 사용자의 복제 권한을 분리하고 삭제 항목은 공개 조회/검색/그룹 복제/직접 ID 접근에서 동일하게 제외한다. 검사와 복제 사이 동시 삭제도 트랜잭션 정책으로 처리한다.

**완료:** A의 공개 그룹 안 TODO를 삭제 → B의 그룹 복제 결과에 해당 제목/메모/발생 일정이 없음. 실제 PostgreSQL 통합 테스트로 증명한다.

### SEC-03 · P1 · 관리자 역할 변경이 기존 access token에 즉시 반영되지 않음

**근거:** `apps/api/src/auth.ts:54–59`, `apps/api/src/controllers.ts:168–169`.

Guard는 세션과 계정 정지/탈퇴를 확인하지만 요청의 role은 JWT 발급 당시 값을 사용한다. AdminController는 그 값을 허용 판단에 사용한다. DB에서 관리자를 USER로 바꾸면서 세션을 별도로 폐기하지 않으면 access token 수명 동안 기존 관리자 권한이 남을 수 있다.

로컬 합성 검사에서도 `accepted:true`, `effectiveRole:ADMIN`, `currentDatabaseRoleRead:false`를 확인했다. 이는 ‘USER가 ADMIN 토큰을 위조할 수 있다’는 의미가 아니다.

**개선:** 권한 있는 작업마다 활성 사용자에서 현재 role을 읽어 서버 principal을 구성한다. 역할 변경은 세션/권한 버전 무효화와 결합한다. 관리자 권한 검사와 일반 계정 검사 정책을 공통화한다.

**완료:** ADMIN→USER 변경 직후 기존 토큰의 관리자 API가 403, 정지/탈퇴는 401, 일반 사용자 API는 정책대로 동작한다. JWT role만 바꾼 위조 토큰도 거부된다.

### SEC-04 · P1 · 개인 사진의 긴 캐시와 서비스 워커 전역 캐시

**근거:** `apps/api/src/media.service.ts:141,151,240`, `apps/web/public/sw.js`, `apps/web/lib/api.ts:100–113`.

이미지는 `private, max-age=31536000, immutable`로 저장하고 GET 서명 URL은 최대 1시간 유효하도록 생성한다. 앱의 권한 회수와 이미 발급한 객체 URL의 효력은 별개다. 특히 서비스 워커는 같은 origin의 이미지 응답을 공용 shell cache에 넣고 TTL·계정 구분을 두지 않는다. 로그아웃은 계정별 API cache만 지우며 shell cache는 유지한다.

학교 프록시처럼 개인 미디어가 같은 origin으로 전달될 때 서비스 워커 경로가 적용된다. AWS S3의 별도 origin에는 이 SW 경로가 적용되지 않지만 HTTP 캐시·URL 유효기간 문제는 따로 남는다. 인증/재설정의 token query가 있는 navigation URL도 일반 캐시 대상이 될 수 있다.

**개선:** SW는 허용된 정적 앱 자산만 캐시하고 개인 미디어·인증 경로·민감 query는 제외한다. 기존 cache migration/삭제를 포함한다. 비공개·채팅·신고 사진은 짧은 URL과 적절한 `no-store` 또는 제한적 캐시를 사용한다. 즉시 권한 회수가 필요한 자료는 매 요청 권한 검사하는 전달 경로를 설계한다.

**완료:** 계정 A 이미지 열람→로그아웃→B/오프라인에서 캐시로 재노출되지 않음. 권한 취소 후 신규 URL 발급 거부와 기존 URL의 잔여 수명을 구분해 테스트한다. 이미 사용자가 다운로드한 파일까지 회수할 수 있다고 약속하지 않는다.

서명 URL은 소유자가 사용할 수 있는 bearer credential이며 유효기간 동안 재사용 가능하다. [AWS S3 공식 설명](https://docs.aws.amazon.com/AmazonS3/latest/userguide/using-presigned-url.html)

### SEC-05 · P1 · 이미지 변환 후 원본 삭제 실패를 추적하지 않음 — 코드 확인

**근거:** `apps/api/src/media.service.ts:155–174`, `cleanupIncompleteUploads`.

변환 후 업로드 원본 삭제 실패를 `.catch(() => undefined)`로 무시한 뒤 DB의 `objectKey`를 변환 파일 경로로 바꾼다. 이후 정리 작업은 DB에 기록된 키만 알기 때문에 실패한 원본을 다시 찾지 못할 수 있다. 중간 파생 파일 쓰기 실패·완료 동시 호출도 고아 객체를 만들 수 있다.

**영향:** 원본 사진과 그 안의 위치/기기 메타데이터가 의도보다 오래 남고 스토리지 사용량도 누락된다. 변환본의 메타데이터 제거만으로 원본 파기까지 보장되지는 않는다.

**개선:** 원본 키·파생 키와 삭제 상태를 추적하는 정리 작업/outbox를 둔다. `uploads/` prefix의 짧은 객체 수명 정책을 보조 안전장치로 사용하고, 작업 DB와 객체 저장소 대조 점검을 추가한다.

**완료:** 원본 DeleteObject 실패→재시도 성공까지 추적 행 유지. 처리 중 어느 단계에서 실패해도 원본/파생 파일이 정해진 기간 내 정리된다.

### SEC-06 · P1/P2 · 관리자 계정과 seed 수명 관리

**근거:** `auth.ts`, `controllers.ts:164` 이하, `apps/api/prisma/seed.cjs:20–49`, 운영/스테이징 Compose.

관리자 MFA·민감 행동 직전 재인증은 현재 코드에서 확인되지 않았다. seed는 기존 관리자 비밀번호도 다시 설정하지만 기존 세션을 함께 폐기하지 않는다. seed용 관리자 비밀번호가 API 상시 환경변수에도 전달된다.

**개선:** 관리자/모더레이터 MFA 또는 검증된 접근 게이트를 도입하고, 계정 제재·권한/보상 변경·민감 자료 열람은 최근 인증을 요구한다. 초기 관리자 생성은 일회성 bootstrap으로 분리한다. seed 재실행이 무심코 비밀번호를 덮지 않게 하고 변경 시 모든 기존 세션을 폐기한다. seed 비밀은 상시 API 환경에서 제거한다.

**완료:** 관리자 비밀번호만 알아도 MFA 없이 운영 API를 사용할 수 없어야 한다. MFA 복구·분실 처리와 관리자 잠금 해제 절차도 함께 검증한다. [OWASP MFA 지침](https://cheatsheetseries.owasp.org/cheatsheets/Multifactor_Authentication_Cheat_Sheet.html)

### SEC-07 · P2 · 쿠키 기반 인증 요청의 CSRF 방어 심화

**근거:** `auth.ts`의 로그인/Google/refresh/logout, `main.ts:35`.

SameSite=Lax와 CORS allowlist는 있지만 Origin/Referer·CSRF token 등 명시적인 쓰기 요청 검증은 확인되지 않았다. 대부분 업무 API는 메모리 bearer token을 쓰므로 모든 요청을 같은 CSRF 위험으로 묶으면 안 된다. 쿠키로 세션을 설정·갱신·종료하는 경로를 우선 검토한다.

**개선:** 브라우저 인증 쓰기 요청의 Origin과 요청 형식/Fetch Metadata를 검증하고 필요 시 CSRF token을 사용한다. Google 로그인에는 nonce 기반 요청 바인딩도 검토한다. 비브라우저 클라이언트와 localhost 예외는 명시적 정책으로 둔다.

**완료:** 허용되지 않은 origin·same-site 다른 origin·폼 전송·Origin 누락 정책을 테스트한다. CORS만으로 요청 실행 자체가 차단된다고 가정하지 않는다. 이번에는 실제 CSRF 악용을 재현하지 않았다. [OWASP CSRF 지침](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html)

### SEC-08 · P2 · 남용 방어가 단일 프로세스/IP에 집중됨

**근거:** `app.module.ts`, `auth.ts`의 Throttle, `media.service.ts:55–97`, `chat.gateway.ts:39`.

HTTP 제한은 기본 메모리 storage이고, 로그인/메일 등의 IP 제한은 있으나 계정·메일 주소별 누적 제한은 별도 확인되지 않았다. 업로드 quota는 합계 조회와 행 생성이 분리돼 동시 예약에 취약하다. 처리 동시성은 프로세스 로컬이며 같은 mediaId의 원자적인 PROCESSING 획득도 없다. Socket join에는 별도 입력 길이·호출 빈도 제한이 없다.

**개선:** Redis를 이용한 IP+계정/이메일 조합 제한, 메일 cooldown·일일 한도, 업로드 quota 원자 예약, 작업별 처리 잠금, 전역 worker 동시성, socket 연결/가입 제한을 단계적으로 적용한다. 이미지 업로드 URL의 크기 제한이 실제 S3/MinIO 요청에서도 강제되는지 검사한다.

**완료:** 프록시 뒤 사용자 구분, 공유 NAT의 정상 사용, 두 API 인스턴스, 동시 presign/complete, 재연결 폭주 테스트. 운영 서버에서 고부하 공격을 시도하지 않고 격리 환경에서 검증한다. [OWASP 업로드 지침](https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html)

### SEC-09 · P2 · 웹 HTML에 대한 CSP/프레이밍 방어 확인 필요

**근거:** `apps/api/src/main.ts`의 Helmet, `apps/web/next.config.ts`, `infra/Caddyfile`, `infra/Caddyfile.staging`.

Helmet은 API 응답에 적용된다. 웹 HTML을 전달하는 Next/Caddy 쪽에는 CSP 및 frame-ancestors/X-Frame-Options 설정이 확인되지 않았다. 외부 종단이 별도 헤더를 추가할 수 있으므로 실제 응답 확인이 필요하다.

**개선:** 웹 문서에 CSP Report-Only부터 적용해 Next 스크립트·Google 로그인·이미지·소켓 출처를 점검한 뒤 강제한다. frame-ancestors, object-src, base-uri와 인증 화면의 referrer 정책을 정한다. 무조건적인 `unsafe-inline`/와일드카드로 통과시키지 않는다.

**완료:** 클릭재킹 차단, 정상 Google 로그인, 이미지/소켓 허용, inline 주입 검사. 직접 XSS가 발견됐다는 뜻은 아니며 방어 심화 항목이다.

### SEC-10 · P1/P2 · 게시 시점과 원본 변경의 개인정보 공개 경계

**근거:** `mungsil.service.ts`의 `updateTodo`, `updateTodoList`, `serializePost`, `publicTodo`.

공개 게시물은 현재 원본 TODO/그룹을 참조하고 제목·메모·시간·반복을 직렬화한다. 게시 뒤 개인 메모를 수정하거나 그룹에 항목을 추가하면 기존 공개 게시물의 내용도 바뀔 수 있다. 그룹 또는 TODO의 공개 범위를 바꿔도 연결된 공개 게시물의 허용 경로가 남을 수 있다.

**개선:** 기본 추천은 게시 시점의 공개 snapshot을 저장하고 재게시/명시적인 공개 수정으로만 갱신하는 방식이다. 실시간 원본 연동을 유지하려면 영향 안내와 공개 범위 전파 정책을 확정한다. 메모·시간을 항상 공개할지 항목별 동의를 정한다.

**완료:** 게시 뒤 비공개 원본 수정이 의도치 않게 외부로 전파되지 않는다. PUBLIC/FOLLOWERS/PRIVATE, 그룹/원본/게시물의 조합별 조회·검색·복제 표를 테스트한다. 이는 정책 결정이 포함된 개인정보 위험이며, 현재 모든 PRIVATE TODO를 누구나 조회할 수 있다는 뜻은 아니다.

### SEC-11 · P2 · 관리자 열람 최소화와 로그의 민감정보 처리

**근거:** `mungsil.service.ts:1202`의 관리자 콘텐츠 조회, `challenge-chat.service.ts:214`의 신고 맥락 조회, `main.ts:19–28`.

신고된 채팅 맥락은 감사 기록을 남기는 좋은 구조다. 반면 관리자 콘텐츠 검색은 공개 범위 제한 없이 게시물/댓글 미리보기를 반환하고 이 조회 자체의 감사는 확인되지 않았다. 요청 로그는 `originalUrl`을 그대로 저장하므로 검색어 등 query가 남는다. 클라이언트 제공 request ID도 길이/형식 검증 없이 사용한다.

**개선:** 비공개 자료는 사건/신고 기반 최소 열람으로 제한하고 민감 조회를 감사한다. query allowlist 또는 마스킹, request ID 길이·문자 제한, 로그 접근 분리·보유 기간·경보를 적용한다. 토큰, 쿠키, SMTP 자격 증명, 서명 URL을 로그에 남기지 않는다.

**완료:** 일반 운영 목록에 비공개 본문이 무분별하게 나타나지 않고, 허용된 조사 열람은 누가/왜/무엇을 봤는지 남는다. JSON 로그를 쓰므로 확인 없이 ‘로그 줄바꿈 주입 성공’으로 분류하지 않는다.

### SEC-12 · 운영 확인 필요 · DB/스토리지/백업 최소 권한과 공유 호스트 경계

**근거:** `infra/docker-compose*.yml`, `infra/backup-to-s3.sh`, `infra/systemd/mungsil-backup.service`, `infra/DEPLOY.md`.

앱 실행과 DB migration이 같은 DB 자격 증명을 쓴다. 학교 구성은 MinIO root 계정을 API에도 전달한다. AWS 백업 유닛은 앱 `STORAGE_BUCKET`의 `backups/database/`에 DB 덤프를 저장한다. 실제 IAM 정책이 저장소에 없어 앱 역할이 백업 읽기/삭제까지 가능한지는 미확인이다.

**개선:** 런타임 DB 최소 권한과 migration 계정을 분리한다. MinIO는 버킷/prefix 한정 앱 계정을 사용한다. 백업은 별도 버킷/역할·보유 정책·암호화·복원 권한으로 분리하고 앱 역할의 백업 읽기/삭제를 거부한다. AWS 인스턴스 역할이 모든 컨테이너에 과도하게 노출되는지도 확인한다.

학교에서 여러 사람이 rootful Docker 데몬을 함께 관리한다면 Compose 이름/내부망은 그 관리자들에 대한 보안 경계가 아니다. Docker group은 root 수준 권한을 준다. 실개인정보 서비스는 전용 VM/호스트 또는 검토된 별도 실행 경계로 분리하는 것을 권장한다. 현재 사용 호스트와 실제 권한은 확인이 필요하다. [Docker 공식 경고](https://docs.docker.com/engine/install/linux-postinstall/)

**완료:** 앱 권한으로 다른 프로젝트·백업·관리 작업 접근 불가. DB/Redis/스토리지 관리 포트 외부 비노출, Docker socket 미탑재, 최소 권한 IAM/DB 거부 테스트.

### SEC-13 · P2 · 비밀값·공급망·Android 릴리스 검증

추적 파일명에서 실제 `.env`/대표 서명키 파일은 발견하지 않았다. 그러나 전체 Git 이력 비밀 탐지는 별도다. `.dockerignore`는 `.env`/pem은 제외하지만 Android `keystore.properties`, jks/keystore에 대한 명시적인 제외는 없다. 현재 Dockerfile의 명시적 COPY는 최종 이미지 혼입 위험을 줄인다. 이것만으로 키가 유출됐다고 판단하지 않는다.

**개선:** Git 이력 포함 secret scanner, Android 서명 자료의 Docker context 제외, 알려진/재사용 비밀값 교체 정책, 이미지 digest 기록·OS 이미지 스캔·SBOM·의존성 갱신 체계를 추가한다. CI action을 검토된 commit SHA로 고정하는 방안도 적용한다.

Android는 `allowBackup=false`, HTTPS 앱 링크, 릴리스 서명 누락 시 실패가 있다. 추가로 릴리스 서명 fingerprint/assetlinks 실제 일치, debug 신뢰 제외, keystore 접근·복구, WebView fallback의 링크/TLS 처리와 Android 의존성을 검증한다. 웹 npm audit 결과에 Android 보안을 포함하지 않는다.

### SEC-14 · P1 배포 게이트 · 실제 보안 테스트와 복구 증거 부족

기존 테스트는 통과했지만 실제 DB E2E는 이번에 건너뛰었다. CI는 PostgreSQL 서비스가 있으나 완전한 Redis·스토리지·SMTP·브라우저 다계정 환경을 전부 제공하는 구성은 아니다. 복원 문서 존재와 복원 성공은 다르다.

**개선:** 격리 PostgreSQL/Redis/MinIO/Mailpit과 사용자 A/B·관리자·모더레이터·비회원 테스트 행렬을 구성한다. 아래 회귀 목록을 CI와 배포 승인 절차에 연결한다. 합성 데이터만 쓰고 운영 테스트로 다른 프로젝트를 건드리지 않는다.

## 5. 구현 순서와 배포 승인 조건

| 단계 | 작업 | 완료 증거 |
| --- | --- | --- |
| 0. 운영 사실 확인 | 적용 Compose, TLS 종단, 쿠키, 호스트 공유 권한, IAM/S3/DB/백업 정책 확인 | 설정 원문 비밀은 제외한 점검 기록 |
| 1. 데이터/권한 결함 | SEC-02/03/04/05 수정, SEC-10 정책 확정 | 실제 DB·스토리지 실패 주입·브라우저 회귀 |
| 2. 계정/남용 방어 | SEC-06/07/08, 운영 환경 fail-closed | MFA·CSRF·세션·동시 요청 거부 테스트 |
| 3. 운영 최소 권한 | SEC-09/11/12/13 | 응답 헤더, IAM/DB 권한 거부, 시크릿/이미지 검사 |
| 4. 최종 검증 | SEC-14, 복원·침해 대응 훈련 | 테스트 결과·복원 RPO/RTO·경보 수신 기록 |

**실사용 배포 보류 조건:** 실계정 HTTP 운영, 삭제 데이터 복제 재현, 관리자 역할 회수 실패, 개인 미디어/백업의 부적절한 접근, 기본 관리자 비밀번호 사용, 백업 복원 불가 중 하나라도 남으면 배포를 승인하지 않는다.

모든 개선을 일괄 큰 변경으로 만들지 않는다. 단계별로 migration/API/웹 호환성을 확인하고, 기존 인증·캐시·UI 개선은 보존한다. 외부 설정이 필요한 항목은 ‘수정 완료’가 아니라 ‘운영 확인 대기’로 기록한다.

## 6. 필수 보안 회귀 테스트

### 인증/권한

- 만료/재사용 검증·reset·refresh 토큰 거부, refresh 동시 요청과 세션 회수.
- ADMIN→USER 역할 변경 직후 기존 토큰 거부, 정지/탈퇴 사용자 HTTP·Socket 접근 거부.
- 관리자 MFA·복구·최근 재인증, seed 비밀번호 변경 시 기존 세션 폐기.
- 허용되지 않은 Origin/same-site 다른 origin의 로그인/refresh/logout 거부 정책.
- Google 잘못된 audience/서명/미인증 이메일/nonce, 자동 계정 연결 거부.

### 데이터 공개/복제

- 비회원/A/B/팔로워/차단 관계별 게시물·댓글·그룹·검색·직접 ID·복제 일관성.
- 소프트 삭제 항목이 전체 그룹 복제로 복구되지 않음.
- 게시 후 원본/메모/그룹 구성 변경과 PRIVATE 전환의 외부 노출 정책.
- 채팅 비참여/탈퇴/종료/제재/신고 열람 권한, 관리자 조회 감사.

### 미디어/자원

- 타인 mediaId, 중복 연결, READY 이전 사용, 4장 초과, 형식 위장, 과도한 픽셀/바이트 거부.
- 동시에 quota 예약·같은 mediaId complete·부분 객체 쓰기/삭제 실패 처리.
- URL 발급 권한·만료·기존 URL 잔여 유효기간, 로그아웃/오프라인 캐시 노출 방지.
- 토큰 query/개인 미디어 SW 캐시 제외, 계정 전환 늦은 응답 차단.
- IP/계정/메일별 제한, 실제 프록시 IP 처리, Socket join 크기·빈도 제한.

### 운영/복구

- TLS·secure cookie·CSP·프레이밍·CORS 실제 응답.
- 앱 계정으로 DB 관리/다른 버킷/백업 읽기·삭제 불가.
- 암호화 백업의 격리 복원과 데이터 참조 무결성.
- 비밀 노출 시 JWT/SMTP/스토리지 키 회전, 세션 폐기, 이미지 롤백과 로그 조사.
- secret scan·npm/Android/이미지 의존성 검사. 검사 시점과 제외 범위를 기록.

권한은 기본 거부하고 객체별 요청마다 검사한다. 이 원칙은 읽기뿐 아니라 검색·복제·서명 URL 발급에도 적용한다. [OWASP Authorization 지침](https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html)

## 7. 구현 전에 확정할 운영 정보

1. 실제 사용자가 접속하는 배포가 AWS 운영 Compose인지, 학교 스테이징인지, 다른 구성인지.
2. 실제 TLS 종단과 호스트 관리자/Docker 접근 권한을 가진 사람의 범위.
3. 관리자 MFA 수단과 복구 담당자.
4. 공개 게시의 snapshot 정책 및 비공개 전환이 기존 게시물에 미치는 영향.
5. 사진·채팅·신고 증거·감사 로그·백업 보유 기간과 복원 목표.

보유 기간은 임의로 법적 적합성을 확정하지 않는다. 운영 주체와 담당자가 정책을 확정한 뒤 자동 파기·접근 기록·사용자 안내를 맞춘다.
