# UI-02 · 탐색에서 내 TODO로 가져오기

2026-10-25 (Asia/Seoul). 기준 `codex/beta-core`, 시작 소스 `0a16046667f42cf4f837a3ffec93213e701be2cb`. 파스텔 시각 방향을 유지하며 피드·게시물 사진과 단일 TODO/루틴 가져오기 흐름을 보완한다. 실제 Google/Firebase·서명/Play·운영 배포 등 사용자 제공 항목은 계속 보류한다.

## 구현

| 영역 | 확인한 문제/필요 | 보완 |
| --- | --- | --- |
| 진입 상태 복원 | 폼 자체는 저장 상태를 지원하지만 피드의 가져오기 열림/상세의 루틴 열림은 `remember` 상태 | 계정·세션·게시물 범위 안에서 열림을 `rememberSaveable`로 보존. 실제 진입점에서 오류 후 화면 재생성과 같은 요청 확인을 시험 |
| 원본과 내 복사본 | 단일/루틴 설명이 동일한 강도의 문장으로 반복 | 공통 연하늘 요약에 원본 이름·루틴 항목 수와 새 내 항목/원본 유지 관계 표시. 편집 폼과 분리 |
| 루틴 미리보기 | KEEP/NONE에서 반복만 보여줘 항목별 실제 시작 날짜/간격을 알기 어려움 | 선택한 시작 날짜/시간·계정 시간대에 따른 항목 날짜/시간·분류·반복을 표시. CUSTOM 편집 상태를 덮지 않음 |
| 사진 상태 | 피드의 빈 로딩/일반 사진 오류 표시만으로 상태와 다음 행동이 불명확 | 전용 FeedPhoto에 로딩·실패·명시적 사진 재시도·표시 완료를 구분. 오류 내용은 사진 비율 밖에서 글자 크기에 따라 늘어나며 본문과 행동을 유지 |
| 원본 정보 누락 | 분류가 없으면 루틴으로 표시하고, 원본 ID가 없는 가져오기 버튼은 아무 폼도 열지 못함 | 없는 분류/유형을 추정하지 않고 실천 기록으로 표시. 원본 확인 진입을 제공하며 ID 없는 clone 요청을 만들지 않음 |

기존5탭·서버/API·공개 기본값·복제 정책·사진 업로드/카메라/선택기·게시·미확인 쓰기의 본문/키/만료·계정 검사는 변경하지 않는다. FeedPhoto의 이미지 GET은 사진만 재시도하며 게시물 재조회나 쓰기를 만들지 않는다. 기존 공통 Photo의 채팅/프로필 사용 경로는 유지한다.

루틴 일정은 현재 화면의 원본 snapshot으로 계산한 미리보기다. 서버 원본이 달라지면 실제 가져오기는 서버의 현재 내용을 사용한다는 안내를 유지한다. KEEP/NONE은 원본의 절대 시간 간격을 보존하고 NONE은 반복만 제거해 표시한다. CUSTOM은 보존한 항목별 편집을 보여준다. 잘못된 일정을 임의 날짜로 표시하지 않고 오류를 안내한다.

## 검증 범위

Android unit154/20 suites 실패0/skip0, Debug/시험 APK·lint 통과. 새 unit2개는 DST를 지나는26시간 간격·시작/모드 변경과 CUSTOM 편집 보존, 잘못된 미리보기의 비변경/비전송을 검사한다. root lint/test/build·격리 PostgreSQL/Redis/MinIO의 API160/Web53 모두 실패0/skip0.

새 연결 시험4개는 제품 진입점의 피드/상세·Compose 폼과 loopback HTTP를 사용한다. 사진은 시험 코드에서만 생성한 LOCAL TEST 이미지다. 지연 응답의 로딩·503 사진 오류·명시적 재시도 후 실제 디코딩 완료, 피드의 단일 가져오기 오류/복원, 상세의 루틴 Back/미리보기/오류/복원, 원본 없는 기록의 표시/진입을 각각 검사한다. 이전의 직접 RoutineImportSheet 시험도 유지한다.

실제 OS 프로세스 종료/복원과 Compose StateRestorationTester는 다르다. 이번 복원은 저장 상태/재합성의 검증이며 실제 프로세스 종료를 통과로 표시하지 않는다. 실제 사용자의 사진·저장소·권한·실기기/TalkBack·지원 전체 OS·운영 연결/출시는 미검증이다. 권한 변경/공개 원본 정책은 기존 서버 검증과 구분하며 이번 화면 검사를 전체 인수 검수로 확대하지 않는다.

