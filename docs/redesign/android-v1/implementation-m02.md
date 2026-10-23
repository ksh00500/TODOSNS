# M-02 · 작성 폼과 제출 상태 복원

2026-10-23 UTC · 구현 및 현재 Codex 검사 결과

검사 대상: `codex/beta-core@79001108aaaa7533722ca6e1943b8ca1d970b320`에 이번 코드·시험·문서 변경을 더한 작업 트리. 서버·DB·workflow·manifest·의존성/lockfile 변경과 운영 배포는 없다.

## 1. 사용자 동작

| 상황 | 구현한 동작 |
| --- | --- |
| 작성·편집·가져오기 상태 복원 | 제목·메모·날짜·시간·카테고리·반복·그룹·공개 범위·반복 적용 범위, 원본 기준값과 시간대를 함께 복원 |
| 다른 계정·할 일·모드 | 저장 상태의 소유 계정 ID·대상 ID·모드를 검사해 일치하지 않는 초안을 거부. 게스트는 저장·제출 불가 |
| 그룹만 변경하거나 원래 값으로 되돌림 | 의미가 달라졌을 때만 이탈 확인. 원래 그룹을 다시 선택하면 변경으로 취급하지 않음 |
| 날짜·시간을 그대로 두고 제목만 수정 | 원본 dueDate의 초·밀리초와 복잡한 반복 규칙 유지. 관계 조회 실패 때 기존 카테고리·그룹을 해제하지 않음 |
| 제출 중 | 입력과 중복 제출 제한. 제출 본문·키·시도 번호를 고정한 뒤 HTTP 시작 |
| timeout·5xx·409·취소 또는 제출 중 저장 상태 복원 | busy는 해제하고 결과 미확인으로 복원. 자동 재전송 없이 `저장 결과 확인`에서 원래 본문·키로만 재시도. 늦게 도착한 선택 목록으로 제출 본문을 다시 만들지 않음 |
| 결과 미확인 상태에서 닫기 | 서버에 이미 반영됐을 수 있으며 닫기가 서버 저장 취소를 뜻하지 않음을 안내 |
| 오래된 결과 미확인 요청 | 최초 제출 후 5분 이상 또는 기기 시계 역행이면 재전송을 거부하고 닫은 뒤 목록 확인을 안내 |
| 확정적인 4xx 거부 | 입력 수정 허용. 동일 본문은 동일 키, 바뀐 본문은 새 키. 성공한 이후 새 행동도 새 키 |
| 로그아웃·세션 변경 | 요청 시작 시 예상 세션 세대를 검사하고 변경 이후 응답을 성공으로 확정하지 않음. 폐기된 폼의 coroutine 완료 콜백 차단 |

기존 필드 순서·5탭·공통 NativeSheet를 유지한다. 저장 상태에는 인증 토큰을 포함하지 않는다. 기존 관계·날짜 payload 생성 함수를 재사용한다.

## 2. 변경 범위

| 파일 | 역할 |
| --- | --- |
| `ui/TodoFormState.kt` | 명시적 초안·기준·제출 상태, 계정/대상/모드 검사 Saver, 결과 미확인·만료·늦은 콜백 처리 |
| `ui/TodosScreen.kt` | 공통 폼 연결, 소유 범위의 coroutine, 입력 잠금·재확인·이탈 안내 |
| `MainActivity.kt`, `data/Api.kt` | 인증된 계정 ID 전달, 비밀값 없는 세션 세대와 요청 시작/응답 경계 검사 |
| `ui/Components.kt` | 기존 NativeSheet 이탈 확인에 상황별 설명을 전달하는 선택 인자 |
| `TodoFormStateTest.kt` | 실제 Saver와 loopback HTTP를 포함하는 신규 회귀 시험 15개 |
| `NativeFlowTest.kt` | 복원/재시도 버튼·계정 컨텍스트 반영, 기존 완료/취소 합성 응답을 실제 응답 계약에 맞춤 |
| `AGENTS.md`, `uiux-review.md` | 계정별 제출 복원·멱등 보존 경계와 실제 검증 범위 기록 |

## 3. 실행 결과

