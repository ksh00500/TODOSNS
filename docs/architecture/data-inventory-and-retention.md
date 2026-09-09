# 데이터 인벤토리와 보유 정책

상태: 2026-09-08 로컬 구현 기준. 이 문서는 법률 승인서나 운영 보유기간 승인서가 아니다. 기간이 확정되지 않은 항목은 `정책 검토 대기`로 표시하며, 신규 분석 수집과 외부 제공은 기본 OFF다.

## 분류 원칙

- L0 공개 가능: 사용자가 해당 범위로 게시했고 현재 공개가 허용된 프로필·게시물, 또는 별도 검토를 통과한 익명 집계. 원본과 연결된 비공개 필드는 포함하지 않는다.
- L1 소유자·참여자 한정: 비공개 TODO, 그룹, 대화, 인증 사진, 알림, 관계 정보. 요청마다 소유·참여·차단·상태를 검사한다.
- L2 식별·인증 제한: 이메일, 생년월일, 비밀번호·토큰 해시, 세션, IP 파생값, 목적별 연결표. 일반 분석과 반출에서 제외한다.
- L3 운영 특별 제한: 신고 원문과 증거, 관리자 조사 맥락, 제재 사유, 파기·반출 증빙. 운영자 역할만으로 포괄 열람할 수 없고 사건·목적별 권한과 감사가 필요하다.
- 법률상 민감정보는 L등급과 별도 축이다. TODO/메모/채팅/사진에서 건강·정치·종교·성생활 등 정보가 자유서술로 들어올 수 있어 `민감정보 포함 가능`으로 처리한다. 실제 해당 여부와 처리 근거는 전문 검토 대기다.
- 가명정보는 개인정보로 관리한다. 이름 제거, 이메일 해시, 연령대 변환, 목적별 subject key만으로 익명정보가 되지 않는다.

## 모델·필드 인벤토리

