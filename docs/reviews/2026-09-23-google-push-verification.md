# Google 로그인·FCM 로컬 검증 — 2026-09-23

## 변경 범위

- Android Credential Manager의 Google 버튼을 기존 `auth/google` 서버 API와 연결했다. 신규 계정은 공통 시트에서 아이디·생년월일·초대 코드·약관 확인을 받고 계정을 다시 선택해 가입한다. Google ID 토큰은 저장하지 않고 서버의 access/refresh 세션만 수락한다.
- 로그인 설정은 서버 `auth/config`의 웹 OAuth client ID를 사용한다. 기존 서버 Google 로그인 구현은 바꾸지 않았다.
- Android 설정에 푸시 켜기/끄기·권한 요청·OS 알림 설정을 추가했다. FCM 토큰 등록·회전·재시도는 WorkManager를 사용한다. UI와 worker는 같은 Api 인스턴스의 갱신 잠금을 공유한다.
- 푸시 등록은 서버 세션에 묶는다. 로그아웃/탈퇴/정지/만료 시 발송하지 않고 수신 앱에서도 서버 세션·알림 소유권·미열람 여부를 확인한다. 계정 변경 시 로컬 알림과 동의를 초기화한다.
- FCM에는 사용자 ID·알림 ID·이벤트 ID만 보내며 OS에는 내용 없는 새 소식 요약 하나를 표시한다. 탭하면 같은 계정의 네이티브 알림함을 열고 자동 읽음 요청을 보내지 않는다.
- 신규 `PushDevice` migration과 API, 발송 worker, FCM HTTP v1/ADC 인증, 일시 실패 재시도·UNREGISTERED 토큰 정리를 구현했다. 긴 토큰을 직접 PostgreSQL unique 인덱스에 넣지 않도록 SHA-256 해시 인덱스를 사용한다.
- Compose의 푸시 환경 변수와 선택적인 서비스 계정 파일 overlay를 추가했다. 서버 비밀은 앱 또는 이미지에 넣지 않는다.

## 통과한 로컬 검사

- 전체 `npm run lint` 통과.
- `npm test`: API 115건 중 111 통과/4 조건부 통합 skip, Web 53/53 통과. 최종 토큰 해시 인덱스 수정 뒤 API lint·전체 API 테스트를 다시 통과했다.
- `npm run build`: contracts/API/Web 통과.
- Android `testDebugUnitTest`: 10/10 통과. Google 프로필 요구 응답에서 토큰을 저장하지 않는 동작, 프로필 완료 뒤 서버 세션 저장, 잘못된 Google 인증 거부를 추가했다.
- Android `lintDebug`: 오류 0, 경고 26건. 주로 기존 아이콘·버전별 백업 속성 및 SharedPreferences/KTX 제안이며 baseline으로 숨기지 않았다.
- `assembleDebug`, `assembleDebugAndroidTest`, `bundleRelease` 통과. `jarsigner -verify` 통과(기존 자체 서명/타임스탬프 경고 유지).
- Compose YAML 구문 검사와 `git diff --check` 통과. 컨테이너 실행 검증과는 구분한다.
- 서버 테스트 8건: 발송 후 커서 갱신, 실패 시 커서 유지·재시도, 만료 토큰 제거, 세션 취소·worker 선점 시 미발송, 읽음/삭제 알림 제외, 기기 해제 소유권, 토큰 회전/계정 전환, HTTP v1 요청·오류 분류. 모두 FCM/DB 테스트 대역을 사용했다.

## 기기 테스트 기록

실제 Google 계정을 사용하지 않고 기기 내부 MockWebServer와 테스트 코드의 합성 Google 토큰 공급자를 사용했다. 기존 7개 흐름에 Google 가입, 알림 탭 시 읽음 요청 없음, 계정 전환 시 이전 알림 차단을 추가했다.

기기 검사는 `verify-native.ps1`이 APK를 설치한 뒤 AndroidJUnitRunner를 `adb shell am instrument`로 실행했다. 이 결과를 Gradle `connectedDebugAndroidTest` 태스크 자체의 실행 결과로 기록하지 않는다.

- 360dp, 390dp 각각 10/10 통과.
- 첫 430dp 실행은 9/10 통과. 기존 TODO 저장 시험에서 POST 요청 전에 시트가 닫혔으며 키보드 전환 중 좌표 주입이 빗나갔을 가능성이 있다. 최초 기록은 `outputs/android/native-verification/430-initial-failure.txt`에 보존했다.
- TODO 저장 동작 시험은 스크롤 후 같은 버튼의 접근성 클릭 동작을 호출하도록 수정했다. 이를 실제 손가락 좌표·키보드 실기기 검증으로 계산하지 않는다.
- 이 변경의 첫 재실행은 저장 버튼 안의 텍스트 노드에 OnClick이 없어 실패했다. 실제 클릭 동작을 가진 버튼 노드를 선택하도록 하네스를 수정한 뒤 430dp 전체 10/10을 통과했다. 두 번째 실패도 `430-selector-failure.txt`로 보존했다.
- 낮은 화면/글꼴 200%에 Google 가입 시트 검증을 추가했다. 최종 결과는 아래에 기록한다.