| 검사 | 실제 명령·결과 |
| --- | --- |
| 관련 회귀 | `:app:testDebugUnitTest --tests 'kr.kro.mungsil.TodoFormStateTest' --tests 'kr.kro.mungsil.TodoEditingTest' --tests 'kr.kro.mungsil.ApiTest'` 통과 |
| Android Debug | `:app:assembleDebug` 통과, APK 생성 |
| Android 전체 unit | `:app:testDebugUnitTest`: 14 suites / 84 통과 / 0 failures / 0 errors / 0 skip |
| Android lint | `:app:lintDebug`: 0 errors / 33 warnings, 기존 기준선과 같은 경고 수 |
| 기기 시험 코드 빌드 | `:app:assembleDebugAndroidTest` 통과, 테스트 APK 생성. 연결 시험 실행을 뜻하지 않음 |
| Web/API lint | `npm run lint` 통과 |
| API 회귀 | `npm test`의 API 단계: 129개 중 125 통과 / 4 조건부 skip / 0 실패 |
| Web 회귀 | 같은 명령의 Web 단계: 53 통과 / 0 skip / 0 실패 |
| 전체 build | `npm run build`: contracts·API·Web 통과 |
| 변경·문서 검사 | `git diff --check`, 문서 상대 링크 검사 통과 |

Gradle은 `apps/android`에서 SDK36·Temurin JDK21·wrapper8.14.3과 `--no-daemon --max-workers=2 --console=plain`으로 실행했다. 현재 실행 XML과 exit0으로 결과를 확인했다. 원본 로그는 checkout 밖 `/workspace/mungsil-setup/android-m02/`에 있으며 Git에 넣지 않는다.

## 4. 검수 항목과 한계

| 설계 항목 | 현재 증거 | 미검증 범위 |
| --- | --- | --- |
| AT-04 입력 경계 | 기존 폼 길이 제한·제목/메모 검증 유지, 잘못된 저장 상태 거부 | 실제 DTO/HTTP의 전체 경계 조합·필드별 오류 UX |
| AT-05~06 원본 보존 | 제목만 수정한 초안 복원 뒤 정확한 원본 일시·반복·공개 범위 및 관계 필드 생략 확인 | 실제 서버·DB 관계 및 기기 표시 |
| AT-07 복원·재시도 | 실제 Saver roundtrip, 503→복원→동일 wire body/key 재전송을 loopback HTTP로 확인 | 실제 DB 멱등·동시성·중복 생성 여부 |
| AT-08 처리 중 변경 | 중복 제출·입력 변경 차단, 성공/이전 콜백 분리 | 실제 Compose 조작·취소 시점 경합 |
| AT-17 dirty·복원 | 그룹/범위/모든 필드/원본 기준을 unit 검증, 기존 Compose 복원 시험 코드 갱신·컴파일 | 실제 연결 UI 실행·회전·뒤로 가기 |
| AT-19 계정 경계 | 다른 계정/대상/모드의 복원 거부, 요청 전/중 세션 clear 시 미전송 또는 성공 거부 | 두 계정 실제 로그인·내비게이션·OS 복원 |

Android SavedState가 제공되는 재생성 범위를 구현한 것이다. 강제 종료·재설치 후에도 남는 영구 자동저장이나 오프라인 쓰기 큐는 아니다. 실제 기기에서 프로세스를 종료한 시험은 수행하지 않았다.

서버 `idempotency.interceptor.ts`는 미완료 5xx 기록의 보존 시간을 오류 시점부터 5분으로 줄인다. 따라서 클라이언트는 첫 제출부터 5분을 보수적인 재시도 상한으로 사용한다. 서버 정책을 변경하지 않았으며 장기간의 exactly-once 저장을 보장하지 않는다. 목록 조회로 개별 요청의 반영 여부를 확정하는 새 API도 추가하지 않았다.

실제 DB 3건·스토리지 1건은 조건부 skip이다. 연결 기기·에뮬레이터 환경이 없어 Compose 실행·실제 회전/프로세스 종료·360/390/430dp·200% 글자·IME·TalkBack은 미검증이다. 실제 Google/FCM·서명 release·운영 배포도 수행하지 않았다. GitHub Actions는 조회·재실행하지 않았다.

다음 구현 후보는 M-03 오늘 화면의 정보 위계와 빈/오류/갱신/처리 중 상태다. 실제 완료일 기록 M-04~05는 별도 계약·검증이 필요하다.
