# M-11 · 기기·화면·수명주기 검사

2026-10-24 (Asia/Seoul). 초기 제품은 `49dcaa4fd83fcf470ba6d82553cd800633c8fdf6`, 초기 시험/도구는 `47d2d50bfaa6f019f89d88e13e1559c5ff9ca63e`다. 실제 IME 확인 후 공통 시트를 보완한 최종 제품 소스는 `fbb262cd6ec5c1a80b6e9796a0e5a9e2fd90c94d`다. 상세 행동의 최종 제품은 `f686a1edabb9e38c7b7c37d7b6aa9d4e5122aa0e`, 최종 OS 캡처 시험은 `858abb29b64b71543bb4aa6279f9f8eb16baf81f`이며 APK/해시는 M-12에 기록한다.

M-06의 기존 AVD를 반복 재시작하지 않고, avdmanager로 새 API29 AOSP x86_64 AVD를 만들었다. 최초부터 360×780px/density160으로 설정해 큰 기본 framebuffer를 축소해 쓰던 조건을 제거했다. RAM1536MiB/2cores, SwiftShader/소프트웨어 CPU, Docker10GiB·4CPU 한도다. `/dev/kvm`이 없어 하드웨어 가속은 사용하지 못했다. 부팅112.5초, 초기 launcher 화면을 직접 열어 OS 경고창이 없음을 확인했다.

앱·시험 APK를 동일 소스로 빌드·설치하고 두 패키지를 speed compile했다. 테스트 동안 인터넷을 끄고 loopback MockWebServer 또는 명시적으로 전달한 격리 AppModule API만 사용한다. 운영 주소·계정·저장소·Firebase 자격 증명을 시험용으로 바꾸지 않았다.

## 시트 보완 전 연결 실행 결과

| 실행 | 기대 건수 | 결과 |
| --- | --- | --- |
| 360dp 응원 복구 | 2 | 2통과, 실패0, 실행 전후 OS ANR 없음 |
| 360dp 전체 합성 UI | 59 | 최초 56통과/3실패, OS ANR 없음. 아래 시험 보완 후 해당 3건 별도 재실행 3통과/0실패·ANR 없음 |
| 390dp 핵심 화면·폼 | 15 | 15통과/0실패·ANR 없음 |
| 430dp 핵심 화면·폼 | 15 | 15통과/0실패·ANR 없음 |
| 360dp 글꼴200% | 9 | 9통과/0실패·ANR 없음 |
| 실제 API·DB 두 계정 기록 | 1 | 1통과/0실패·ANR 없음. 20→40→55개 조회, 취소/삭제 뒤53개, B계정1개·타 계정 cursor400/로그아웃 세션401 |

전체 합성 UI는 NativeFlow43·PublishSearch7·Challenge6·History3이다. 390/430dp는 Native의 로그인/5탭·공유 fixture 화면·루틴 모드·응원2개와 PublishSearch7·History3의15개다. 글꼴200%는 Native5탭·루틴 모드·응원2개, 게시 복원·검색 복원, History3의9개다. 정확한 대상·기대 건수는 [재현 행렬](../../../infra/verification/android-v1/device-matrix.json)에 보존했다. 합성 Google provider·사진 loader와 서버 응답을 쓰므로 실제 Google/FCM/스토리지 성공으로 표현하지 않는다. Strict runner는 성공 status 수·JUnit `OK(N tests)`·최종 instrumentation code·실패 stack을 함께 검사한다. 셸 exit0이나 컴파일만으로 통과 판정하지 않는다.

## 최초 연결 실행에서 보완한 시험

| 실패 | 확인된 원인과 보완 |
| --- | --- |
| 그룹 생성→게시→삭제 | 단독 GroupsScreen 시험에 계정 CompositionLocal이 없고 게시 응답도 `{}`였다. 실제 앱과 같은 합성 소유자를 제공하고 게시 성공 ID를 반환하도록 보완. TODO 보존/태그/공개 범위/중복 요청 assertion 유지 |
| 검색 복원 | 복원 뒤 비동기 재조회로 수치가 아직 0인 시점에 `실천 4` 탭을 검사했다. 실제 결과 도착을 기다린 뒤 기존 탭 선택/검색어 assertion 유지 |
| 게시 계정 전환 | 빈 EditableText는 맞았지만 `assertTextEquals`가 placeholder까지 비교했다. EditableText 자체의 빈 값과 이전 계정 초안의 부재를 함께 검증 |

제품의 로그인/게시 ID/계정 분리 조건은 완화하지 않았다. 원래 59개 실행의 실패 로그를 보존하고 보완한 3건과 후속 폭/글자 결과를 별도 기록한다. 제품 소스는 M-10과 동일하며 시험 APK만 보완했다.

## 증거와 한계