## 실행 환경과 복구

새 API29 AOSP x86_64/360×780/density160 AVD의 첫 부팅은 userdata 공간 부족으로 시작하지 못했다. emulator.log의 FATAL은 available7172.37MB/need7372.80MB였으며 부팅 감시가360초 뒤 종료했다. 앱 빌드나 앱 테스트 실패가 아니다.

소유 컨테이너 종료와 과거 정리 기록을 확인한 이전 검증 AVD3개의 재생성 가능한 userdata/cache 및 설치용 zip2개만 정리해2.54GiB를 회수했다. 기존 로그·원본 캡처·설치된 SDK/JDK·소스·다른 개발 컨테이너를 유지했다. 같은 새 AVD는 복구 후112.4초에 부팅했다. 최초 실패 로그와 복구 로그/디스크 정리 목록을 별도로 보존한다. RAM 입력1536MiB는 emulator가2048MiB로 자동 증설했다고 로그에 남겼다. Docker10GiB/4CPU·소프트웨어 CPU·SwiftShader를 사용한다.

원본 로그·이미지·APK·disk-recovery/boot-recovery-result는 `/workspace/mungsil-setup/ui02-import-20261025`, root 로그는 `/workspace/mungsil-setup/ui02-import-20261025-services`다. [재현 안내](../../../infra/verification/android-v1/README.md)와 [실행 선택표](../../../infra/verification/android-v1/device-matrix.json)를 제공한다. GitHub Actions·billing·workflow·Release/Google/FCM을 조사하거나 재시도하지 않는다.

## 연결 실행의 단계 구분

| 단계 | 소스/조건 | 실제 결과 |
| --- | --- | --- |
| 초기 ui02-360/390/430/200 | 새4개 + 기존 반복/계정/복잡 반복3개, 폭/글자 반복 | 7+4+4+4회 통과, OS ANR 없음 |
| 초기 ui02-ime | 실제 IME 관측과 설정 복원 | 1/1 통과 |
| ui02-touch360/390/430/200·ime-final | 입력/저장 버튼의 보이는44dp 이상·좌표 클릭·캡처를 강화한 시험 | 각각1개, 총5회 통과. IME 표시는 관측했지만 ime-final의 검은 키보드 영역 PNG는 시각 통과 증거에서 제외 |
| ui02-os360 | OS 합성 캡처로 시험을 변경한 뒤4개 묶음 | 1개 통과, 루틴 실행 중 test host Activity 종료의 Compose detach 예외로 프로세스 종료. 나머지2개 미실행, 묶음 실패 |
| ui02-os-routine | 같은 루틴 메서드를 단독 실행해 범위 분리 | 1/1 통과, OS ANR 없음 |
| 최종 ui02-dialog360/200 | Dialog 대상으로 Back, 반복 선택 전후 확인, OS 원본 캡처 | 각각4/4, 총8회 통과. OS ANR 없음 |
| 최종 ui02-ime-qualified | 입력 후와 저장 직전 실제 IME 표시 검사, 보이는 입력/저장44dp 이상·좌표 클릭 | 1/1 통과. 실제 키보드 원본 확인·관측 종료·원래 설정 복원 성공, OS ANR 없음 |

제품 코드는 위 단계 사이에 바꾸지 않았다. 이후 시험에서 Dialog 창을 대상으로 Back을 보내고, Back 전후 반복 모드 선택을 확인하도록 대상을 명확히 했다. dirty 확인·초안·본문/키·기존 기대 결과를 삭제하지 않았다. Activity 종료 예외와 원본 로그는 보존하며 전역 Back 타이밍이 유일한 원인이라고 단정하지 않는다. 최종 결과를 별도로 기록한다.

복원/키보드 캡처는 최종 시험에서 OS `screencap -p` 원본을 사용한다. `ime.py`는 관측/원래 설정 복원 외에 `requireIme` 인자를 전달하고 새 단일 가져오기 시험은 입력 후·저장 좌표 클릭 직전 IME 표시를 직접 검사한다. 정상/큰 글자/키보드 조건의 입력과 저장은 보이는44dp 이상을 검사한다. 설정을 켰다는 사실이나 검은 영역 PNG만으로 실제 화면 검수를 통과 처리하지 않는다.

