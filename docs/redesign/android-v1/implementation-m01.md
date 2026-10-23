# M-01 · 완료·취소 응답 반영과 실패 복구

2026-10-23 (Asia/Seoul) · 구현 및 현재 Codex 검사 결과

검사 대상: `codex/beta-core@75dbe9a`에 이번 Android 코드·테스트·문서 변경을 더한 작업 트리. 서버·DB·workflow·manifest·dependency/lockfile 변경은 없다.

## 1. 사용자가 경험하는 변화

| 상황 | 이전 동작·문제 | 이번 변경 |
| --- | --- | --- |
| 완료 성공 | 서버 응답을 버리고 단말 시각으로 만든 낙관 항목을 성공 결과로 사용 | 서버의 TODO·완료 시각·필드를 화면과 게시 선택 콜백에 전달 |
| 취소 성공 | 반환 TODO를 사용하지 않음 | 직접 TODO 응답을 파싱해 실제 미완료 상태 반영 |
| 잘못된 성공 응답 | 다른 ID·상태·완료 시각을 확인하지 않음 | 잘못된 응답을 성공으로 확정하지 않고 복원·오류 안내 |
| 게시 연결로 취소 거부 | 서버 사유·복원이 필요 | 서버 400 사유와 완료 상태 유지, 게시물 자동 삭제·우회 없음 |
| 처리 중 새로고침 | pending이면 load가 즉시 반환해 요청 누락 가능 | 최신 요청 하나를 예약하고 쓰기 종료 후 조회 |
| 처리 중 날짜·시간대 변경 | 이전 조건의 결과가 화면·콜백에 반영될 위험 | 새 조건에서는 이전 행을 지우고 generation으로 응답·게시 콜백 차단, 최신 조건 조회 |
| 실패 재시도 | 같은 행동의 식별자 유지 필요 | 실패 재시도는 같은 키. 성공으로 상태가 확인되면 해당 항목의 이전 시도 키를 정리해 새 행동은 새 키 |
| 화면 모델 종료 | 뒤늦은 비취소 작업이 반환할 수 있음 | 활성 coroutine 확인 후 종료된 모델에서 성공 콜백을 실행하지 않음 |

레이아웃·색·탭·폼 순서를 재설계한 변경은 아니다. 기존 낙관적 반응과 전역 쓰기 잠금은 유지하며, 성공 확인과 조회 순서를 보완했다.

## 2. 변경 파일

| 파일 | 역할 |
| --- | --- |
| `data/TodoRepository.kt` | 완료 envelope/취소 직접 응답 파싱, 필수 문자열·시각·대상 ID·완료 상태 검증, `TodoSource` 계약 |
| `ui/TodoModel.kt` | 서버 행으로 교체, 원상복구·오류 보존, 예약 조회·날짜 generation, 취소·키 관리 |
| `TodoRepositoryTest.kt` | 실제 loopback 합성 HTTP로 요청·응답·오류·세션 경계 검사 6개 |
| `TodoModelTest.kt` | 제어 가능한 coroutine으로 낙관/확정·원복·중복·늦은 응답·예약 조회 검사 9개 |
| `AGENTS.md`, `uiux-review.md` | 서버 결과 정규화와 처리 중 조회 누락 방지 규칙·검증 범위 기록 |

## 3. 실행한 검사

| 검사 | 명령·대상 | 결과 |
| --- | --- | --- |
| 신규 회귀 시험 | `bash gradlew :app:testDebugUnitTest --tests 'kr.kro.mungsil.TodoModelTest' --tests 'kr.kro.mungsil.TodoRepositoryTest'` | 15 통과 / 0 실패 / 0 skip |
| Android Debug | `:app:assembleDebug` | 통과, APK 생성 |
| Android 전체 unit | `:app:testDebugUnitTest` | 13 suites / 69 통과 / 0 failures / 0 errors / 0 skip |
| Android lint | `:app:lintDebug` | 0 errors / 33 warnings. 경고 수는 최초 기준선과 같음 |
| Web/API lint | `npm run lint` | 통과 |
| API 기존 검사 | `npm test`의 API 단계 | 129개 중 125 통과 / 4 조건부 skip / 0 실패 |
| Web 기존 검사 | 같은 명령의 Web 단계 | 53 통과 / 0 실패 / 0 skip |
| 전체 build | `npm run build` | contracts → API → Web 순서 통과 |
| 변경 검사 | `git diff --check`, 문서 상대 링크 검사 | 통과 |

Android 검사는 checkout의 `apps/android`에서 SDK36·Temurin JDK21·Gradle wrapper8.14.3, `--no-daemon --max-workers=2 --console=plain`으로 실행했다. 전체 Android 실행은 exit0과 현재 결과 XML로 확인했다. raw 로그는 `/workspace/mungsil-setup/android-m01/`에 있으며 Git에 넣지 않는다.

## 4. 검수 시나리오와 실제 증거의 범위

| 시나리오 | 이번에 확인한 범위 | 아직 필요한 검사 |
| --- | --- | --- |
| AT-10 서버 시각 | 합성 HTTP 응답의 정확한 completedAt·필드 반영, 잘못된 ID/시각/상태 거부 | 실제 서버·기기 화면 |
| AT-11 중복·재시도 | 중복 탭·전역 쓰기 차단, 실패 재시도 키 유지, 이후 새 행동 키 갱신 | 실제 DB 동시성·포인트·멱등 원장 |
| AT-12 취소 제한 | 서버 형태의 400 전달·원상복구·오류 보존, 삭제 요청 없음 | 실제 게시 연결 DB와 기기 안내 |
| AT-18 날짜·조회 순서 | 처리 중 최신 날짜 조회, 중복 갱신 합치기, 이전 비취소 조회 응답 무시 | Compose 상태·실기기 복귀 |
| AT-19 계정/수명 | 실제 loopback HTTP 지연 중 Api 세션 clear 시 응답 거부, 모델 종료 후 콜백 없음 | 두 계정 실제 로그인·기기 navigation·초안 경계 |

이 시험은 로컬 합성 HTTP/모델 시험이다. 실제 운영 API·사용자 계정·DB·스토리지·FCM을 사용하지 않았다. GitHub Actions 상태 조회·재실행·결제 해결 제안도 하지 않았다.

## 5. 남은 범위

- M-02에서 폼/제출 snapshot·요청 키의 프로세스 재생성 뒤 복원과 계정별 정리를 구체화한다. 이번 키 보존은 현재 ViewModel 수명 범위다.
- timeout·5xx 후 서버 반영 여부가 불명확하면 동일 키 재시도/조회로 확인해야 한다. 이번 변경을 내구성 있는 오프라인 쓰기 큐나 무한 자동 재시도로 확대하지 않는다.
- 실제 DB 3건·스토리지 1건은 조건부 skip 상태다. Android 연결 UI·실기기·글자 확대·IME·TalkBack·실제 Google/FCM·release는 이번 미검증이다.
- 실제 완료일 기록용 API와 화면, 전체 UI 재설계는 아직 미구현이다. 완료 취소·게시·포인트 정책을 바꾸지 않았다.
