# M-07 · Android 선택적 게시의 초안·결과 확인

2026-10-23 UTC · 기준 `codex/beta-core@44e88afc395cdccc723a1fbaab1da48b8d9f59ae` + 이번 게시 상태·화면·시험·문서 변경. [설계·검수표](publishing-spec.md).

기존 게시 시트는503 등 결과 불명확 응답 뒤에도 내용을 수정하고 새 요청 키로 다시 게시할 수 있었다. `PublishFormState`로 본문·키·시각을 고정하고, 명시적인 결과 확인과 확인된 거부 후 수정을 구분했다. 정상 성공과 게시 ID 없는 응답도 구분한다.

## 1. 구현 범위

| 변경 | 결과 |
| --- | --- |
| 초안 소유권 | 계정·대상·단일/그룹 모드가 맞는 상태만 복원. 한마디·태그/입력·범위·사진 URI/mediaId/pending·본문/키/시각을 함께 보존 |
| 불확실한 요청 | 전송/5xx/409/취소 후 자동 재시도 없음. 입력 잠금과 게시 결과 확인, 같은 본문/키 유지. 진행 중 복원도 명시 확인부터 시작 |
| 재전송 경계 | 5분 경과·시계 역행은 전송 차단 후 마이 게시 기록 확인. 확인된 거부 뒤 수정은 새 본문/키. 401/403은 다시 열기 전까지 잠금 |
| 세션·응답 | 예상 sessionVersion을 HTTP 요청에 전달해 이전 계정/세션 전송 거부. 취소 검사·이전 attempt 결과 차단·게시 ID 확인 뒤에만 성공 callback |
| 게시 안내 | 완료와 선택적 게시 구분, 닫아도 완료 유지, 원본 공개 범위와 별개, 활성 게시 연결의 완료 취소 제한 안내 |
| 사진·태그 | 미완료 사진은 게시 차단. 결과 확인 때 기존 업로드 mediaId 재사용. 입력 중 태그도 제출 시 정규화/검증해 조용히 버리지 않음 |
| 그룹 | 목록/열린 시트의 상태를 계정·세션 범위로 생성해 이전 계정 자료 재사용 방지 |

기존 PUBLIC 게시 기본값·PRIVATE 개인 TODO 기본값·5탭·NativeSheet·원본 snapshot·완료 취소 제한을 유지한다. API·공용 계약·schema/migration·lockfile·workflow는 수정하지 않았다. 게시 기본값 정책은 E-002의 개발 선택이며 사용자 확정으로 확대하지 않는다.

## 2. 현재 실행 증거

| 검사 | 실제 결과 |
| --- | --- |
| Android 전체 단위 | **18 suites / 133 통과 / 0 failure / 0 error / 0 skip**, 신규 게시 상태·HTTP12개 포함 |
| 앱·시험 APK | `:app:assembleDebug`, `:app:assembleDebugAndroidTest` 통과. SDK36·JDK21·wrapper8.14.3·worker2 |
| Android lint | `:app:lintDebug` 통과, **0 errors / 32 warnings** |
| root 회귀 | `npm run lint`, `npm test`, `npm run build` 통과. API138개 중 **133 통과/5 조건부 skip/0 실패**, Web **53 통과/0 skip/0 실패** |
| Compose 시나리오 | 기존 게시 복원 시험을 불확실한 결과 확인 계약에 맞게 보강. 계정 전환·불확실한 닫기2개 신규. **컴파일만 확인, 연결 실행 미실행** |
| 문서 | 상대 링크·`git diff --check` 확인 |

단위 시험은 Saver round trip·진행 중 복원·사진 미완료·Unicode 길이·태그 입력 보존·새/동일 키·만료/역행·권한·이전 attempt를 검사했다. MockWebServer에서는409 후 복원/실제 HTTP 본문·키 일치, 이전 세션 전송0건, 성공 ID 누락의 불확실 처리를 확인했다. 실제 production API 또는 PostgreSQL에 게시했다는 의미가 아니다.

root의 조건부 실제 DB3·기록 DB1·S3저장소1은 이번에는 해당 환경을 시작하지 않아 skip했다. M-06의 실제 합성 서비스 통과는 당시 이력이다. 현재 Android 변경의 실 DB/기기 통합 성공으로 대신하지 않는다. 실행 로그는 checkout 밖 `/workspace/mungsil-setup/android-m07/`와 `android-m07-build.log`에 둔다.

## 3. 남은 검수와 다음 작업

| 항목 | 상태·이유 |
| --- | --- |
| 연결 UI·시각·실제 터치 | 미실행. M-06의 API29/API35 System UI ANR·추가 복구 실패가 해결되지 않아 이번에는 환경 복구를 반복하지 않음 |
| 폭·200%·IME·TalkBack | 이번 변경 화면은 미검증. 공통 NativeSheet 사용/컴파일만으로 통과 처리하지 않음 |
| 실제 OS 프로세스 종료·회전 | 미검증. Saver/Compose 복원 정의는 OS 기기 검사와 구분 |
| 실제 사진·게시 통합 | 실제 사진 선택/카메라·presign/upload/process·게시·원본 권한 철회/파기 경계의 현재 기기+DB 전체 흐름 미검증 |
| 실계정·출시 | 실제 Google/FCM·Play 서명·운영 배포 없음 |

다음은 안정적인 기기에서 AT-22~28을 실행하고, A-07 응원·가져오기 흐름의 설계/구현을 진행한다. A-06의 상태/화면 구현 완료와 전체 통합/출시 검수 완료를 구분한다. GitHub Actions 조사·재실행·결제 제안·CI용 우회 커밋은 하지 않았다.
