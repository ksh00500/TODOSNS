# Play 자동 보호 업로드 오류 수정

- 사용자가 제공한 Play Console 화면에서 자동 보호가 최소 SDK 24 이상을 요구하고 기존 code 3 번들의 minSdk 23을 거부함을 확인했다.
- 앱 모듈의 minSdk를 24로 올리고 versionCode를 4로 변경했다. versionName은 1.1.1, 패키지는 kr.kro.mungsil, targetSdk는 36을 유지했다. Android 6.x는 새 버전 설치 대상에서 제외된다.
- `:app:testDebugUnitTest :app:lintDebug :app:bundleRelease` 통과. 단위 테스트 10/10, lint 오류 0·경고 25건. 로그: `apps/android/native-minsdk24-build.log`.
- 완성된 AAB의 protobuf manifest를 읽어 minSdkVersion 24, versionCode 4, versionName 1.1.1, 패키지와 targetSdk를 확인했다. 로컬 점검 스크립트의 최초 protobuf 필드 매핑 오류를 수정한 뒤 실제 번들 검증을 통과했다.
- jarsigner 검증 통과. 기존 자체 서명 인증서 경로·타임스탬프 경고는 유지된다. Firebase 앱 ID 리소스가 유지되고 서버 서비스 계정/서명 키 파일이 번들에 없는지 확인했다.
- 결과: `outputs/android/mungsil-native-1.1.1-4.aab`, 14,655,228 bytes.
- SHA-256: `06222CCFC8F98CCABE07D4A90752B757F7AC1453B21A717051D7EC8DD8976A50`.
- 이전 AAB는 보존했다. 이번 작업에서 Play 업로드, 실기기/계정 로그인·푸시 수신, instrumentation 재실행, 서버 변경은 하지 않았다.
