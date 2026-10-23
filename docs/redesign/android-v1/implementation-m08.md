# M-08 · Android 응원·가져오기 상태 처리

2026-10-23 UTC · 기준 `codex/beta-core@0dd05dd5b3ee51364fd3043f012e635503a445a7` + 이번 Android 소스·시험·문서 변경. [설계·AT-29~35](social-and-import-spec.md).

목록과 상세의 응원이 서로 다른 요청 키를 사용했고, 실패한 루틴 가져오기는 내용을 바꿔 새 키로 재전송할 수 있었다. 같은 앱의 응원 요청을 공유하고, 가져오기 초안과 미확인 제출을 함께 보존하도록 보강했다.

## 1. 구현

| 변경 | 결과 |
| --- | --- |
| CheerStore/CheerState | 앱의 계정·세션별 목록/상세 공유. 낙관적 표시·개수 원복·중복 요청 잠금·불확실한 같은 키 확인·성공 후 새 키. 실패 요청은 복원 뒤에도 유지 |
| 현재 응원 상태 조회 | 별도 GET으로 boolean/개수 확인. 불확실 요청을 읽기만으로 해제하지 않음. 응답 누락·잘못된 자료형·다른 게시물·잘못된 개수는 성공 처리하지 않음 |
| PendingSocialWrite | 응원/루틴의 본문·키·시각·attempt·거부/불확실 상태. 전송/5xx/409/취소/진행 중 복원의 명시 확인, 5분/역행 재전송 차단 |
| RoutineImportState | 계정/원본별 시간대·원본 최소 필드·기준/편집 초안·제출을 함께 복원. KEEP/NONE에는 items 미전송, CUSTOM만 항목별 overrides. 모드 전환에서 편집 보존·명시 초기화 |
| 소유권/권한 | 예상 sessionVersion을 모든 관련 HTTP에 전달. 루틴은 새 ID·현재 계정 userId·PRIVATE를 검증. 원본 거부401/403/404 잠금, 취소/이전 attempt 결과 차단 |
| 화면 | 기존5탭·피드 주 행동·NativeSheet 유지. 단일/루틴의 원본과 내 새 TODO/그룹 구분 안내. 탐색·상세·피드 카드의 관련 상태는 계정/세션 범위로 생성 |

단일 TODO 가져오기는 기존 M-02 TodoFormState를 재사용하고 원본 안내만 추가했다. 원본 읽기/삭제·차단·snapshot·복제본 파기·새 항목 PRIVATE 생성 정책은 기존 서버 계약을 따른다. API·schema/migration·공용 DTO·의존성/lockfile·workflow를 변경하지 않았다. E-003은 개발 선택이며 P-05의 사용자 확정 발언으로 표현하지 않는다.

## 2. 실제 검사

| 검사 | 현재 결과 |
| --- | --- |
| Android 전체 단위 | **19 suites / 148 통과 / 0 failure / 0 error / 0 skip**. 신규 SocialFlowStateTest15개 |
| Android Debug·시험 APK | `:app:assembleDebug :app:testDebugUnitTest :app:lintDebug :app:assembleDebugAndroidTest`, SDK36/JDK21/wrapper8.14.3 worker2 |
| Android lint | **0 errors / 32 warnings** |
| root lint/build | `npm run lint`, `npm run build` 통과 |
| root test | API138 중 **133 통과/5 조건부 skip/0 실패**, Web **53 통과/0 skip/0 실패** |
| Compose | 기존 응원·루틴 복원2시나리오 보강. 목록→상세 요청 공유·루틴 계정 전환2개 신규. **컴파일만 확인, 연결 실행 미실행** |
| 문서 | 상대 링크·`git diff --check` 검사 |

신규 단위는 응원 rollback/공유·진행 중/거부 상태 복원·계정 분리·불확실 조회/새 키·5분/역행, 루틴 간격26시간·시간대·CUSTOM raw 반복·모드 전환·명시 초기화·잘못된/빈 초안·원본 거부·변조된 저장 상태를 검사한다. MockWebServer의 실제 HTTP는409 후 응원 동일 본문/키, GET 조회의 POST0건과 불확실 상태 유지, 이전 세션의 응원/루틴 요청0건, boolean 응답과 새 루틴의 소유권/공개 범위 검증을 포함한다.

API의 실제 DB3·기록 DB1·객체 저장소1은 이번 전용 서비스를 시작하지 않아 skip했다. M-06의 실제 합성 DB/MinIO 결과는 과거 이력이며 현재 소스의 기기/DB 통합 통과로 대체하지 않는다. 원본 로그는 checkout 밖 `/workspace/mungsil-setup/android-m08/`와 `android-m08-android.log`에 보존한다.

## 3. 남은 범위

| 항목 | 상태 |
| --- | --- |
| 만료된 불확실 응원 | 현재 상태 조회는 가능하지만 기존 요청의 최종 처리 증명이 없어 이 상태의 새 toggle을 차단. 서버 작업 상태 조회/명시적 원하는 상태 계약은 후속 설계 필요 |
| 실제 소셜·가져오기 통합 | 두 실계정·원본 변경/삭제/비공개·차단/동시 권한 경합·실 DB의 가져오기→재완료 전체 흐름 미검증. A-08 범위 |
| 현재 화면/기기 | 연결 UI·시각/실제 터치·3폭/200%·IME/TalkBack·실제 OS 복원 미검증. 기존 M-06 System UI ANR/추가 복구 실패를 해결 완료로 취급하지 않고 이번 반복 실행 없음 |
| 출시/외부 서비스 | 실제 Google/FCM·사진 전체 흐름·release 서명·Play/운영 배포 없음 |

GitHub Actions 조회·수동 재실행·결제 제안·CI 유도 커밋/Push·workflow 수정은 하지 않았다. A-07 상태/화면 구현과 전체 통합/출시 검수 완료를 구분한다. 다음 단계는 A-08 공개 안전·권한/삭제 경계와 실제 합성 통합 검증이다.
