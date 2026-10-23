# Android Google 로그인·푸시 설정

2026-09-23 최종 서버 상태: 운영 `PushDevice` migration과 API 배포, Firebase 프로젝트 `mungsill`의 서버 인증 연결과 `PUSH_ENABLED=true` 활성화를 완료했다. 운영 API 안에서 FCM HTTP v1 `validate_only` 요청이 200으로 통과했다. 실제 휴대폰 수신은 아직 확인하지 않았으며 활성화 직후 등록 기기는 0대다. 현재 운영 Compose override와 롤백 경로는 [서버 배포 기록](reviews/2026-09-23-push-server-deployment.md)을 따른다. 아래 초기 구현 시점의 미실행 설명은 해당 기록으로 갱신된다.

## Google Auth Platform

웹에서 사용 중인 Google Cloud 프로젝트를 그대로 사용한다. Android는 Credential Manager로 Google ID 토큰을 받아 기존 `POST /api/v1/auth/google`에 전달한다. Firebase Authentication으로 계정 저장소를 옮기지 않는다.

| 위치 | 입력값 |
| --- | --- |
| 브랜딩 앱 이름 | 뭉실 |
| 홈페이지 | https://mungsil.kro.kr |
| 개인정보 처리방침 | https://mungsil.kro.kr/privacy |
| 서비스 약관 | https://mungsil.kro.kr/terms |
| 사용자 지원·개발자 연락처 | 실제 운영 이메일 |
| 대상 | 일반 사용자용 외부 앱. 테스트 상태면 로그인할 Google 계정을 테스트 사용자로 등록 |
| 데이터 액세스 | 기본 로그인 `openid`, `email`, `profile` |
| Android OAuth 클라이언트 이름 | 뭉실 Android (Play) |
| Android 패키지 이름 | `kr.kro.mungsil` |
| Android SHA-1 | Play Console → 앱 무결성 → **앱 서명 키 인증서**의 SHA-1 |

Android 클라이언트에는 웹 리디렉션 URI를 입력하지 않는다. 기존 웹 OAuth 클라이언트의 허용 출처와 리디렉션 설정은 지우지 않는다. 앱이 `serverClientId`로 사용하는 값은 **웹 애플리케이션 유형 클라이언트 ID**다. 서버의 `GOOGLE_CLIENT_ID`와 같아야 하며 `GET /api/v1/auth/config`에서 앱에 전달된다. 웹 클라이언트 비밀번호는 Android에 넣지 않는다.

2026-09-23 공개 `auth/config` 읽기 전용 조회 결과: Google 로그인 활성화(`true`), 초대 코드 필수 아님(`false`). 기존 웹 OAuth 클라이언트 ID:

```text
1067160667355-4d5tclmf99lfch8u4solnj3okk51n88v.apps.googleusercontent.com
```

Android OAuth 클라이언트는 이 웹 클라이언트와 같은 Google Cloud 프로젝트에 추가한다. 이 조회는 실제 로그인 성공 검증이나 Google 콘솔 설정 확인을 대신하지 않는다.

현재 로컬 업로드 키 SHA-1: `B7:FB:58:CC:71:05:5C:0A:14:A5:C5:2E:64:DE:9E:A9:74:B4:B5:4D`.

현재 로컬 업로드 키 SHA-256: `BA:8F:A4:C9:BE:87:92:0F:5B:B1:A7:BB:BE:2B:48:8A:A6:B6:05:21:54:21:F7:F5:43:6A:FA:09:39:D2:F2:34`.

이 지문은 직접 업로드 키로 서명한 APK용이며 Play 설치 앱 서명과 동일하다고 가정하지 않는다. Play 서명·업로드 서명·debug 서명이 다르면 각각에 대응하는 Android OAuth 클라이언트가 필요하다. 저장소 `assetlinks.json`의 SHA-256만으로 SHA-1을 유추하지 않는다.

이 PC debug 키를 `keytool`로 확인한 값:

