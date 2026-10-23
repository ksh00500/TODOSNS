# 개발 준비 현황 · Android 우선

기준일: 2026-10-23 (Asia/Seoul). 검사 대상: `codex/beta-core@6ab768782d52458c39c9c9a7716dd6bb42b876aa`와 로컬 정책/설계 문서 추가. 앱 코드·manifest·lockfile·workflow 변경은 없다.

이 문서는 최초 개발 준비의 기준선 이력이다. 이후 코드 변경과 검사 결과는 [Android M-01 구현·검증 보고서](android-v1/implementation-m01.md)를 따른다.

## 1. 최초 준비 시 Codex 실행 결과

| 항목 | 현재 결과 | 근거·범위 |
| --- | --- | --- |
| 의존성 설치 | 통과 | `npm ci --cache /workspace/mungsil-setup/npm-cache --strict-ssl=true`, 잠금 파일 유지, 977 packages |
| 공용 계약 빌드 | 통과 | `npm run build -w @mungsil/contracts` |
| API 빌드·테스트 | 125 통과 / 4 skip / 0 실패 | `npm test`의 API 단계: Prisma 6.12 생성·Nest 빌드 포함, 전체 129건 |
| 웹 기존 테스트 | 53 통과 / 0 skip / 0 실패 | 같은 `npm test`의 Web 단계 |
| root lint | 통과 | `npm run lint`: Web와 API 모두 실행 |
| Web production build | 통과 | `npm run build -w @mungsil/web` |
| Android Debug 조립 | 통과 | `:app:assembleDebug`, APK 23,748,776 bytes 생성 |
| Android 단위 시험 | 54 통과 / 0 실패 / 0 skip | `:app:testDebugUnitTest`, 현재 실행 XML 11 suites 집계 |
| Android lint | 0 errors / 33 warnings | `:app:lintDebug`, 현재 lint XML 확인 |
| 실제 DB/스토리지 | 이번 준비에서 미검증 | DB E2E 3건과 스토리지 1건은 기존 조건에 따라 skip. 통과로 집계하지 않음 |
| 브라우저·연결 UI | 이번 준비에서 미검증 | Node 테스트·정적 생성은 실제 화면/소켓 검증이 아님 |
| release 서명·실계정·FCM | 미검증 | release 키·기기·실계정 검증과 별도 범위 |
| GitHub Actions | 조사·재실행하지 않음 | 알려진 결제 제한 관련 사용자 운영 정책 준수 |

이 결과는 기존 소스의 기준선이다. 아직 구현하지 않은 재설계 기능의 완료 판정이 아니다.

## 2. 준비한 도구

| 도구 | 확인 내용 |
| --- | --- |
| Node / npm | 24.19.0 / 11.9.0 |
| Java | Temurin JDK 21.0.13+9. 기존 시스템 Java 21은 javac가 없어 공식 JDK archive의 SHA-256 확인 후 추가 설치 |
| Android SDK | `/workspace/tooling/todosns/android-sdk` |
| SDK Platform / Build Tools | Android 36 rev 2 / 36.0.0 및 AGP가 요구한 35.0.0 |
| Platform Tools | 37.0.1 |
| Command-line Tools | 19.0. 공식 HTTPS 저장소 metadata의 파일 크기·SHA-1 검증 후 설치 |
| Gradle | 저장소 wrapper 8.14.3, 캐시는 `/workspace/tooling/todosns/gradle` |
| Java CA | 시스템 truststore 사본에 현재 세션의 공개 proxy CA 추가. TLS 검증 유지 |
| 환경 초기화 | `/workspace/tooling/todosns/android-env.sh`; checkout 밖의 로컬 개발 도구 |
| Emulator·ADB | AVD·시스템 이미지·실행 기기 미준비, `/dev/kvm` 없음. `adb devices`는 읽기 전용 `/home/agent/.android` 생성 시도로 중단되어 기기 목록도 미확인. 연결 시험은 미검증 |