최종 동작 결과: 360·390·430dp 각각 10/10, 360×400 TODO 흐름 1/1, 글꼴 200% 로그인·5탭 1/1, Google 가입 360×400 1/1 및 글꼴 200% 1/1을 통과했다. 430dp 캡처에서는 CTA가 키보드 위에 표시됐다. 360×400 및 글꼴 200% 최초 캡처에는 키보드·Gboard 글꼴 변경 배너로 CTA 일부가 가려져 있으므로 해당 캡처만으로 키보드 가림 없음 판정을 내리지 않는다. 키보드를 닫은 안정 상태의 CTA 도달 캡처를 추가로 확인한다. 실행 로그는 `native-google-push-matrix.log`와 `native-google-push-followup.log`, 이미지/개별 결과는 `outputs/android/native-verification`에 있다.

최종 release AAB ZIP/DEX 검사에서 MainActivity·Credential Manager·FCM 서비스 포함, MockWebServer·debug HTTP 리소스·서명/서비스 계정 키 파일 부재를 확인했다. Firebase 설정 없는 검증용 빌드라는 제한은 유지한다.

추가 캡처 검증: `google-low`, `google-font200` 각각 1/1 재통과. `google-profile-ready.png`에서 키보드를 닫은 뒤 가입 버튼 전체와 약관 확인 영역에 도달함을 확인했다(`native-google-push-capture.log`). 키보드가 열린 초저높이 화면의 부분 가림을 해결한 것으로 확대 해석하지 않는다. 이번 추가 실행은 테스트 하네스와 기록만 수정했으며 제품 코드·release 번들은 변경하지 않았다.

## 실행하지 않은 확인과 배포

- 후속으로 공개 `GET https://mungsil.kro.kr/api/v1/auth/config`만 읽기 전용 조회했다. Google 활성화와 웹 클라이언트 ID를 확인해 설정 문서에 기록했다. 사용자 로그인·관리 API·SSH·데이터 변경은 수행하지 않았으며 이 요청을 운영 E2E로 계산하지 않는다.

- 실제 Google Credential Manager 계정 선택, Play 서명 설치본의 OAuth 검증, 실제 Firebase 토큰 발급·FCM 수신은 하지 않았다.
- 신규 migration을 실제 PostgreSQL에 적용하거나 운영 서버를 배포하지 않았다. 컨테이너 실행, 실제 권한/DB/네트워크/스토리지 통합 검증도 하지 않았다.
- 최초 검사 당시 `google-services.json`이 없어 Firebase 기본 앱이 구성되지 않았다. 이 초기 번들은 서명/컴파일 검증용으로만 사용했다. 이후 사용자 파일을 반영한 결과는 아래 후속 기록을 따른다. 기존 출력 경로의 1.1.0/code 2 AAB는 그대로 보존했다.
- API 변경은 푸시에 필요한 신규 범위다. 운영 적용 시 migration·API 배포·서버 ADC 설정이 필요하다. 클라이언트 버전은 1.1.1/code 3이다.
- 발송은 기존 알림을 주기 조회하는 요약 알림 방식이며 24시간 이내 변경을 대상으로 한다. 메시지마다 반드시 푸시가 한 번씩 도착함을 보장하는 전달 큐는 아니다. Android 절전·강제 종료·네트워크 및 긴 DB 트랜잭션 등의 조건에서 누락/지연 가능성이 있어, 전체 기록은 앱 알림함을 기준으로 한다.

콘솔 설정과 필요한 값은 [Google·푸시 설정](../android-google-push-setup.md)을 따른다.

## 사용자 Firebase 설정 반영 후 재빌드

- 사용자가 제공한 `google-services.json`을 앱 모듈에 복사했다. 패키지 `kr.kro.mungsil`, Firebase 프로젝트 `mungsill`, 발신자 ID `548748244786`을 확인했으며 파일은 Git 제외 상태다. 기존 Firebase Messaging 의존성과 Google Services 플러그인을 사용했고 Analytics는 추가하지 않았다.
- `:app:testDebugUnitTest :app:lintDebug :app:bundleRelease` 재실행 통과. 단위 테스트 10/10, lint 오류 0/경고 26건이다. 실행 기록은 `apps/android/native-firebase-config-build.log`에 있다.
- 생성된 release 리소스와 실제 AAB의 `resources.pb`에서 프로젝트/발신자/앱 ID를 확인했다. DEX에는 네이티브 MainActivity, Credential Manager, FCM 서비스가 포함되고 MockWebServer는 없다. 번들 경로에서 debug 네트워크 설정·키스토어·Firebase 서버 키 파일이 발견되지 않았다.
- `jarsigner -verify` 통과. 기존 업로드 키 SHA-1 `B7:FB:58:CC:71:05:5C:0A:14:A5:C5:2E:64:DE:9E:A9:74:B4:B5:4D`와 일치하며 자체 서명/인증 경로/타임스탬프 경고는 남는다.
- 결과: `outputs/android/mungsil-native-1.1.1-3.aab`, 14,858,713 bytes. SHA-256: `4E04753D867BA06BDCE2C57989BAEECC4EB4F274E2373E870A5D0F18434ED61F`.
- 이 후속 작업에서는 기기 instrumentation을 재실행하지 않았다. 위 UI 결과는 Firebase 설정을 넣기 전 합성 테스트 결과다. 실제 Google 로그인·토큰 발급·FCM 발송/수신·Play 업로드와 서버 접속/배포/migration은 수행하지 않았다. 서버의 `mungsill` 발송 권한과 API/DB 반영은 별도 필요하다.