- SHA-1: `03:66:C4:C2:AF:36:58:63:77:7B:A5:DD:60:9C:90:84:9A:A5:86:10`
- SHA-256: `E0:D5:6B:F0:10:CF:16:E9:AF:CF:5F:13:FD:26:5C:B0:E9:E5:E8:B0:FC:E8:5E:63:B4:9A:EA:D7:AC:D9:DA:27`

현재 저장소의 `assetlinks.json` 지문은 이 debug SHA-256과 일치한다. 이것을 Play 앱 서명 인증서로 취급하지 않는다. 네이티브 앱 실행에는 assetlinks가 필요하지 않으며 향후 App Links 설정 때 Play 지문으로 따로 검증한다.

사용자가 Play 앱 서명 화면에서 제공한 **현재 기존 키** 지문:

- SHA-1: `2C:39:5D:8B:83:47:8F:5B:DF:93:CF:72:F4:2D:CE:B5:A0:1C:A8:C7`
- SHA-256: `9D:E8:08:B0:08:8F:11:9E:37:FB:2F:F5:F4:C8:61:E2:F2:58:FD:6C:94:31:EE:E9:24:8E:8A:9A:67:DB:6E:B2`

Play용 Android OAuth 클라이언트에는 위 SHA-1을 등록한다. 실제 Google 콘솔 저장 완료와 Play 설치본 로그인은 별도 확인한다.

## Firebase Cloud Messaging

1. Firebase 프로젝트를 선택한다. 기존 Google Cloud 프로젝트를 연결할 수 있으며 FCM만 별도 프로젝트로 사용해도 된다. Android Google OAuth 클라이언트와 웹 OAuth 클라이언트는 기존 로그인 프로젝트에 함께 둔다.
2. 프로젝트 설정 → 일반 → Android 앱 추가: 패키지 `kr.kro.mungsil`, 닉네임 `뭉실 Android`.
3. Play 앱 서명 SHA-1·SHA-256을 등록한다. 직접 설치 테스트가 필요하면 해당 debug/로컬 서명도 추가한다.
4. Android 설정 파일을 받아 `apps/android/app/google-services.json`에 둔다. Git에는 제외한다. 앱에 포함되는 클라이언트 설정이며 서버 서비스 계정 키와는 다른 파일이다.
5. 프로젝트에서 Firebase Cloud Messaging API (HTTP v1)를 사용 설정한다.
6. 발송 서버의 서비스 계정에 FCM 메시지 생성 권한을 부여한다. Google 환경은 연결된 서비스 계정/ADC를 우선 사용하고, 외부 서버의 키 파일은 저장소 밖의 서버 비밀 파일로 보관한다.

서버 환경 변수:

```dotenv
GOOGLE_AUTH_ENABLED=true
GOOGLE_CLIENT_ID=<기존 웹 OAuth 클라이언트 ID>.apps.googleusercontent.com
PUSH_ENABLED=true
FIREBASE_PROJECT_ID=mungsill
GOOGLE_APPLICATION_CREDENTIALS=/run/secrets/firebase-service-account.json
```

`GOOGLE_APPLICATION_CREDENTIALS`는 서버 내부의 실제 마운트 경로다. 키 내용은 채팅·Git·APK에 넣지 않는다. 연결된 서비스 계정의 ADC를 쓰면 이 변수는 생략한다. 발송 주체는 Firebase 프로젝트 `mungsill`의 FCM 발송 권한을 가져야 한다.

2026-09-23 사용자가 제공한 파일 반영: `apps/android/app/google-services.json`의 패키지는 `kr.kro.mungsil`, Firebase 프로젝트 ID는 `mungsill`, 프로젝트 번호/발신자 ID는 `548748244786`, 앱 ID는 `1:548748244786:android:9394dbd1a1a587391b492b`다. 기존 로그인 프로젝트 번호 `1067160667355`와 다르지만 FCM과 자체 서버 Google 로그인을 분리하므로 웹 OAuth ID를 교체하지 않는다. 설정 파일에 OAuth 클라이언트 목록이 비어 있어도 이 앱의 Google 로그인은 서버 `auth/config`를 사용한다. 실제 Play Android OAuth 등록은 이 파일로 증명되지 않는다.