| 원천 모델·필드 | 주체/등급 | 성격 | 운영 목적과 최소 필드 | 분석/제공 | 위치와 파기 |
| --- | --- | --- | --- | --- | --- |
| `User.id` | 회원/L2 | 직접 연결 키 | 계정과 서비스 행의 참조 무결성 | release 금지; restricted 매핑에서만 목적별 변환 | 현재 `public.User`; 탈퇴 시 종속 개인행 삭제, 공동 기록 FK는 정책에 따라 SetNull |
| `User.email,passwordHash,googleId,birthDate,emailVerifiedAt` | 회원/L2 | 식별·인증, 생년월일 | 로그인, 복구, 연령 제한 | 기본 제외. 승인된 연령 지표만 활동 당시 연령대로 계산하며 생년월일 복사 금지 | 현재 `public.User`, expand shadow `identity.AccountIdentity`; 탈퇴 시 양쪽 삭제 |
| `User.nickname,handle,bio,interests,avatarUrl/avatarMediaId,timezone` | 회원/L0~L2 | 프로필·자유서술·설정 | 프로필 표시, 추천, 시간대 계산 | 닉네임·핸들·bio·URL 금지. 표준 관심 카테고리도 별도 목적 승인 필요 | `public.User`, expand shadow `service.ServiceProfile`, Media/S3; 탈퇴 시 삭제. 공개 표시 범위는 별도 정책 |
| `User.role,suspendedAt,suspensionReason,deletionRequestedAt` | 회원/L2~L3 | 권한·제재·수명 | 접근 차단, 운영 조치, 파기 기산 | 분석/반출 금지 | `public.User`; 탈퇴/제재 처리 후 최소 감사만 별도 보존, 기간 정책 대기 |
| `User.availablePoints,lifetimePower,recentVitality` | 회원/L1 | 개인 활동 요약 | 보상·등급 표시 | 개인값 반출 금지. 익명 집계 후보는 별도 승인 | `public.User`; 탈퇴 시 삭제 |
| `Session.*` | 회원/L2 | 인증 비밀·기기/IP 파생 | refresh 회전, 세션 회수 | 금지 | `public.Session`; 만료/폐기 정리. 기존 7일 정리는 구현값이며 법적 승인 아님 |
| `VerificationToken.*` | 회원/L2 | 인증 비밀 | 이메일 인증·비밀번호 재설정 | 금지 | `public.VerificationToken`; 사용·만료 후 정리 |
| `InviteCode.codeHash,label,uses,maxUses,expiresAt` | 운영/L2~L3 | 초대·운영 정보 | 초대 가입과 사용량 | 원문/해시 반출 금지 | `public.InviteCode`; 운영 필요 종료 후 기간 정책 대기 |
| `IdempotencyKey.key,route,requestHash,response` | 회원/L2 | 요청 재생 방지·응답 사본 가능 | 변경 요청 중복 방지 | 금지 | `public.IdempotencyKey`; `expiresAt` 정리, 응답 allowlist 필요 |
| `Todo.title,notes,category/categoryId,dueDate,repeatRule,completedAt,visibility` | 회원/L1, 게시 승인분 L0 | 자유서술·행동 | TODO 생성·완료·게시·가져오기 | 원문/정확 시각/사용자 정의 카테고리 금지. 넓은 표준 카테고리 월 집계만 후보 | `public.Todo`; soft delete는 복구용, 탈퇴·보유 만료에는 실제 삭제 |
| `Todo.sourceTodoId,seriesId,occurrenceKey` | 회원/L1 | 관계·행동 연결 | 복제·반복 멱등성 | release 금지 | `public.Todo`; FK 유지, 삭제 TODO의 외부 조회·복제 차단 |
| `TodoSeries.*`, `TodoCategory.*` | 회원/L1 | 루틴·분류, 사용자 정의명 | 반복 발생·개인 분류 | 사용자 정의명 금지; broad category만 후보 | `public`; 탈퇴 시 cascade, archived는 파기 아님 |
| `TodoList.*`, `TodoListItem.*` | 회원/L1, 게시 승인분 L0 | 그룹·관계 | 그룹 표시·게시·가져오기 | 원문 그룹명/설명 금지 | `public`; 삭제 TODO는 목록·복제에서 제외, 탈퇴 시 소유 자료 삭제 |
| `Post.snapshot,snapshotSearchText,snapshotCategories,sourceAccessRevokedAt,snapshotErasedAt` | 작성자/L0~L1 | 게시 시점 TODO/루틴 snapshot·검색 파생 | 피드 표시·검색·가져오기 | 원문 반출 금지; 집계 후보만 별도 승인 | `public.Post`, Media/S3. 원본 범위 축소 시 신규 접근·검색·이미지 URL·가져오기 차단, 게시·원본 삭제와 탈퇴 시 snapshot 파기 |
| `PostTodo,PostTag,Tag.name` | 작성자/L0~L1 | 게시 관계·사용자 입력 | 게시 구성·검색 | 원문 태그/희귀 조합 반출 금지 | `public`; 연결 게시물과 함께 삭제/숨김 정책 적용 |
| `Cheer,Comment.body` | 회원/L0~L1 | 소셜 행동·자유서술 | 응원·댓글 | body 금지; 월별 건수 후보만 승인 후 | `public`; 탈퇴 시 개인 작성분 삭제, 공동 맥락 보존 여부 정책 대기 |
| `Follow,Block` | 회원/L1 | 사회관계 | 공개 범위·차단 검사 | 금지 | `public`; 탈퇴 시 cascade |
| `MessageRequest.*` | 두 회원/L1 | 대화 요청 관계 | 요청 수락·거절 | 금지 | `public`; 탈퇴 시 cascade |
| `Conversation,ConversationMember,ConversationMute` | 참여자/L1, 제재사유 L3 | 참여·읽음·제한 | 대화 권한과 알림 | 금지 | `public`; 90일은 구현값. 공동 기록 정책·기산점 승인 대기 |
| `Message.body,replyToId,deletedAt,hiddenAt,hiddenReason` | 참여자/L1, 신고 맥락 L3 | 자유서술·수정/삭제 | 대화·신고 처리 | 전부 분석/반출 금지 | `public`; 삭제 placeholder와 실제 원문/리비전 파기를 구분 |
| `MessageRevision.body` | 참여자/L1/L3 | 과거 원문 | 수정 이력·신고 필요 범위 | 금지 | `public`; 목적 종료/탈퇴/대화 보유 만료 시 삭제, 예외 보존은 별도 승인 |
| `MessageReaction` | 참여자/L1 | 행동 | 대화 반응 | 승인 전 금지 | `public`; 대화 수명과 함께 삭제 |
| `Challenge.*` | 작성자·참여자/L0~L1 | 공개 설명·운영 규칙 | 챌린지 운영 | 넓은 월 참여/완주 지표 후보 | `public`; 작성자 탈퇴 시 `creatorId` SetNull, 본문 개인정보 정책 대기 |
| `ChallengeParticipant,PointLedger` | 회원/L1 | 참여·보상·금전성 기록 | 순위·보상·포인트 | 개인행 금지; 제한된 집계 후보 | `public`; 탈퇴 시 cascade. 실제 거래/법정 보존 여부 검토 대기 |
| `ChallengeCheckIn.note,mediaKey,status,review*` | 회원·검수자/L1~L3 | 인증 원문·판정 | 챌린지 인증·신고 | 사진/메모/정확 날짜 금지 | `public`, Media/S3; 원본·파생·버전 모두 파기 추적 |
| `ChallengeVerificationVote.*` | 검수 참여자/L1 | 판정·행동 | 다수 검수 | 개인행 금지 | `public`; 인증 수명과 함께 삭제 |
| `Report.reason,resolution,target*,reporterId,resolverId` | 신고자·대상/L3 | 신고 원문·조사 | 사건 처리 | 분석/일반 운영 목록/반출 금지 | `public.Report`; 사건별 근거·기간·열람 감사 정책 대기 |
| `AdminAuditLog.*` | 운영자·대상/L3 | 운영 증빙 | 관리자 행동 책임성 | 일반 분석/반출 금지 | `public.AdminAuditLog`; 사용자 삭제 시 adminId SetNull. 기간 승인 대기 |
| `Notification.title,body,target*` | 회원/L1 | 개인 알림·파생 원문 | 알림 표시 | 금지 | `public.Notification`; 탈퇴 시 cascade, 대상 삭제 시 정합성 점검 |
| `Media.objectKey,thumbnailKey,originalName,mimeType,size,width,height,status,owner/links` | 회원/L1~L3 | 객체 위치·원본 메타 | 업로드·소유·파생·삭제 | URL/사진/원본명 금지 | DB `public.Media`, 비공개 객체 저장소. 원본·썸네일·과거 버전·복제본을 함께 삭제 |
| `identity.PurposeSubjectMap.*` | 회원/L2 | 목적별 가명 매핑 | 승인된 restricted 집계의 삭제·멱등 연결 | 분석가/release 접근 금지 | 목적 만료·탈퇴 시 cascade 삭제, `expiresAt` 필수 |
| `analytics_restricted.AnalyticsEvent.*` | 회원/L2 가명 | 최소 행 수준 중간자료 | 승인된 월 집계 | 직접 제공 금지 | purpose/map과 FK, 만료 필수. 현재 수집 OFF |
| `MonthlyAggregate,AggregateReview` | 집단/L1~L2 가능 | 검토 전 집계 | 월말 품질·재식별 검토 | 승인 전 제공 금지 | restricted. 소수/차분 위험 검토 후에만 release 복사 |
| `DatasetRelease,AggregateMetric,ReleaseReview,ExportAudit` | 집단/L0 후보, 감사 L3 | 검토 결과·반출 증빙 | 별도 승인된 제공 | 기본 OFF; 개인 키/FK/원문 금지 | release/governance. 외부 전송은 별도 승인 전 없음 |
| `ErasureRequest,ErasureTask,ObjectDeletionTask` | 탈퇴자/L2~L3 | 파기 진행·최소 증빙 | 멱등 파기·재시도 | 금지 | governance. 완료 후 object key 등 세부 증빙의 후속 최소화 기간 승인 필요 |

