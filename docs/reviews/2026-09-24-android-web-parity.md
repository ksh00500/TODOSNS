# Android 웹 기능 대조 및 검증 기록

기준: 2026-09-24 로컬 웹 구현, Cloud Rhythm 디자인 시스템. 일반 사용자 28개 라우트와 시트/상태를 포함한다. 관리자 운영 센터는 제외하며 커뮤니티 작성자/방장 기능은 포함한다.

구현 상태와 검증 상태는 다르다. 아래 항목은 작업 범위이며 완료 선언이 아니다. 운영 서버 배포 및 Play 업로드는 이 작업과 분리한다.

| ID | 웹 기능 | Android 위치 | 계약/API | 확인할 상태와 권한 | 완료 증거 |
|---|---|---|---|---|---|
| AUTH | 시작·이메일·Google | AuthScreen / GoogleLogin / AccountFlows | auth/config, login, signup, google, verify-email, reset-password | 계정 충돌·추가 정보·만료·세션 복원·취소 | 로컬 회귀 검사 및 Play 실제 계정 검증 |
| NAV | 5탭·상세·로그인 복귀 | MainActivity | 공개/로그인 권한별 진입 | 탭 상태·상세 뒤로 가기·로그인 목적지·계정 전환 | Compose 탐색 테스트 |
| TODO | 오늘·일정·작성·반복 | TodosScreen | todos, complete, uncomplete, restore, series | 초안·일정·반복 범위·완료 복원·그룹/분류 보존 | 합성 HTTP + UI 테스트 |
| GROUP | 그룹·카테고리 | TodosScreen | todo-lists, me/todo-categories, reorder | 검색 밖 선택·순서·보관·목록·게시 | 합성 HTTP + UI 테스트 |
| FEED | 탐색·검색·게시물·댓글 | FeedScreen | feed, public/search, posts, comments, cheer | 최신/추천·필터·검색·응원 복원·추가 조회 | 두 계정 핵심 순환 |
| IMPORT | 게시·가져오기 | PublishSheet / TodoForm / RoutineImportSheet | feed/posts, todos/:id/clone, todo-lists/:id/clone | 사진·해시태그·공개 범위·항목별 날짜/시간/반복 | 요청 계약 + 실패/재시도 |
| CHALLENGE | 챌린지·인증·검수 | ChallengesScreen / ChallengeComposer | challenges, check-in, vote, resubmit, reverify | 개설 비용·작성자·종료·반려·기준별 판정 | 합성 상태별 UI + 다계정 통합 |
| CHAT | 대화함·1:1·챌린지 대화 | ChatScreen | messages, challenges/:id/chat | 차단·멤버십·수정·삭제·관리·재연결·읽음 | 합성 HTTP/소켓 + 실기기 |
| PROFILE | 프로필·관계·등급·배지 | ProfileScreen / ProfileDetails | me, public/users, social | 프로필 사진·관심사·연결·차단·등급 | 공개/본인/상대 상태 검사 |
| NOTICE | 알림·푸시 | NotificationsScreen / Push | me/notifications, me/push-devices | 명시적 읽음·계정·권한·대상 이동 | 로컬 + 실제 FCM 수신 |
| SETTINGS | 설정·약관·탈퇴 | SettingsScreen / LegalScreen | logout, logout-all, delete-account | 확인·실패·공유 법률 원문 | 로컬 UI + 웹 회귀 |
| MEDIA | 사진·링크 | PhotoPicker / AppLink | presign, complete / 허용된 HTTPS 링크 | 크기·타입·진행·실패·재시도·토큰 비저장 | 합성 업로드 + OS 실기기 |

## 라우트 대조