검증 도구 [connected.py](../../../infra/verification/android-v1/connected.py), 원본 로그/JSON/PNG `/workspace/mungsil-setup/final-m11/`. 실행 전후 windows dump·am_anr events·화면을 보존한다. 테스트 중 system 캡처에서는 실제 카테고리 시트의 입력/저장 행동이 360dp에 표시되고 OS 가림이 없음을 직접 확인했다. Compose root만 캡처한 파일과 OS composited screen을 구분하며 최종 채택 이미지는 직접 열어 확인한다.

실제 API 검사는 별도 fixture 계정 A55/B1개 완료 TODO와 AppModule/PostgreSQL/Redis/MinIO를 사용한다. 사설 stdin으로 기기에 전달한 fixture와 loopback reverse 연결만 허용한다. 기록 pagination·삭제/완료 취소·계정 전환/커서/로그아웃 권한을 실제 서버로 검사하며 운영 데이터는 사용하지 않는다.

SavedState/Saver·composition 재생성 시험과 실제 OS 프로세스 종료·복원은 다르다. 후자는 미검증이다. 실기기 TalkBack·실제 손가락/키보드/IME 가림·사진 권한/카메라·API24/지원 최신 OS·기기별 회전/백그라운드/자정·실제 Google/FCM·두 계정 소켓 재접속·운영 부하도 미검증이다. 일부 폭/글자 검사를 전체 화면의 접근성 승인으로 확대하지 않는다. 과거 API35 ANR과 M-06 실패 이력도 지우지 않는다.

## 직접 확인한 화면 자료

모두 합성 자료이며 이미지를 편집하지 않았다. 일부 대표 화면의 시각 증거로만 사용하고 전체 화면·물리 터치·접근성 승인으로 확대하지 않는다.

| 화면 | 확인 범위 |
| --- | --- |
| [오늘 360dp](evidence/m11-today-360.png) | 지금 실천·수치·기존5탭, Compose frame. OS 가림은 별도 windows/events와 system 캡처로 확인 |
| [게시 사진 미완료 복원 360dp](evidence/m11-publish-pending-360.png) | 공개 선택 보존·사진 미완료로 게시 차단, 실제 OS 합성 캡처 |
| [실제 API 기록 상세 360dp](evidence/m11-history-real-api-360.png) | 실제 API의 메모·시간대·일정 이동과 시트/시스템 여백, OS 가림 없음 |
| [기록 상세 글꼴200%](evidence/m11-history-font200.png) | 시간대/메모 줄바꿈과 스크롤 뒤 일정 이동 CTA, OS ANR 가림 없음 |

200%에서는 API29 AOSP의 **OS 상태바 시계 자체가 잘리는 현상**이 캡처에 남는다. 앱의 시트/본문·행동은 확인했으나 전체 시스템 시각 검수를 통과로 표시하지 않는다. 원본 이미지를 잘라 이 현상을 숨기지 않았다.

## 작은 창에서 실제 IME로 확인한 문제와 보완

360×400dp에서 실제 키보드 표시를 관측했으나, 기능 시험의 semantics 클릭 통과와 달리 고정 헤더가 남은 입력 공간을 거의 차지했다. 이 캡처를 시각/터치 통과 증거로 채택하지 않았다. 공통 NativeSheet는 안전 영역/IME를 제외한 높이가180dp보다 작을 때만 헤더와 세로 여백을 줄인다. 제목은 paneTitle로 제공하고 Back/기본 dismiss·dirty 확인은 유지한다. 본문은 같은 composition 위치와 단일 스크롤을 유지해 초안/사진 상태를 다시 만들지 않는다. 일반 높이에서는 기존 고정 헤더를 유지한다.

새 CompactSheetTest는 실제 IME가 열린 뒤 입력과 저장 행동에 각각44px 이상 보이는 영역을 확인하고 coordinate touch로 저장·입력 보존을 검사한다. 첫 실행은 에뮬레이터 식별 guard 때문에 skip되어 통과로 계산하지 않았고 실제 ranchu/goldfish hardware 식별로 보완했다. 최종 실행과 재검수 결과는 아래 최신 표로 확정한다. 초기 작은 높이 시험의 화면 밖 빈 상태 대기 실패/보완 후 기능 통과·시각 한계와 새 시험의 skip 로그는 별도 폴더에 보존한다.

## 시트 보완 후 최종 제품 재검수

소스 `fbb262cd6ec5c1a80b6e9796a0e5a9e2fd90c94d`. 공통 시트를 변경했으므로 Debug/unit152/lint0errors/32warnings·시험 APK와 root lint/API160/Web53/build를 다시 통과시켰다. 같은 작업을 근거 없이 반복한 실행과 구분한다.