최신 command-line tools의 sdkmanager는 새 Android CLI로 위임하면서 읽기 전용 홈에 bin 디렉터리 생성을 시도해 실패했다. 공식 저장소의 19.0 sdkmanager를 사용해 SDK 36 설치를 완료했다. 패키지 검증·TLS는 해제하지 않았다.

JDK 추가 후 Android preference 경로 주입의 중복 설정도 진단해 `ANDROID_USER_HOME` 한 가지로 정리했다. 이는 로컬 도구 설정 수정이며 앱 코드 수정이 아니다. SDK·JDK·Gradle 의존성을 준비한 뒤 Debug/unit/lint를 재실행해 전체 exit 0을 확인했다. 최초 JRE·preference 경로 실패는 이 준비 과정에서 해결한 환경 문제이며 앱 코드 결함으로 집계하지 않는다. Android metrics의 읽기 전용 홈 경고·일부 native library strip 불가 경고·Gradle deprecation과 lint 경고는 남아 있으나 이번 세 작업은 통과했다.

## 3. 다시 실행하는 방법

현재 인스턴스에서 설치 도구·캐시는 보존되지만 실행 프로세스는 보장되지 않는다. 새 환경에서는 먼저 위 도구와 경로 존재를 확인한다.

```bash
cd /workspace/TODOSNS
export npm_config_cache=/workspace/mungsil-setup/npm-cache
npm ci --strict-ssl=true
npm run build -w @mungsil/contracts
npm test
npm run lint
npm run build -w @mungsil/web

. /workspace/tooling/todosns/android-env.sh
cd /workspace/TODOSNS/apps/android
bash gradlew :app:assembleDebug :app:testDebugUnitTest :app:lintDebug \
  --no-daemon --max-workers=2 --console=plain
```

Gradle 작업은 최대 worker 2개, 저장소의 JVM 메모리 설정으로 실행한다. Linux에서는 실행 권한 변경 대신 `bash gradlew`를 사용한다. 환경 스크립트는 SDK·Gradle의 쓰기 가능한 경로, Java CA truststore 및 세션 proxy를 초기화한다. 다른 세션에서 proxy/CA가 변경되면 현재 환경의 `HTTPS_PROXY`, `CODEX_PROXY_CERT`와 시스템 CA에 맞춰 로컬 설정을 다시 생성한다. 인증값을 코드·문서에 저장하지 않는다.

## 4. 실행 증거 위치

| 증거 | 현재 인스턴스 위치 |
| --- | --- |
| npm 설치 | `/workspace/mungsil-setup/redesign-baseline/install.log` |
| API/Web 테스트 | `/workspace/mungsil-setup/redesign-baseline/test.log` |
| Web/API lint | `/workspace/mungsil-setup/redesign-baseline/lint.log` |
| Web build | `/workspace/mungsil-setup/redesign-baseline/web-build.log` |
| SDK 설치 | `/workspace/mungsil-setup/redesign-baseline/android-sdk-install19.log` |
| Android 검사 | `/workspace/mungsil-setup/redesign-baseline/android-build-final.log` |

원본 로그·의존성·빌드 결과·SDK·인증 파일은 Git에 올리지 않는다. 공유 문서에는 검증한 요약만 남긴다.

## 5. 다음 검증

1. A-01~04 설계 결과에 따라 Android 첫 기능의 단위·화면·권한 시나리오를 확정한다.
2. ADB가 사용하는 설정 경로의 쓰기 문제를 먼저 해결하고 Android 연결 UI 시험용 에뮬레이터 또는 기기를 준비한다. 합성 API/fixture로 상태·접근성·초안 복원을 검사한다.
3. 별도 합성 DB·Redis·스토리지를 구성하고 DB/스토리지 조건부 시험을 실제 실행한다. 기존 로컬 볼륨·운영 DB를 초기화하지 않는다.
4. 두 계정 핵심 순환, 차단·권한 변경, 실패·재시도·소켓 단절을 실제 서비스로 확인한다.
5. 실제 Google 로그인·FCM 전달·서명/배포는 필요한 환경과 승인 범위에서 별도로 확인한다.
