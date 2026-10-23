# M-05 · Android 완료 기록

2026-10-23 UTC · 구현 및 현재 Codex 검사 결과

검사 대상: `codex/beta-core@da4c7968f6c41eb191ed669744b0ab9c22923cdf`에 이번 Android 코드·시험·문서 변경을 더한 작업 트리. [M-04 기록 API](history-api.md)와 [E-001 개발 기본값](../decision-log.md)을 사용한다. 서버·공용 계약·schema/migration·의존성/lockfile·workflow 변경과 운영 배포는 없다.

## 1. 화면과 조회 동작

| 영역·상황 | 구현한 동작 |
| --- | --- |
| 진입 | 마이의 `완료 기록 보기` → 내부 `완료 기록` 화면. 기존 오늘·탐색·TODO·챌린지·마이 5탭 유지, 기록에서는 마이 탭 선택 |
| 기본 기간 | 첫 요청에는 날짜를 보내지 않아 서버가 계정 기준 최근 7일을 결정. 응답의 날짜 쌍·시간대를 그대로 표시하고 완료일별로 그룹화 |
| 기간 변경 | 공통 NativeSheet와 DateControl에서 달력 날짜 1~90일 선택. 최근 7일로 돌아가면 다시 서버 기본 기간 조회 |
| 목록·수치 | 실제 completedAt·ID 역순. 제목·완료 시각·예정일·분류 표시. 기간 전체 total과 현재 표시 개수를 분리 |
| 추가 조회 | 반환받은 기간과 cursor·limit20 고정, ID 중복 제거·최신 행 병합. 추가 실패 때 기존 목록·커서와 해당 위치의 재시도 유지 |
| 커서 무효 | `TODO_HISTORY_CURSOR_INVALID`이면 누적 목록/커서를 버리고 첫 페이지 한 번 재조회. 재조회 실패 뒤 자동 반복 없음 |
| 조회 사이 변경 | 페이지 시간대가 바뀌거나 누적 개수가 새 total보다 많으면 첫 페이지로 초기화. total 변경 안내·명시 새로고침 제공 |
| 첫 로딩·실패 | 미확인 수치를 0으로 만들거나 빈 기록으로 표시하지 않음. 연결·서버·404 미제공 오류와 확인된 빈 기록 구분. 예정일 API로 대체하지 않음 |
| 재조회 실패 | 마지막 목록·수치·확인 시각 유지, 새로고침 안내. 재조회 중 또는 실패 상태에서는 과거 자료의 상세/더 보기 잠금 |
| 복귀·변경 후 | RESUMED 복귀와 앱 revision 변경에 첫 페이지 재조회. 성공하면 누적 캐시를 교체해 취소·삭제된 항목 제거 |
| 상세 | 현재 확인된 목록에서만 읽기 시트 열기. 제목·완료/예정 시각·시간대·분류·반복·공개 범위·메모 표시. 상세 본문을 별도 보관하지 않음 |
| 일정 이동 | `일정에서 보기`에 예정일과 기록 응답의 서버 timezone 전달. 앱 프로필에 남은 시간대가 다르더라도 표시한 예정일의 범위를 조회 |
| 계정·권한 | 계정별 화면/모델과 Repository의 세션 버전 고정. 다른 기간·시간대 snapshot은 effect 이전에도 숨김. 401/403은 목록·total·확인 시각·커서를 제거 |
| 저장 상태 | 계정 ID가 붙은 선택 날짜만 복원. 목록·메모·cursor·상세 선택은 저장 상태에 남기지 않음 |

이 기록은 현재 완료 상태인 본인·미삭제 TODO 조회다. 모든 과거 완료/취소 사건의 장부나 삭제 원문 보관 기능을 추가하지 않는다. 화면이 열린 동안 다른 기기에서 바뀐 항목을 실시간으로 감지하지는 않으며 새로고침/복귀 시 확인한다.

## 2. 코드와 회귀 시험

| 파일 | 역할·확인 내용 |
| --- | --- |
| `data/HistoryRepository.kt` | 명시 타입·기간 검증, 세션 범위, 새 API 요청, 필수 metadata/행·정렬·날짜·cursor 검증. 잘못된 응답을 정상 빈 목록으로 처리하지 않음 |
| `ui/HistoryModel.kt` | 불변 StateFlow, 요청 세대·취소, 날짜/시간대별 snapshot, 페이지 병합·실패 복구·권한 상실 |
| `ui/HistoryScreen.kt` | 단일 PageList, 기간 시트·날짜 그룹·수치·상세·일정 이동. 목록/그룹을 LazyListScope 전에 읽음 |
| `MainActivity.kt`, `ui/ProfileScreen.kt` | 인증 내부 경로·마이 진입·기존 5탭·서버 시간대를 받는 선택적 일정 query 연결 |
| `HistoryRepositoryTest.kt` | 신규 9개. MockWebServer 요청/응답, 기간·DST·전체 total, 응답 손상, 400/404, 전/후 세션 변경, 계정 날짜 복원, 서버 시간대의 일정 이동 |
| `HistoryModelTest.kt` | 신규 10개. 첫 실패/빈 기록·추가 실패/동일 재시도, 중복/total 변화, 무효 cursor, 시간대 변경, 취소/삭제 재조회, 늦은 응답·모델 해제·권한·중복 요청/커서 순환 |
| `HistoryFlowTest.kt` | 신규 Compose 3개. 추가 조회 실패/재시도·읽기 상세, 날짜 선택/저장 상태 복원, 마이→기록→서버 시간대 일정/5탭. **컴파일만 확인, 연결 실행 안 함** |