| 웹 | Android |
|---|---|
| `/challenges/[id]/chat` | `chat/challenge/{id}` · ChatScreen / ChatManagement |
| `/challenges/[id]` | `challenge/{id}` · ChallengeDetailScreen / ChallengeComposer / VerificationSheet |
| `/challenges` | `challenges` · ChallengesScreen |
| `/explore` | `explore` · FeedScreen / 피드 필터 시트 |
| `/explore/search` | `search?query=…` · SearchScreen |
| `/me` | `me` · ProfileScreen |
| `/me/rank` | `rank` · RankScreen |
| `/messages/[id]` | `chat/direct/{id}` · ChatScreen |
| `/messages` | `inbox` · InboxScreen / 요청 시트 |
| `/notifications` | `notifications` · NotificationsScreen / `push/{id}` 서버 재확인 |
| `/onboarding` | `onboarding` · OnboardingScreen |
| `/people/[handle]/connections` | `connections/{userId}/{direction}` · ConnectionsScreen |
| `/people/[handle]` | `profile/{handle}` · PublicProfileScreen |
| `/posts/[id]` | `post/{id}` · PostScreen / 댓글 |
| `/settings/blocked` | `blocks` · BlocksScreen |
| `/settings` | `settings` · SettingsScreen |
| `/today` | `today` · TodosScreen(today=true) |
| `/todos/categories` | `categories` · CategoriesScreen / CategoryOrderSheet |
| `/todos/import` | TodoForm(clone=true) / RoutineImportSheet · 원본 진입 화면에서 시트 |
| `/todos` | `todos`, `schedule/{date}` · TodosScreen(today=false) |
| `/todos/routines` | `groups` · GroupsScreen |
| `/forgot-password` | AuthScreen(mode=reset) |
| `/` | WelcomeScreen · 제품 소개/시작/공개 둘러보기 · 웹 미리보기 영역의 시각 동등성은 미완료 |
| `/privacy` | `legal/privacy` · LegalScreen / 공유 legal.json |
| `/reset-password` | EmailLinkScreen(reset-password) |
| `/start` | AuthScreen / GoogleLogin · 세부 시각 대조 남음 |
| `/terms` | `legal/terms` · LegalScreen / 공유 legal.json |
| `/verify-email` | EmailLinkScreen(verify-email) |

## 검증 기록

- 최초 상태: 앱에는 부분 구현만 있었으며 웹 전체 전환은 미완료였다.
- 실제 Play Google 로그인 실패 원인은 확인 전이다. 오류 분류·가입 자격 정보 유지 수정은 원인 확정과 별개다.
- 최저 API 24 / API 36 / Play 설치본 / 실제 FCM / 실제 스토리지는 개별 실행 결과를 기록한다.
- 테스트 데이터는 loopback 합성 HTTP에만 연결한다. Firebase provider를 기기 테스트 시작 때 해제하고 예약 작업을 취소한다.
- 미실행 검증과 미구현 항목은 최종 확인 절에 명시한다.

## 2026-09-25 진행 사항

### Google 무응답 재현 범위

사용자 보고는 **기존 계정을 고르면 선택 창만 닫히고 오류 표시가 없으며 재시도해도 반복**이다. 기존 계정이므로 신규 가입 정보 누락으로 원인을 단정하지 않는다.

- Credential Manager의 취소/결과 없음에 안내와 명시적인 대체 계정 선택 버튼을 표시한다.
- GoogleLoginModel이 작업과 ID 토큰을 메모리에서 관리한다. Compose 화면 재생성으로 HTTP 교환이 취소되거나 계정 선택을 반복하지 않는다. 프로세스가 종료되면 ID 토큰은 복원하지 않고 다시 선택한다.
- provider 취소, 120초 결과 미수신, 중복 클릭, 기존 계정 서버 세션 수신, 신규 가입의 ID 토큰 재사용을 구분해 검사한다.
- 최초 `/auth/google` 401을 세션 만료로 표시하지 않는다. 표시하는 진단 정보는 단계·HTTP 상태·서버 요청 ID이며 ID 토큰이나 개인정보를 기록하지 않는다.
- 앱 시작 때 게스트 판정만으로 Credential Manager 상태를 초기화하던 작업을 제거하고 명시적 로그아웃 때 수행한다.
- 실제 Play SHA-1과 Google Console의 Android OAuth 설정 일치, 실제 계정 선택 및 FCM은 아직 확인되지 않았다. 합성 테스트 성공을 실제 Google 로그인 해결로 취급하지 않는다.

### 추가 반영

- Navigation Compose 상세 뒤로 가기와 탭 상태, 계정 종료 시 저장 탐색 상태 제거, 로그인 목적지 복귀, 신규 계정 관심사 진입.
- 오늘 진행률/현재 할 일/목록, 완료 직후 게시, TODO 주간/월간 날짜 시트, 그룹·분류·반복 선택 시트 및 편집 초안 보존.
- 완료 요청 실패는 이전 상태로 복원하고 같은 요청 키로 재시도한다. 성공 후 다음 완료/취소는 새 요청 키를 사용한다.
- 탐색 필터는 적용 전 초안을 유지한다. 피드 카드의 작성자·사진/대체 기록·본문·태그·응원·댓글·가져오기 계층을 맞춘다.
- 사진 업로드 상태·재시도·제외·카메라 진입, 채팅 전송 시 미완료 사진 검사, 편집됨 표시.
- 카테고리 갤러리/전용 정렬, 프로필·인증 편집의 이탈 확인, 이메일 링크·약관 공유 원문.
- 푸시 탭은 현재 계정과 알림을 기존 API에서 재확인하고 서버가 반환한 허용 경로로 이동한다. GET 조회만 사용해 자동 읽음을 방지한다. 이 기능에 새 서버 API는 필요하지 않다.

