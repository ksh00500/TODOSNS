# Android 전환: 화면별 검증 추적표

기준은 현재 웹 일반 사용자 화면과 Cloud Rhythm이다. 아래 표의 API는 기존 서버 계약이며, 화면이 구현된 것과 해당 행동을 검증한 것은 구분한다. 관리자 센터는 제외한다. 자동 테스트는 기기 내부 합성 HTTP와 테스트용 Google 응답을 사용하며 운영 서버에 접속하지 않는다.

공통 확인 항목: 정상/로딩/빈 상태/오류/권한, 실패 시 초안 보존과 재시도, 중복 요청, 상세 복귀 후 위치, 키보드/360·390·430dp/글꼴 확대. 표의 ‘남음’은 통과로 판정하지 않는다.

| 웹 화면 | Android 대응 | 입력·검증 / API·권한 | 성공·실패 결과와 현재 증거 |
|---|---|---|---|
| `/` | WelcomeScreen | 시작/공개 둘러보기, 인증 불필요 | 네이티브 로그인/탐색으로 이동. 진입 기기 테스트 포함. 전체 랜딩 시각 대조 남음 |
| `/start` | AuthScreen / GoogleLogin | 이메일/비밀번호, 가입 아이디·연령·동의·초대, auth/config·login·signup·google | 자체 세션 수신 후 복귀. Google 결과 없음·타임아웃·화면 재구성·기존/신규 합성 검사. Play 실제 계정 남음 |
| `/forgot-password` | AuthScreen(reset) | 이메일 형식, auth/forgot-password, 비회원 | 메일 요청 결과 안내, 실패 시 이메일 유지. 실제 메일 전송 검증 남음 |
| `/verify-email` | EmailLinkScreen | 허용 도메인/단일 유효 token, auth/verify-email | 서버 자체 세션 수신, 온보딩 필요 여부 구분. URL·세션 단위 검사, 실제 메일 App Link 남음 |
| `/reset-password` | EmailLinkScreen | 비밀번호 8~72자·확인 일치, auth/reset-password | 완료 후 새 비밀번호 로그인 안내, 실패 시 입력 유지. 만료/OS 링크 기기 검사 남음 |
| `/onboarding` | OnboardingScreen | 관심사 최소 2개, me PATCH, 로그인 | 저장 후 원래 목적지 복귀 또는 건너뛰기. 재실행 계정 반영 검사 남음 |
| `/today` | TodosScreen(today) | 선택 계정 시간대·완료/취소·게시, todos·complete·uncomplete | 실패 복원/재시도 키/성공 이후 새 키, 생성→완료→게시 합성 기기 검사. 공유 데이터 캡처 |
| `/todos` | TodosScreen / schedule / TodoDraft | 날짜·제목·메모·시간·반복·분류·그룹·공개 범위, todos·series·restore | 정확한 원본 시각·복잡한 반복·관계 조회 실패 보호·FUTURE·실패/복원 키, 단일 삭제→복원 재시도→반복 종료의 합성 기기 검사. THIS/반복 제거/clone은 단위 계약 검사. 실제 반복 DB 결과 남음 |
| `/todos/routines` | GroupsScreen / GroupForm / PublishSheet | 이름·설명·구성, 서버 날짜/제목 검색·커서, todo-lists·clone | 검색/추가 조회 실패·중복·필터 변경·복원 뒤 선택 유지, 공개 범위 보존, 다른 시리즈 소속 선택 제한 합성 검사. 그룹 생성/게시/삭제 계약 검사 및 공유 캡처. 실제 DB/사진/전체 시각 판정 남음 |
| `/todos/categories` | CategoriesScreen / CategoryOrderSheet | 이름·기본 분류·색상·아이콘·보관·순서, me/todo-categories | 갤러리·보관·목록→일정·별도 정렬. 기본 숨김/색상·아이콘 보존, 이동 버튼·접근성 액션·포커스 Home/End·실패/복원 키, 상태별 커서 중복 제거 합성 검사. 실제 TalkBack/드래그 전체 검사 남음 |
| `/todos/import` | TodoForm / RoutineImportSheet | 제목·날짜·시간·반복·분류, todos/:id/clone·todo-lists/:id/clone | 단일 복잡한 원본 반복 보존. 루틴 KEEP/NONE 항목 생략·CUSTOM 26시간 상대 간격·복잡한 반복·모드 전환·저장 상태 복원·실패 재시도 키 기기 검사 통과. 전체 순환·실제 프로세스 종료 검사는 남음 |
| `/explore` | FeedScreen | 최신/추천·카테고리 필터, feed 또는 public/feed | 필터 초안→적용, 공개 조회/로그인 유도, 응원 실패 복원. 공유 데이터 캡처 |
| `/explore/search` | SearchScreen / SearchModel / SearchRepository | 검색어·결과 유형·최근 검색, public/search·suggestions | 전체 결과 종류·수치·미리보기/더보기·최근 검색·유형/입력 복원·실패와 빈 결과 구분·늦은 응답 무시를 단위/합성 기기 검사했다. 공유 캡처 확보. 실제 데이터·시각 동등성 판정 남음 |
| `/posts/[id]` | PostScreen | 응원·댓글 300자·신고·삭제·가져오기, posts·comments·cheer | 댓글 실패 초안/요청 키/커서 중복 제거, 응원 재시도/새 행동 키 검사. 공유 데이터 캡처 |
| `/challenges` | ChallengesScreen / ChallengeComposer | 참여중/공식/커뮤니티·일반 사용자 개설 500포인트, challenges | 개설·목록 조회, 계정 시간대 날짜·기존 일시 보존 합성 검사. 실제 포인트·생성 통합 검사 남음 |
| `/challenges/[id]` | ChallengeDetailScreen / ChallengeCheckInSheet / VerificationModel / VerificationSheet | 기간·참여·소유권·사진·기준별 판정, join·check-in·vote·resubmit·reverify | 사진 미완료·재인증 사진 필수·저장 상태/실패 키·검수 사진 재시도/확대/신고·새 시도 선택 초기화·기간/권한 UI 검사. 서버 종료/기간/멤버십 거부와 쓰기 없음·정상 흐름의 합성 행동 검사. 실제 DB·업로드·다계정 반려/재인증·전체 시각 판정 남음 |
| `/challenges/[id]/chat` | ChatScreen / ChatManagement | 멤버십·종료·제한·방장, chat·revisions·members·mute | REST 저장·재조회, 날짜 구분·메시지 수정·방 설정. 공통 채팅에 4장 첨부·실패 재시도·원본 보기·링크 추가. 챌린지별 첨부·실제 단절 복구 검사 남음 |
| `/messages` | InboxScreen | 요청 수락/거절·양방향 차단, inbox·requests | 단일 대화 목록과 요청 시트. 실제 두 계정 요청/수락 통합 검사 남음 |
| `/messages/[id]` | ChatScreen(direct) | 멤버십·canSend/canDelete, messages·read·reactions | 전송 실패 초안 유지, 차단 후 기록 보존/작성창 없음 검사. 4장 첨부·저장 상태 복원·실패 후 같은 ID/요청 키·원본 보기·허용 링크 합성 검사. 실제 OS 사진 선택·스토리지·소켓 남음 |
| `/me` | ProfileScreen / ProfileModel / ProfileRepository | 닉네임·소개·관심사·사진, me·todo-lists·public/users/:handle/posts | 프로필 수치·성장·가져가기 통계·그룹 3개·최근 게시물 6개·배지 상세. 지연 응답/조회 실패/빈 상태/섹션 재시도/오래된 응답 합성 검사와 공유 캡처. 실제 사진·전체 페이지/시트 시각 대조 남음 |
| `/me/rank` | RankScreen / profileGrowth | me 누적 파워·등급·배지 | 현재/다음 등급 표시. 웹 기준 등급 경계·최고 등급·진행률과 마이 기본/챌린지 배지 조건 단위·합성 검사. 등급 상세 전체 시각 대조 남음 |
| `/people/[handle]` | PublicProfileScreen / PublicProfileModel / PublicProfileRepository | 소개·수치·등급·팔로우·요청·차단·신고·실천 응원/가져오기, public/users·social·messages/requests | 필수 수치/관계 누락 오류, 관계 조회 실패 중 행동 차단·재시도, 팔로우/요청 실패 복원 키·새 행동 키, 본인 행동 구분·권한 상실 후 기록 제거 합성 검사와 공유 캡처. 실제 두 계정/사진/전체 시각 판정 남음 |
| `/people/[handle]/connections` | ConnectionsScreen | 팔로워/팔로잉·사진·아이디·등급·추가 조회, social/followers·following | 방향 선택·추가 조회 실패/재시도·중복 제거·접근 불가 사용자 링크 차단·복원 뒤 선택, 프로필 이동 합성 검사와 공유 캡처. 실제 두 계정/전체 시각 판정 남음 |
| `/notifications` | NotificationsScreen / PushTargetScreen | 개별/모두 읽음·소유권·서버 목적지, me/notifications·push-devices | 진입/푸시 탭은 GET만, 명시적 읽음 검사. 모두 읽음 중 새 알림·실제 FCM 남음 |
| `/settings` | SettingsScreen | 푸시·로그아웃·전체 로그아웃·탈퇴, auth·delete-account | 확인/실패 안내, 계정 종료·푸시 계정 분리. 실제 OS 권한/기기 전환 남음 |
| `/settings/blocked` | BlocksScreen | 내가 만든 차단만·해제 확인, social/blocks | 관계/기록 자동 복원 없이 재조회. 상세 복귀·실제 관계 전이 남음 |
| `/privacy` | LegalScreen(privacy) | packages/content/legal.json 공유 원문 | 네이티브 원문 표시, 웹과 같은 공급원. 전체 글꼴 확대/스크롤 검사 남음 |
| `/terms` | LegalScreen(terms) | packages/content/legal.json 공유 원문 | 네이티브 원문 표시, 별도 사본 없음. 전체 글꼴 확대/스크롤 검사 남음 |

