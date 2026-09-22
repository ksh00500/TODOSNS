# 관리자 MFA·민감 작업 재인증 후속 구현 계획

상태: 설계·구현 계획. MFA가 구현됐거나 운영에 적용됐다는 의미가 아니다.

## 현재 접근 경로

- 로그인은 이메일/비밀번호 또는 Google 인증 뒤 `Session`과 access/refresh JWT를 발급한다.
- 매 요청의 `JwtAuthGuard`는 세션의 활성 상태와 현재 DB 역할을 다시 읽는다. `/admin`은 컨트롤러 안에서 `ADMIN` 또는 `MODERATOR` 문자열만 검사한다.
- 현재 스키마에는 MFA credential, recovery code, 최근 재인증 시각, 인증 강도 정보가 없다. 관리자 API에도 step-up guard가 없으므로 로그인 세션 탈취 시 별도 확인 없이 민감 작업을 수행할 수 있다.

## 도입 방식

1. 초기 수단은 표준 TOTP로 제한한다. 서버가 생성한 secret은 애플리케이션 암호화 키로 envelope encryption해 저장하고 평문·QR payload를 로그나 분석 이벤트에 남기지 않는다. WebAuthn은 별도 후속으로 둔다.
2. `MfaCredential(userId, encryptedSecret, verifiedAt, disabledAt)`과 일회용 해시 recovery code, `Session.authenticatedAt`, `Session.mfaVerifiedAt`, `Session.reauthenticatedAt`을 추가 migration으로 만든다. 기존 적용 migration은 수정하지 않는다.
3. ADMIN/MODERATOR 로그인은 1차 인증 성공 후 제한된 `mfa_pending` 교환 토큰만 발급한다. TOTP 또는 recovery code 성공 뒤에만 일반 세션을 만든다. 관리자 역할 부여 전에 MFA 등록 완료를 서버에서 강제한다.
4. 민감 작업은 별도 `AdminStepUpGuard`로 `mfaVerifiedAt`과 최근 재인증(권장 기본 10분)을 확인한다. 일반 관리자 조회와 민감 변경을 분리하고, 응답은 `ADMIN_REAUTH_REQUIRED` 같은 구조화된 코드로 통일한다.

## 적용 API

- ADMIN 전용: 초대 코드 생성·중지, 사용자 정지·해제와 전체 세션 폐기, 역할 변경을 추가할 경우 그 API, 공식 보상 변경, 감사 기록 원문·내보내기, 개인정보/파기 운영 작업.
- ADMIN/MODERATOR: 신고 해결·기각, 게시물·댓글·대화 메시지 숨김·복구, 챌린지 참여자 채팅 제한·해제. 조회만 하는 현황·목록에는 기본 MFA 세션은 요구하되 매번 step-up을 요구하지 않는다.
- 계정 자체의 MFA 해제, recovery code 재발급, 이메일·비밀번호 변경은 항상 최근 재인증과 감사 기록을 요구한다.

## 복구 절차

- recovery code는 최초 한 번만 표시하고 각각 salt가 있는 해시로 저장하며 사용 즉시 폐기한다.
- 모든 수단을 잃은 경우 자동 이메일 해제를 제공하지 않는다. 최소 두 명의 승인된 운영자가 신원·요청 티켓을 확인하고 시간 제한 해제 요청을 생성하며, 수행자와 승인자를 분리해 감사 기록에 남긴다.
- 복구 완료 시 기존 세션과 recovery code를 모두 폐기하고 MFA를 다시 등록한다. break-glass 계정은 평상시 비활성, 별도 보관, 사용 즉시 경보·회전·사후 검토 대상으로 둔다.

## 테스트와 운영 설정

- 단위 테스트: TOTP 허용 오차, 재사용 방지, recovery code 단회성, 암호문만 저장, step-up 만료 경계.
- HTTP/DB E2E: 관리자 1차 로그인만으로 민감 API 거부, MFA 후 허용, 재인증 만료 뒤 재거부, 역할 강등·정지·세션 폐기 즉시 거부, 복구 후 기존 세션 폐기, 감사 기록 생성.
- 운영 설정: MFA 암호화 키는 DB/JWT 비밀과 분리한 secret file 또는 KMS에 두고 버전·회전 절차를 제공한다. 시간 동기화, 로그인/TOTP rate limit, 실패 경보, 관리자 MFA 등록률 모니터링을 배포 전 확인한다.
- 출시 게이트: 최소 두 관리자 복구 훈련과 합성 계정 E2E가 통과하기 전 관리자 화면을 인터넷에 공개하지 않는다.
