# 뭉실 Android 배포

뭉실 Android 앱은 `https://mungsil.kro.kr` PWA를 전체 화면으로 실행하는 Trusted Web Activity(TWA)다. 패키지명은 `kr.kro.mungsil`, 최소 Android 버전은 API 23, 현재 target/compile SDK는 API 36이다.

## 1. 디버그 APK

JDK 17 이상과 Android SDK 36을 설치하고 `ANDROID_HOME`을 지정한 다음 저장소 루트에서 실행한다.

```powershell
$env:ANDROID_HOME = "$env:LOCALAPPDATA\Android\Sdk"
$env:ANDROID_SDK_ROOT = $env:ANDROID_HOME
npm run android:debug
```

APK는 `apps/android/app/build/outputs/apk/debug/app-debug.apk`에 생성된다. 연결된 기기나 에뮬레이터에는 아래처럼 설치한다.

```powershell
& "$env:ANDROID_HOME\platform-tools\adb.exe" install -r apps/android/app/build/outputs/apk/debug/app-debug.apk
```

## 2. TWA 도메인 검증

브라우저 주소 표시줄 없이 전체 화면으로 열리려면 `https://mungsil.kro.kr/.well-known/assetlinks.json`에 설치된 APK 서명 인증서의 SHA-256 지문이 있어야 한다.

```powershell
$env:ANDROID_HOME = "$env:LOCALAPPDATA\Android\Sdk"
$env:ANDROID_SDK_ROOT = $env:ANDROID_HOME
npm run android:signing-report
```

디버그 지문은 개발 기기 검증에만 사용한다. Play Console에서 앱을 만들고 Play App Signing을 활성화한 뒤 `설정 > 앱 무결성 > 앱 서명 키 인증서`의 SHA-256 지문을 운영 `assetlinks.json`에 추가해야 한다. 업로드 키 지문과 앱 서명 키 지문은 서로 다를 수 있다.

현재 `apps/web/public/.well-known/assetlinks.json`에는 이 저장소를 빌드한 개발 PC의 디버그 인증서 지문이 들어 있다. 다른 PC의 디버그 APK도 검증하려면 그 PC의 디버그 지문을 배열에 추가한다. Play 내부 테스트를 시작하기 전에는 Play 앱 서명 키 지문을 같은 배열에 반드시 추가한다.

## 3. 업로드 키와 AAB

업로드 키는 저장소 밖의 안전한 위치에 만들고 비밀번호 관리자에 보관한다. `.jks`, `.keystore`, `keystore.properties`는 Git에서 제외된다.

```powershell
keytool -genkeypair -v -keystore C:\secure\mungsil-upload.jks -alias mungsil-upload -keyalg RSA -keysize 2048 -validity 10000
Copy-Item apps/android/keystore.properties.example apps/android/keystore.properties
```

`keystore.properties`의 경로와 비밀번호를 채운 뒤 AAB를 만든다.

```powershell
$env:ANDROID_HOME = "$env:LOCALAPPDATA\Android\Sdk"
$env:ANDROID_SDK_ROOT = $env:ANDROID_HOME
npm run android:bundle
```

결과물은 `apps/android/app/build/outputs/bundle/release/app-release.aab`이다. Play Console 내부 테스트 트랙에 먼저 올리고 로그인, 사진 선택·촬영, 업로드, 알림 권한, 딥링크, 오프라인 복구를 실제 기기에서 확인한다.
