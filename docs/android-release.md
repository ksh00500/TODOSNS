# 뭉실 Android 네이티브 앱

`apps/android`는 Kotlin + Jetpack Compose로 화면을 그리는 Android 클라이언트다. 버전 1의 TWA/Chrome 실행 방식은 제거했다. 웹 서비스와 API는 계속 별도로 존재하며 Android는 HTTPS REST와 Socket.IO로 같은 서버에 연결한다. 앱의 주 화면에 WebView를 사용하지 않는다.

- 패키지: `kr.kro.mungsil` (유지)
- 현재 소스 버전: `1.2.0`, versionCode `5`. 현재 Play 최고 코드는 별도 확인 필요.
- 과거 제공 AAB: `outputs/android/mungsil-native-1.1.1-4.aab` 및 아래 2026-09-28 기록. 이번 소스에서 새로 생성한 파일로 간주하지 않는다.
- versionCode `3` 번들은 최소 SDK 23으로 Play 자동 보호가 켜진 콘솔에서 업로드 거부됐다.
- 이전에 제공한 AAB: `1.1.0`, versionCode `2` (Google·푸시 미포함)
- Android: minSdk 24(Android 7.0 이상), targetSdk/compileSdk 36
- 기본 언어: 한국어
- API: `https://mungsil.kro.kr/api/v1/`
- 기존 업로드 키 유지. Play App Signing 인증서와 업로드 인증서는 서로 다를 수 있다.

2026-10-24 Cloud 검증: Debug·unit152·lint 통과. 현재 `keystore.properties`와 `app/google-services.json`이 없으며 Release 빌드는 기존 서명 guard에서 차단됐다. 새 서명 AAB·실제 Google/FCM·Play 업로드는 미검증이다. 과거 운영 반영 기록은 당시 이력이며 이번 환경에서 재검증한 결과와 구분한다. [M-12 운영/릴리스 결과](redesign/android-v1/implementation-m12.md)를 따른다.

## 빌드와 로컬 검증

JDK 17 이상과 Android SDK 36이 필요하다. 현재 개발 PC에서는 JDK 21을 사용했다.

```powershell
$env:ANDROID_HOME = "$env:LOCALAPPDATA\Android\Sdk"
$env:ANDROID_SDK_ROOT = $env:ANDROID_HOME
cd apps/android
.\gradlew.bat :app:assembleDebug :app:testDebugUnitTest :app:lintDebug
.\gradlew.bat :app:connectedDebugAndroidTest
```

서명 설정은 기존 `apps/android/keystore.properties`를 사용한다. 키 파일이나 비밀번호를 Git에 추가하지 않는다. 기존 앱을 업데이트할 때 업로드 키를 새로 생성하지 않는다.

```powershell
.\gradlew.bat :app:bundleRelease
.\scripts\verify-bundle.ps1 -Jdk 'C:\Program Files\Java\jdk-21' -VersionCode 5 -VersionName '1.2.0'
```

- APK: `apps/android/app/build/outputs/apk/debug/app-debug.apk`
- AAB: `apps/android/app/build/outputs/bundle/release/app-release.aab`
- UI 자동화: `app/src/androidTest/java/kr/kro/mungsil/NativeFlowTest.kt`
- HTTP/세션/날짜 단위 검사: `app/src/test/java/kr/kro/mungsil/ApiTest.kt`

에뮬레이터 해상도별 합성 테스트 및 PNG 캡처:

```powershell
.\gradlew.bat :app:assembleDebug :app:assembleDebugAndroidTest
.\verify-native.ps1 -Device emulator-5554
```

`verify-native.ps1`은 에뮬레이터만 허용하며 360/390/430dp, 360×400dp, 글꼴 200%를 검사한 뒤 화면 설정을 복원한다. 결과는 `outputs/android/native-verification`에 저장한다. 테스트는 기기 내부 MockWebServer와 합성 계정을 사용한다. 이 결과는 실제 서버 DB·스토리지·두 계정 소켓 E2E 검증을 대신하지 않는다.

## 구조와 정책

- `MainActivity.kt`: 네이티브 실행 진입점, 세션 복원, 다섯 탭과 상세 화면.
- `data/Api.kt`: API 오류 변환, 같은 요청 키로 재시도, 갱신 요청 직렬화, 로그아웃 이후 늦은 응답 거부.
- `data/SecureSessionStore.kt`: Android Keystore AES-GCM으로 refresh 토큰 암호화. access 토큰은 메모리에만 저장한다. 백업·기기 전송에서 앱 데이터를 제외한다.
- `ui/Components.kt`: 색상·카드·라벨·오류·공통 `NativeSheet`·날짜 선택기. 시트 본문 하나만 스크롤하며 IME와 시스템 여백을 반영한다.
- 각 기능 화면은 기존 서버 정책과 응답을 사용한다. 서버 API/DB 스키마를 이번 네이티브 전환을 위해 수정하지 않았다.
- 2026-09-23 후속 푸시 구현에서는 `PushDevice` DB migration, 등록/해제/수신 확인 API와 FCM 발송 worker를 추가했고 운영 서버에 반영했다. Google 로그인은 기존 서버 API를 재사용한다.
- 일반 API는 HTTPS만 사용한다. 테스트용 loopback HTTP 예외는 debug 리소스에만 있다. 업로드 URL에는 인증 헤더를 보내지 않는다.
- 사진은 선택 후 업로드하고 업로드가 완료되기 전에는 게시·인증·프로필 저장을 막는다. 저장 API가 실패해도 업로드된 mediaId와 입력을 유지한다.
- 완료·응원은 즉시 반영하되 실패 시 복원하고 재시도 안내를 표시한다. 같은 실패 재시도는 같은 요청 키를, 성공 후 새로운 행동은 새 키를 사용한다.
- 채팅은 REST 저장 후 갱신하며 소켓 연결 때 방에 다시 참여하고 REST로 기록을 복구한다. 10초 간격 조회를 병행하고 화면이 백그라운드면 중지한다. ID로 중복을 제거하고 과거를 보는 중 새 메시지 수를 표시한다.