## 소스와 산출물

검증 제품/최종 시험·도구 소스는 `88630e162fb40f715a4e3b9b8b931cf254ccf97f`다. checkout 밖 `artifact-manifest.json`에도 이 소스를 기록했다. 이후 변경은 규칙·문서·원본 PNG뿐이다. 초기/터치/OS 첫 시험 APK manifest도 단계별로 보존한다. 제품 APK는 단계 사이에 바뀌지 않았으며 최종 시험 APK는 Dialog 범위 Back과 OS/IME 검사를 포함한다.

| 산출물 | bytes | SHA256 |
| --- | --- | --- |
| Debug APK | 24660819 | `36c09e3fa02623b1651c513b7186386f31215d47ac0daff9eedeb9865c6c2dc2` |
| 최종 시험 APK | 1392316 | `53dbefaa1b53eef27967884c533fc262b9d3689dc04697427f34b6dc811b1d14` |

APK는 Git에 넣지 않았다. Release 서명/배포 없음. `run-summary.json`은 성공과 실패 단계를 모두 보존하고 `visual-review.json`은 채택한 원본 경로/해시와 제외한 검은 키보드 캡처를 구분한다. 기존 초기 묶음과 최종 묶음은 같은 고유 시나리오의 반복이며 신규 시험 건수로 합산하지 않는다. 최종 Back 범위 변경 후390/430 전체 묶음은 다시 실행하지 않았고, 해당 폭의 제품 근거는 초기4/4와 후속 단일 가져오기1/1이다.

## 직접 검토한 원본 화면

실제 FeedScreen/PostScreen과 폼을 테마 적용 시험 호스트에 올린 합성 HTTP 화면이다. 전체 NativeApp 셸·5탭 전환·실사용자 자료·실제 두 계정 검수의 증거는 아니다. LOCAL TEST 사진은 시험에서 생성한 도형 이미지다. 원본11장을 편집 없이 보존했다. 스크롤 캡처의 일부 앞/뒤 내용이 화면 밖에 있는 것과 잘림을 구분한다. 200% 시트 제목의 마지막 글자 단독 줄은 남아 있으며 UI-03의 문구/간격 검토 대상으로 둔다. API29 OS 상태바의 큰 글자 시계는 앱 영역과 구분한다.

| 화면 | 원본 |
| --- | --- |
| 사진 로딩·표시 완료 360dp | [로딩](evidence/ui02-photo-loading-360.png) · [완료](evidence/ui02-photo-loaded-360.png) |
| 사진 실패·재시도, 글자200% | [오류](evidence/ui02-photo-failed-200.png) |
| 단일 가져오기 360/430dp | [360](evidence/ui02-single-360.png) · [430](evidence/ui02-single-430.png) |
| 루틴 원본·미리보기 360/390dp·글자200% | [원본](evidence/ui02-routine-360.png) · [390](evidence/ui02-routine-preview-390.png) · [200%](evidence/ui02-routine-preview-200.png) |
| 미확인 결과 복원, 글자200% | [잠긴 초안](evidence/ui02-single-restored-200.png) |
| 실제 IME 입력·저장 직전 360dp | [입력](evidence/ui02-ime-edit-360.png) · [저장](evidence/ui02-ime-save-360.png) |

## 정리와 후속

소유 Android·임시 PostgreSQL/Redis/MinIO 컨테이너와 runtime credential/state 파일을 제거했다. Android stop 직후의 첫 inspect는 비동기 자동 제거보다 앞서 실패했으며 후속 inspect로 실제 부재를 확인했다. 기존 무관한 개발 컨테이너·SDK·로그·원본 캡처를 유지했다. `cleanup.json`에 기록했으며 운영 변경은 없다.

이번은 UI-02의 로컬 개발 환경 구현·선별 검증이다. 간헐적인 시험 호스트 detach 예외를 전체 기기에서 해결했다고 주장하지 않는다. 다음은 UI-03 작성·편집·게시·공통 시트의 긴 제목/도움말·오류·사진 상태·키보드/닫기/복원 검수다. UI-04/05와 실제 권한 변경·실기기·운영 연결 검수는 계속 남는다.