### 완료 판정에서 제외할 항목

전체 웹 전환 완료 또는 정식 출시 후보 승인으로 판정하지 않는다. 특히 다음 항목은 더 필요하다.

1. 전체 28개 화면과 모든 시트/상태의 웹·앱 시각 대조 및 기능별 입력/검증/권한/결과 증거. 현재 공유 합성 캡처 대상은 오늘·TODO·탐색·게시물 4개다.
2. 랜딩의 전체 시각 구성, 상세 프로필/챌린지 결과, 채팅 복수 사진·읽음 표시, 루틴 항목 편집의 세부 UX 일치 여부와 남은 차이 해소. 소개 진입과 채팅 날짜 구분, 챌린지 결과 정보는 9월 28일 보완했다.
3. ViewModel/불변 StateFlow/명시 모델 전환은 Google·TODO에 우선 적용했다. 다른 화면 전체의 동일 구조 전환은 남아 있다.
4. 실제 두 계정으로 웹·앱 핵심 순환, 챌린지 반려/재인증, 소켓 단절 복구와 권한 전이를 검증하는 격리 통합 환경.
5. API 24 기기, 물리 기기 키보드/TalkBack/회전/프로세스 재생성 전수 검사. 화면 재구성 테스트는 프로세스 종료 시험을 대체하지 않는다.
6. Play 설치본 Google 기존/신규 계정 로그인과 실제 FCM 권한·전경/백그라운드 전달.

### 배포 경계

이번 작업에서 운영 서버 접속·배포·운영 DB 검증·Play 업로드는 수행하지 않았다. 기존 서버 API를 재사용한다. `assetlinks.json`의 Play 서명 지문 추가와 공유 약관 원문은 웹 호스팅 배포가 필요한 변경이며, Kotlin 앱 수정 배포와 구분한다. 기존 DB·푸시·Docker 미커밋 변경은 보존했다.

## 2026-09-28 후속 구현 및 내부 테스트 산출물

- WelcomeScreen으로 제품 소개 → 시작/공개 둘러보기 흐름을 분리하고 로그인 문구·브랜드 헤더·5탭 선택 표시를 웹 기준으로 보완했다.
- 탐색의 검색/필터는 헤더 아이콘으로 옮기고 작성자·카테고리·단일 TODO·사진/완료 정보·가져오기 카드의 공간을 조정했다.
- TODO 일정은 웹의 일정·그룹·카테고리 진입, 선택 날짜와 간결한 완료 행을 사용한다. 편집·게시·삭제·반복 종료는 항목별 NativeSheet 메뉴에 모았다.
- 글꼴 200%에서 입력 레이블 잘림과 TODO 이름의 중간 줄바꿈을 캡처로 발견했다. 공통 입력의 레이블을 위에 분리하고 접근성 이름을 연결했으며 큰 글꼴에서는 5탭을 두 행으로 표시한다.
- 기본 카테고리 숨김은 archived만 전송한다. 사용자 카테고리는 색상과 아이콘 선택을 제공하고 기존 값을 보존한다.
- 루틴 KEEP/NONE은 항목별 일정을 보내지 않아 서버의 원본 간격 계산을 보존한다. CUSTOM은 같은 상대 간격을 초기값으로 사용하고 모드 전환·저장 상태 복원 중 제목/날짜/시간/반복과 재시도 요청 키를 유지한다.
- 차단 대화 검사에서 측정 중 메시지 구간이 달라지는 LazyList IndexOutOfBoundsException을 재현했다. 메시지·날짜 구분·빈 상태 판단을 같은 불변 스냅샷으로 전달하고 지연 응답 검사를 보강했다.
- 챌린지 텍스트 편집은 기존 시작·종료 시간을 바꾸지 않는다. 성공률·검수 인원·순위·칭호·보상 상태와 취소 확인 문구를 기존 API에서 표시한다.
- 사진 검수는 한 기준씩 제목·설명·선택 표시를 제공하며 판정 실패 후 답변과 요청 키를 유지한다. 계정 시간대 기준의 채팅 날짜 구분을 추가했다.
- 게시물 상세 응원은 조회 캐시가 갱신되지 않아도 성공 후 새 요청 키를 사용한다. 실패 재시도에는 이전 키를 유지한다.
- 이메일 인증을 마친 기존 계정을 무조건 온보딩으로 보내던 분기를 제거하고, 소비한 푸시 알림 ID도 초기화한다.
- [28개 화면 검증 추적표](2026-09-28-android-parity-validation.md)에 입력·API·권한·성공/실패 결과·현재 증거와 남은 시나리오를 연결했다.

