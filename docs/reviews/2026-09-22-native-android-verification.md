# Android 네이티브 전환 로컬 검증 — 2026-09-22

## 구현과 배포 경계

- TWA 런처를 Kotlin/Compose 네이티브 `kr.kro.mungsil.MainActivity`로 교체했다.
- 기존 패키지 `kr.kro.mungsil`, 기존 업로드 키를 유지하고 versionCode 2/versionName 1.1.0으로 빌드했다.
- 기존 `.dockerignore` 미커밋 변경을 보존했으며 Android 캐시 제외 항목만 추가했다. API 구현, DB 스키마와 운영 리소스는 수정하지 않았다.
- Play 업로드, 서버 SSH 접속/배포, 운영 계정 로그인, 실제 사용자 데이터 변경을 수행하지 않았다. UI 테스트는 기기 내부 MockWebServer 합성 데이터만 사용했다.
- 상세 기능 범위와 미이식 항목은 `../android-release.md`를 참고한다. 정식 출시 완료 또는 웹과의 완전한 기능 동등성을 의미하지 않는다.

## 통과한 검사

- `npm run lint`: Web/API 통과.
- `npm test`: API 107건 중 103 통과, 조건부 통합 4 skip. Web 53/53 통과.
- `npm run build`: 계약 패키지, API, Web 전체 빌드 통과. 최초 샌드박스 네트워크에서 Prisma 다운로드가 거부되어 허용된 네트워크에서 순차 재실행했다.
- `:app:testDebugUnitTest`: 8/8 통과. refresh cookie 회전, 401 후 동일 요청 키 재시도, 동시 요청의 단일 refresh, 세션 삭제 뒤 늦은 로그인 응답 거부, 만료 시 토큰 삭제, 통신 실패 시 자격 보존, 내부 오류 비노출, 시간대/DST 날짜 경계, 메시지 ID 중복 제거와 반복 null 직렬화를 확인했다.
- `:app:lintDebug`: 오류 0. 경고 16건(기존 런처 아이콘 중복/원형, 버전별 백업·debug network 속성, 동기 prefs 저장/KTX 제안). 경고를 숨기는 baseline은 추가하지 않았다.
- `:app:assembleDebug`, `:app:assembleDebugAndroidTest`, `:app:bundleRelease`: 통과.
- `jarsigner -verify`: 서명 확인. 업로드 키의 자체 서명·타임스탬프 부재 경고는 표시되며 서명 검증 실패는 아니다.
- `aapt dump badging`: 패키지/버전 2/1.1.0, minSdk23/targetSdk36, 네이티브 `MainActivity` 실행 진입점 확인.
- 서명 SHA-256: `BA:8F:A4:C9:BE:87:92:0F:5B:B1:A7:BB:BE:2B:48:8A:A6:B6:05:21:54:21:F7:F5:43:6A:FA:09:39:D2:F2:34` (기존 업로드 키와 동일).

## 기기 자동화

Android 16(API 36.1) 에뮬레이터에서 합성 HTTP 응답으로 다음 7개 흐름을 검사한다.

1. TODO 생성 503 실패 → 초안 유지 → 같은 요청 키 재시도 → 완료 → 게시.
2. 댓글 503 실패 시 초안 유지와 같은 요청 키 재시도, 커서 페이지 중복 제거.
3. 네이티브 로그인·둘러보기 및 다섯 탭 이동.
4. 채팅 전송 실패 시 초안 유지.
5. 단일 TODO 가져오기에서 복합 RRULE 원문 유지와 PRIVATE 저장.
6. 알림 진입 시 읽음 POST 없음, 명시적 개별 읽음만 요청.
7. 차단 대화의 기존 기록 보존과 작성창 비노출.

실행 로그와 PNG는 `outputs/android/native-verification`에 있다. 화면별 최종 실행 결과는 이 기록 아래에 추가한다.

## 실패에서 수정한 사항

- 최초 기기 테스트는 구형 Espresso의 `InputManager.getInstance` 호환성 오류로 시작하지 못했다. Espresso 3.7.0/runner 1.7.0으로 수정했다. 근거: https://developer.android.com/jetpack/androidx/releases/test
- 모달이 열린 상태에서 Compose root가 둘이 되는 캡처 오류를 전체 기기 캡처로 수정했다.
- 낮은 화면에서는 LazyColumn에 아직 구성되지 않은 CTA를 찾아 스크롤하도록 테스트 하네스를 수정했다.
- 사진 업로드 중 게시가 먼저 실행되지 않게 저장을 잠그고 재시도를 제공했다. 큰 글꼴 탭 이름의 한 줄 제한을 제거했다.
- 웹의 기존 TWA 런처 고정 검사를 네이티브 실행 진입점과 브라우저 래퍼 부재 검사로 갱신했다.