시험은 합성 계정·loopback HTTP·주입 시계/모델을 사용한다. 실제 두 계정 로그인이나 기기의 프로세스 종료·회전 성공을 뜻하지 않는다.

## 3. 현재 실행 결과

| 검사 | 실제 결과 |
| --- | --- |
| Android 전체 unit | `:app:testDebugUnitTest`: 17 suites / 117 통과 / 0 failures / 0 errors / 0 skip. 신규 기록 19개 포함 |
| Android Debug | `:app:assembleDebug` 통과. 앱 APK 24,619,389 bytes |
| Android lint | `:app:lintDebug`: 0 errors / 33 warnings, 기존 기준선과 같은 경고 수 |
| 연결 시험 코드 빌드 | `:app:assembleDebugAndroidTest` 통과. 테스트 APK 1,346,691 bytes. `connectedDebugAndroidTest` 실행 아님 |
| Web/API lint | `npm run lint` 통과 |
| API 회귀 | root `npm test`: 전체 138개 중 133 통과 / 5 조건부 skip / 0 실패 |
| Web 회귀 | 같은 명령의 Web: 53 통과 / 0 skip / 0 실패 |
| 전체 build | `npm run build`: contracts → API → Web 통과 |
| 문서·변경 | `git diff --check`, 문서 상대 링크 검사 |

Android는 SDK36·Temurin JDK21·wrapper8.14.3에서 Debug/unit/lint/테스트 APK 네 작업을 `--no-daemon --max-workers=2 --console=plain`으로 함께 실행해 exit0을 확인했다. XML과 APK를 직접 집계했다. `/home/agent/.android` metrics 경고와 기존 Gradle deprecation은 빌드 통과와 구분한다. 원본 로그는 checkout 밖 `/workspace/mungsil-setup/android-m05/`에 두고 Git에 올리지 않는다.

API의 조건부 skip은 기존 DB E2E3·스토리지1과 `TODO_HISTORY_TEST_DATABASE_URL` 미제공인 기록 DB1이다. M-04에서 격리 PostgreSQL로 기록 DB 시험을 실제 통과한 이력은 있지만 **이번 실행에서는 재실행하지 않았다**. 이번 합성 HTTP/unit 성공을 실제 서비스 통합 성공으로 보고하지 않는다.

## 4. 검수 추적과 다음 작업

| 시나리오 | 이번 확인 | 남은 범위 |
| --- | --- | --- |
| AT-14 | 완료일 응답·서버 기간/시간대·과거 예정일을 Android 타입/모델에 반영 | 실제 API와 기기 표시 일치 |
| AT-15 | 날짜 고정 cursor, 중복/total, 범위 전환 중 늦은 응답 무시·재시도 | 55개 이상 실제 API→Compose 추가 조회 |
| AT-16 | 새로고침 성공 시 기존 행 교체, 현재 목록에서만 상세 열기 | 실제 삭제/취소·공개 변경 후 기기 복귀와 파기 경계 |
| AT-18~20 | query 마스킹·세션 버전·401/403 제거·무효 cursor 한 번 초기화 | 실제 두 계정 전환/만료·회전·프로세스 종료 |
| AT-21 | 공통 시트/달력·유동 높이·단일 목록과 상세 경로 구현 | 360/390/430dp·200% 글자·TalkBack·뒤로 가기·시각 캡처 |

다음은 M-06이다. ADB 설정 경로와 연결 기기/에뮬레이터를 준비하고, 앱·테스트 APK를 같은 소스로 설치한 뒤 새 Compose 시나리오부터 실제 실행한다. 이후 격리 합성 API·DB/Redis/스토리지에서 핵심 순환과 기록 화면의 통합을 검증한다. 현재 AVD·시스템 이미지·기기는 준비되지 않았고 `/dev/kvm`도 없어 이번에는 연결 UI를 실행하지 않았다.

실제 Google 로그인·FCM 전달·release 서명·Play 배포·운영 API 배포는 미검증이다. GitHub Actions 조회·재실행과 결제 해결 시도는 하지 않았다.