## 사본과 처리 위치

| 위치 | 포함 가능 데이터 | 통제/파기 시험 |
| --- | --- | --- |
| PostgreSQL | 위 모든 운영 행, governance/restricted/release | FK/행수 전후 비교, 역할별 실제 허용·거부, 탈퇴 cascade·SetNull 검증 |
| 객체 저장소 | 업로드 원본, full/thumbnail, 과거 version/delete marker 가능 | 모든 version·파생본 삭제, Head/List 재확인, 403/잠금/복제 잔존은 실패 |
| Redis | 요청 제한·일시 상태; 현재 사용자 원문 캐시 없음 | 키 prefix 인벤토리 후 계정 파기 테스트 필요 |
| 브라우저 Cache Storage | 정적 shell과 계정별 제한 API cache | SW는 정적 allowlist만 사용, 계정 전환 cache 삭제·오프라인 재노출 거부 |
| 로그 | 경로, 상태, request ID, 최소 오류 코드 | query/토큰/쿠키/서명 URL/본문 금지, 접근·보유기간 정책 대기 |
| 백업 | DB dump, 승인된 미디어 복구본 | 일반 API·분석가 접근 거부, 격리 복원 후 미처리 삭제 요청 재적용 설계 필요 |
| 검색 인덱스/CDN/외부 복제 | 현재 별도 시스템 확인 안 됨 | 도입 전 inventory 등록과 삭제 API/증빙 필수 |

## 보유 정책 승인 대기

- 탈퇴에는 일률적인 7일 유예를 적용하지 않는다. 90일 대화 purge와 14일 로컬 백업 삭제 등 다른 구현값도 법정 허가로 확정하지 않으며, 미확정을 무기한 보유로 해석하지 않는다.
- 기존 사진·채팅 기능은 계속 제공하지만 처리 근거와 보유기간은 별도 승인 대상으로 관리한다.
- 사진·채팅·신고 증거·감사 로그·보안 로그·백업·파기 증빙의 기산점과 기간은 운영 주체·법률 검토가 필요하다.
- 예외 보존은 기본 OFF다. 사건, 근거, 승인자, 대상, 만료일, 접근 역할이 없는 예외는 만들지 않는다.
- 기존 실제 데이터의 새 분석 목적 이용, 과거 backfill, 기존 사용자 동의 생성은 금지한다.

## 파기 검증 기준

1. 탈퇴 요청 즉시 세션·소켓과 신규 공개/분석 적재를 차단한다.
2. 승인된 유예가 끝나면 DB, 개인별 restricted 자료, 원본·파생·version 객체를 삭제한다. 분석 장애는 파기를 막지 않는다.
3. 객체 삭제가 확인되기 전 `Media` 또는 `ObjectDeletionTask` 추적 정보를 없애지 않는다.
4. 공동 기록은 FK와 본문 의미를 함께 검토한다. `SetNull`만으로 본문 개인정보가 사라졌다고 보지 않는다.
5. 이미 승인된 익명 집계와 개인별 중간행을 구분한다. 월말이나 집계 성공을 기다리기 위해 원문을 보관하지 않는다.
6. 복원 환경에서는 삭제 요청 재적용이 끝나기 전 서비스 트래픽과 분석 수집을 열지 않는다.