### 검사 결과

| 검사 | 결과 |
|---|---|
| Android testDebugUnitTest | 20/20 통과 (Google 상태 3, API 17) |
| Android lintDebug | 오류 0, 경고 28, 통과 |
| Debug / AndroidTest / 서명 Release AAB 빌드 | 통과 |
| npm run lint / npm test / npm run build | 통과. 첫 테스트 실행은 샌드박스 Prisma 다운로드 차단으로 중단됐으며 허용된 네트워크에서 재실행해 통과 |
| 웹 공유 합성 캡처 | 360/390/430px 3/3 통과, 화면 4종씩 캡처 |
| 최신 Android 화면 크기별 검사 | 360/390/430dp 각각 22/22, 360×400·글꼴 200%·Google 가입 저높이/200% 각각 1/1 통과. 7환경 합계 70건 |
| 최신 connectedDebugAndroidTest | API 36.1 에뮬레이터 360dp에서 22/22 통과. 지연 채팅·카테고리·루틴 저장 상태 복원 및 날짜 버튼 최소 44dp 검사 포함 |

최초 Gradle 기기 실행은 APK 설치 중 ShellCommandUnresponsiveException으로 테스트 0건에서 중단됐다. ADB 설치 이후 합성 19건은 통과했다. 연결 검사 재시도에서는 키보드 이동 중 좌표 클릭이 누락된 게시 테스트 1건이 실패해 스크롤 이후 실제 접근성 OnClick을 실행하도록 수정했다. 최종 22건 연결 검사는 통과했고 로그는 `outputs/android/native-verification/connected-final.log`에 기록했다. 화면 비교 캡처는 Compose 프레임 복사를 사용해 비동기 데이터가 표시되기 전 시스템 화면을 저장하지 않도록 보강했다.

추가 22건의 첫 실행은 차단 대화의 LazyList 구간 측정 오류로 중단됐다. 이는 앱 코드의 결함으로 수정했고 지연 응답을 넣은 재실행은 세 폭 모두 22/22 통과했다. 실패 로그는 `outputs/android/native-verification/360-chat-interval-failure.txt`, 최종 폭별 결과는 `outputs/android/native-verification/matrix-results.json`에 보존했다.

### 웹/앱 비교

`outputs/android/parity-comparison.html`은 원본 PNG 28장을 내장한 독립 파일이다. 360/390/430 탭에서 오늘·TODO·탐색·게시물 상세를 나란히 볼 수 있고, 저높이/글꼴 200% 캡처도 포함한다. 캡처를 보정하거나 합성하지 않았다.

정보 순서·주 행동과 일정 목록을 보완했지만 진행률 카드의 크기/그림자·시간 표현, 피드 대체 기록의 색상, 상세 제목·가져오기/보조 행동 배치에는 차이가 남아 있다. 공유 캡처는 28개 중 4개(약 14%)이며 전체 동등성 통과를 의미하지 않는다. 큰 글꼴에서 여러 행의 탭과 입력 위 레이블은 Android 접근성을 위한 배치다.

### 새 AAB

- 경로: `outputs/android/mungsil-native-1.2.0-5.aab`
- versionName `1.2.0`, versionCode `5` (사용자가 확인한 Play 최고 코드: 4)
- SHA-256: `0C75FDB65B6B4DCD4AD51D8C53148F8A632C6780353946D384EFE9502CB58FF3`
- 패키지 `kr.kro.mungsil`, minSdk `24`, targetSdk `36`
- 기존 업로드 키를 유지했다. jarsigner 서명 검증 통과, manifest.pb의 실제 값 확인, 합성 fixture/개인 서명키/Firebase 관리자 키 제외 확인.
- 검증 메타데이터: `outputs/android/release-1.2.0-5-verification.json`

이 파일은 내부 테스트용 로컬 산출물이다. 전체 28개 화면·시트의 동등성 검증, API 24, 실제 Play Google 계정/FCM, 격리 DB·스토리지·소켓 연동은 남아 있다. 운영 서버 배포와 Play 업로드는 하지 않았다.