저장소의 Docker Compose는 환경 변수를 명시해서 전달한다. 기본 `infra/docker-compose.yml`에는 `PUSH_ENABLED`와 `FIREBASE_PROJECT_ID` 전달을 추가했다. 외부 서버의 키 파일 방식은 `infra/docker-compose.push.yml`을 추가 overlay로 사용하며, 호스트의 `FIREBASE_SERVICE_ACCOUNT_FILE` 경로를 `/run/secrets/firebase_service_account`로 읽기 전용 마운트한다. API를 재생성할 때마다 같은 overlay를 유지해야 한다. 기본 배포 스크립트를 그대로 재실행해 overlay를 빠뜨리지 않도록 운영 배포 명령도 함께 반영한다. 이 구성은 파일만 준비했고 실제 컨테이너 실행은 하지 않았다.

## 코드·서버 반영 경계

- Google 로그인은 기존 서버 API를 재사용한다. 해당 설정이 이미 켜져 있다면 로그인만을 위해 서버 코드를 바꿀 필요는 없다.
- **푸시는 신규 `PushDevice` 테이블과 API·발송 worker를 추가하므로 DB migration과 API 서버 배포가 필요하다.** 이 문서 작성 작업에서 운영 migration·배포를 실행하지 않는다.
- 운영 순서: DB 백업/기존 배포 절차 → migration 적용 → API 코드·FCM 서버 설정 반영 → Android에 `google-services.json` 추가 → 새 서명 AAB 생성 → Play 내부 테스트 업데이트.
- 설정 파일 없는 로컬 debug 빌드도 가능하지만 푸시 설정 화면에는 준비 중으로 표시한다. 그 빌드로 실제 FCM 수신이 된다고 주장하지 않는다.
- 알림은 설정 화면의 명시적인 켜기 동작으로 등록하며 Android 13 이상에서 권한을 요청한다. 허용하지 않아도 앱 내부 알림함을 사용할 수 있다.
- 서버는 저장된 알림을 10초 간격으로 조회하고, 세션이 유효한 기기에 ID만 전송한다. 일시 실패는 지수 간격 재시도, 만료된 토큰은 제거한다. 앱은 세션과 알림 소유권·미열람 상태를 다시 확인하고 일반적인 새 소식 알림을 표시한다.
- OS 알림은 새 소식 요약 하나로 합친다. 모든 메시지별 푸시 전달을 보장하는 구조가 아니며 FCM/Android의 절전·네트워크·강제 종료 정책에 따라 지연될 수 있다. 실제 내용과 전체 기록은 알림함에서 확인한다.
- 토큰·메시지 본문을 로그에 남기지 않는다. 알림 수신/탭으로 읽음이나 채팅 읽음 위치를 변경하지 않는다. 알림 탭은 현재 계정이 같을 때 네이티브 알림함을 연다.

## 외부 설정 후 실제 확인

- Play 서명 설치본에서 기존 Google 계정 로그인, 신규 계정 프로필·초대 코드 입력, 취소, 이메일 중복 계정 안내.
- 알림 권한 거부/허용, 앱 전경/배경/프로세스 종료, 알림 탭, 토큰 회전.
- 로그아웃·전체 로그아웃·탈퇴·계정 전환 뒤 이전 계정 알림 미표시, 알림 끄기와 네트워크 복구.
- 실제 서버 DB migration과 두 기기의 응원·댓글·대화 생성부터 FCM 수신까지 확인.

참고: [Credential Manager 구현](https://developer.android.com/identity/sign-in/credential-manager-siwg-implementation), [Android 서명과 OAuth](https://developers.google.com/android/guides/client-auth), [FCM Android](https://firebase.google.com/docs/cloud-messaging/android/get-started), [FCM 서버 인증](https://firebase.google.com/docs/cloud-messaging/send/v1-api).