## 이번 네이티브 버전의 범위

구현: 이메일 로그인/가입/인증 메일 재전송/재설정 메일, 공개 둘러보기, 오늘·TODO 일정, TODO 생성/편집/삭제/완료/완료 취소/반복 선택, 그룹 생성·편집과 서버 검색, 카테고리 생성·편집·숨김·목록, 피드·검색·게시·응원·댓글·신고·단일/루틴 가져오기, 챌린지 조회/참여/탈퇴/체크·사진 인증/사진 검수/순위, 프로필 수정/팔로우/차단/해제, 명시적 알림 읽음, 1:1/챌린지 대화·요청·수락·거절·사진·답장·반응·삭제, 로그아웃/모든 기기 로그아웃/탈퇴.

아직 웹과 기능이 완전히 같지는 않다. 다음 항목은 출시 전 별도 구현/실기기 검증 대상으로 남는다.

- Google 네이티브 로그인·신규 가입 코드 추가 완료. Play 서명 인증서에 맞춘 OAuth 콘솔 설정과 실제 계정 확인은 남았다.
- FCM 푸시 수신·권한·토큰 회전·계정 분리 및 서버 발송 코드 추가 완료. Firebase 프로젝트 `mungsill`의 클라이언트 설정을 번들에 반영했다. 2026-09-23 DB migration·API 배포·서버 발송 인증 연결과 활성화를 완료했다. FCM 검증 전용 요청은 통과했으며 실제 휴대폰 수신 검증은 남았다. 상세 설정은 [Google·푸시 설정](android-google-push-setup.md)을 따른다.
- 카메라 바로 촬영, 사진 업로드의 실제 스토리지 연동 확인. 현재 사진 선택은 시스템 파일/사진 선택기를 사용한다.
- Android App Links·이메일 인증/비밀번호 재설정·공유 약관 원문의 네이티브 화면은 구현했다. 실제 메일 링크의 OS 연결과 assetlinks 웹 호스팅 반영은 별도 확인한다.
- 챌린지 생성/편집/사진 재인증, 대화 수정·방장 관리, 카테고리 정렬, 월간 날짜 시트는 구현했다. 전체 상태·권한 검증은 남아 있으며 운영자 센터는 웹에 유지한다.
- 루틴 항목별 제목·날짜·시간·반복은 저장 상태 복원과 모드 전환 중 유지한다. KEEP/NONE의 원본 간격은 서버에 맡기고 CUSTOM 초기 일정도 상대 간격을 보존한다. 실제 프로세스 종료와 두 계정 핵심 순환 검증은 남아 있다.
- 실기기 TalkBack·키보드·사진 선택·회전/프로세스 종료 복구, 두 계정 실제 채팅/차단과 소켓 재연결, 최저 지원 Android 테스트.

따라서 이 버전은 네이티브 내부 테스트 후보이며 정식 출시 승인이나 기존 웹 전체 기능 동등성 검증을 뜻하지 않는다.

## Play 내부 테스트 업데이트

1. 기존 `kr.kro.mungsil` 앱의 내부 테스트 트랙에서 새 버전을 만든다.
2. 이미 사용한 versionCode보다 높은 서명 AAB를 업로드한다. 2026-09-28 로컬 산출물은 `outputs/android/mungsil-native-1.2.0-5.aab`이며, 사용자 확인 최고 코드 4보다 높은 5, minSdk 24다. 검사 결과와 해시는 [최신 전환 기록](reviews/2026-09-24-android-web-parity.md)을 따른다. 이전 `1.1.1(4)`는 이전 검증용 파일이다.
3. 설치 후 앱 정보의 버전과 다섯 탭을 확인한다. TWA의 웹 쿠키를 읽지 않으므로 최초 한 번 다시 로그인한다.
4. 테스터 계정으로 서버 연결, 핵심 실천 순환과 사진·대화를 확인한다.

이번 로컬 작업 자체는 Play Console 업로드, 서버 접속·배포, 운영 DB/스토리지 검증을 수행하지 않는다. Play 서명 지문을 추가한 `assetlinks.json`과 공유 약관 원문의 웹 변경은 호스팅 반영이 필요하다. 앱의 일반 화면은 Kotlin/Compose로 실행한다.