| 실행 | 기대 건수 | 실제 결과 |
| --- | --- | --- |
| 실제 IME·coordinate touch | 1 | 안정화 후1통과/0실패·ANR없음. IME 유지/입력·저장44px/실제 좌표 클릭·초안 보존 |
| 360dp 게시·기록·챌린지·TODO/루틴/응원 | 21 | 21통과/0실패·ANR없음 |
| 390dp 공유 화면 | 1 | 1통과/0실패·ANR없음 |
| 430dp 공유 화면 | 1 | 1통과/0실패·ANR없음 |
| 360dp 글꼴200% | 9 | 첫 재검수8/9 및 후속2성공 뒤 crash를 보존. 최종 OS 캡처9/9·ANR없음 |
| 360×400dp 실제 TODO 흐름·IME 관측 | 1 | 1통과/0실패·ANR없음, 실제 IME 표시 관측·설정 복원 |

200% 최종 재검수 중 응원 결과 확인 뒤 Compose 측정 예외(`LayoutNode should be attached to an owner`)1건을 관측했다. 해당 실행은8/9로 실패 처리했고 원본을 보존했다. 진단 semantics에서 상세의 공유/신고 폭이0인 것도 확인했다. 상세의 단일 Row를 FlowRow로 바꾸고, 응원 실패/결과 정리 뒤 공유/신고 각각44dp 이상·표시됨을 검사하도록 보강했다. 측정 예외의 모든 원인을 단정하지 않으며 수정 뒤 실제 재검증 결과를 별도 기록한다.

공유/신고 재검수의 첫 일반 글자 실행에서도 기본 표시 높이40dp가44dp 기준에 못 미쳤다. 해당 실행1/2 실패를 보존하고 관련 버튼 최소48dp를 명시했다. 이후 일반 글자의 응원2건은2/2·ANR없음으로 통과했다. 최신 글자200%/안정화 IME 결과는 최종 표에 별도로 반영한다.

[최종 실제 키보드 위 저장 화면](evidence/m11-compact-ime-400.png)을 직접 열어 입력 저장 버튼이 실제 IME 위에 표시되는 것을 확인했다. 초기 IME 창이 그려지기 전 검정 영역 캡처는 시각 증거에서 제외했다. 안정화 후 IME가 계속 열린지 검사하고 native screencap으로 OS 합성 화면을 채택했다.

상세 행동의 추가 검증: 일반 글자2/2 통과. 첫200% 묶음은 측정 예외로2개 성공 뒤3번째에서 process crash, 나머지6개 미실행이었다. 이 기록을 보존한다. 시험의 `captureToImage` 강제 프레임 캡처를 OS 합성 캡처로 교체해 기능/버튼 크기 assertion을 그대로 두고200% 묶음을 다시 확인한다. 예외를 잡아 통과시키거나 검사 조건을 제거하지 않았다. 최초 측정 예외의 전체 원인 해결을 단정하지 않는다.

## 최종 판정 · 제품 f686a1e / 시험858abb2

| 대상 | 결과 |
| --- | --- |
| 상세 응원 실패/복구·공유/신고 최소 크기, 일반 글자 | 2/2 통과·ANR없음 |
| 200% 글자 묶음, OS 합성 캡처 사용 | 9/9 통과·실패0·ANR없음 |
| 실제 IME·44px 입력/CTA·coordinate 저장·초안 | 1/1 통과·IME 유지 확인·실제 OS 캡처 직접 확인 |
| 360×400dp TODO 작성→재시도→완료→게시 | 1/1 통과·실제 IME 관측·설정 복원 |

[200% 상세 행동](evidence/m11-cheer-actions-font200.png)과 [실제 키보드 위 저장](evidence/m11-compact-ime-400.png)을 직접 열어 확인했다. 초기 실패/skip/측정 예외를 성공 건수에 더하지 않는다. OS 캡처로 전환한 마지막 실행에서는 측정 예외가 재현되지 않았으나 모든 Compose 측정 문제의 원인을 해결했다고 단정하지 않는다. 소프트웨어 API29의 이번 검증을 전체 지원 OS/실기기·전체 접근성·OS 프로세스 종료/복원 승인으로 확대하지 않는다.

최종 OS 캡처200% 묶음은9/9·실패0·ANR없음으로 통과했다. [상세 응원·공유·신고200%](evidence/m11-cheer-actions-font200.png)의 줄바꿈과 버튼 표시를 직접 확인했다. Compose BOM2025.05.01의 실제 UI1.8.2/Material3 1.3.2를 사용했고 의존성 버전은 바꾸지 않았다.

최종 정리: 합성 API 종료·두 계정 삭제0 확인·기기 fixture/역방향 포트 제거·역할 env/pgpass3종 제거를 검사하고 소유 ID/label의4개 컨테이너/tmpfs와runtime 설정을 제거했다. Docker --rm의 비동기 제거 뒤 ID/label 부재를 다시 감사했다. 로그/검토한 합성 PNG/APK 해시는 보존했고 운영 자료는 사용하지 않았다.