## 남은 확인

- 실제 테스트 계정의 서버 로그인/핵심 순환, 사진 스토리지 업로드, 두 기기 소켓 단절·복구와 권한 변경. 합성 UI 테스트를 서버 E2E로 계산하지 않는다.
- 실물 Android의 키보드/사진 선택/TalkBack/회전·프로세스 종료/최저 지원 버전.
- Google 로그인, FCM 푸시, 카메라 직접 촬영, 네이티브 App Links, 웹 추가 기능의 이식은 별도 후속 범위다.
- Play 내부 테스트 업로드 및 Play 서명으로 설치된 기존 버전에서 업데이트 확인.

## 2026-09-23 후속 수정

이전 재검증의 알림 타임아웃을 화면 트리와 함께 추적했다. HTTP 응답이 도착한 뒤에도 LazyList에 항목이 반영되지 않는 실제 갱신 누락을 확인하여 `RemoteSnapshot`/`PageSnapshot`으로 수정했다. 알림 시험에 300ms 응답 지연을 넣었으며 수정본에서 다시 검증한다. 이전 타임아웃은 단순 테스트 하네스 문제로만 분류하지 않는다.

공통 시트 종료 시 포커스/키보드를 해제하고 상태 표시줄 여백을 반영했다. AAB 내부 검사에서 네이티브 MainActivity/Compose 포함, androidbrowserhelper 부재, MockWebServer 부재, debug HTTP 리소스 부재, 서명 비밀 파일 부재를 확인했다.

Android CI workflow는 추가하고 YAML 구문을 확인했지만 GitHub runner에서는 아직 실행하지 않았다.

## 최종 화면별 결과와 배포 파일

갱신 누락 수정 후 합성 API 기기 테스트를 아래 조건에서 통과했다. 화면 폭은 density 160에서 dp와 동일하게 맞췄다.

| 조건 | 통과 |
| --- | --- |
| 360×800 | 7/7 |
| 390×844 | 7/7 |
| 430×932 | 7/7 |
| 360×400 낮은 화면 | TODO 실패·재시도·완료·게시 1/1 |
| 360×800, 글꼴 200% | 로그인·5탭 1/1 |

23회 실행 결과는 `apps/android/native-matrix.log`, 개별 결과와 캡처는 `outputs/android/native-verification`에 남겼다. 이 범위는 모든 화면의 모든 접근성 상태를 검증했다는 의미가 아니다.

최종 입력 개선으로 주 행동 실행 시 키보드를 닫고, 댓글 전송 오류를 댓글 입력 바로 아래에 표시했다. 이후 debug APK, 테스트 APK, lintDebug와 서명 release AAB를 다시 빌드했다.

마지막 변경 후 360×800 전체 7/7과 360×400 TODO 흐름 1/1을 다시 통과했다(`apps/android/native-final-ui.log`). 첫 재실행은 에뮬레이터 APK 설치와 화면 캡처가 응답하지 않아 중단했고, 데이터 삭제 없이 콜드 부팅한 뒤 재실행했다. 앱 테스트 실패로 계산하거나 설치 대기를 통과로 기록하지 않았다.

- 배포 파일: `outputs/android/mungsil-native-1.1.0-2.aab`
- 패키지/버전: `kr.kro.mungsil`, 1.1.0 (2)
- 파일 크기: 12,254,055 bytes
- 파일 SHA-256: `E05EA762386DAC1A4CC9D6EDD2A80D2773672A287E70C798279F9D5A5A13CD28`
- 최종 파일의 `jarsigner -verify` 통과 및 기존 업로드 인증서 일치 확인.
- 최종 ZIP/DEX 검사: MainActivity·Compose 포함, androidbrowserhelper·MockWebServer·debug network 설정·서명 비밀 파일 없음.

내부 테스트 후보 파일을 준비한 것이며 Play 업로드·운영 서버 연동 검증·정식 출시는 수행하지 않았다.