사진 선택·촬영·업로드 재시도/제외·외부 공유는 해당 화면의 부속 행동이다. 시스템 계정 선택·사진 선택·키보드 차이는 허용하되 제품 정보와 행동 차이는 계속 추적한다.

## 실제 기기 검증 전에 필요한 확인

Google 자격 증명 타입 처리와 두 계정 선택 방식은 [Google SDK 문서](https://developers.google.com/identity/android-credential-manager/android/reference/com/google/android/libraries/identity/googleid/GoogleIdTokenCredential)를 대조했다. SDK가 결과를 돌려주는지와 서버 세션 교환은 별도 단계다. 실제 Play 설치 앱의 SHA-1과 OAuth Android 등록 일치, 서버 웹 클라이언트 연결 및 기존 계정 로그인 성공은 로컬 대체 응답으로 증명할 수 없다.

최고 Play versionCode는 사용자 확인 기준 4다. 새 내부 테스트 산출물은 5로 준비하며 기존 패키지·서명·minSdk 24를 유지한다. 서버 배포·Play 업로드는 수행하지 않는다.

최종 실행 결과와 AAB 해시는 [전환 기록](2026-09-24-android-web-parity.md)에 남긴다. 전체 전환 완료 판정은 이 표의 미검증 항목과 실제 기기·격리 통합 검증까지 통과한 뒤 가능하다.

## 진행률 보고 기준

사용자 요청에 따라 중간 보고에 진행률을 표시한다. 챌린지 인증·검수 후속 구현 이후 전체 계획의 추정치는 약 64%다. 이는 코드 구현과 남은 기능/상태/실기기 검증을 함께 고려한 작업량 추정이며 출시 승인 점수가 아니다. 비교 캡처는 10/28개(약 36%)와 게시 시트를 확보했으며 캡처 확보를 시각 동등성 통과로 간주하지 않는다. 최신 로컬 결과와 제한은 [챌린지 후속 기록](2026-09-28-android-challenge-followup.md)과 [게시·검색 후속 기록](2026-09-28-android-publish-search-followup.md)에 남긴다. 실제 Play Google 로그인은 사용자 요청으로 보류하며 FCM·API 24·격리 통합 검증도 미실행으로 유지한다. 팔로우 서버 검사와 챌린지의 종료 후 변경 거부·웹 버튼 조건은 별도 서버/웹 배포가 필요한 로컬 변경이다.
