# M-12 · 운영 권한·복구·릴리스 준비

2026-10-24 (Asia/Seoul). 앱/API 소스 `f686a1edabb9e38c7b7c37d7b6aa9d4e5122aa0e`, `codex/beta-core`. 최종 시험 APK/검증 도구 소스는 `858abb29b64b71543bb4aa6279f9f8eb16baf81f`다. 운영 접속·배포·Play 업로드를 수행하지 않았다.

## 격리 환경에서 완료한 검사

새 PostgreSQL17 fixture의 `todosns_m12`에 기존 15개 migration을 적용했다. 별도 `todosns_m12_restore`로 복원했으며 기존 개발·운영 DB/볼륨은 사용하지 않았다. 기존 SQL의 실제 동작을 검증했고 운영 SQL 파일은 변경하지 않았다.

| 검사 | 실제 결과 |
| --- | --- |
| bootstrap-login-roles / roles / apply-runtime-grants | owner NOLOGIN, migrator/runtime/backup LOGIN 분리. 기존 postgres 소유 앱 객체만 owner로 이전 |
| capability 경계 | auth/service/analytics/release/audit 역할의 허용 조회·쓰기와 금지 접근 시험 통과 |
| runtime 실제 SCRAM TCP LOGIN | User 쓰기와 shadow 동기화 허용, DDL·owner 승격·PurposeSubjectMap·migration 조회 거부 |
| backup 실제 SCRAM TCP LOGIN | 읽기 허용, User 변경·owner 승격 거부 |
| migrator 실제 SCRAM TCP LOGIN | SET ROLE owner 후 DDL 가능. 미래 테이블은 runtime 접근 거부·backup 읽기 허용 |
| 정상/잘못된 암호 인증 | Docker IP의 SCRAM 경로에서 세 LOGIN 정상 접속·잘못된 암호 3건 모두 인증 거부 |
| 제한된 runtime 계정의 실제 API | M-10 HTTP/DB 시험 7개 통과·실패0/skip0. 관리자 자격 증명으로 대체하지 않음 |
| backup 계정 pg_dump -Fc | 성공. 생성 계정/합성 자료만 포함, private dump를 checkout 밖에 저장 |
| migrator + SET ROLE owner의 pg_restore | 빈 별도 DB로 성공. 15개 migration·합성 User/identity/service shadow·앱 테이블/sequence 소유권 확인 |
| 복원 뒤 권한 | capability 경계와 runtime TCP 읽기 통과 |

재현 도구: [operations.py](../../../infra/verification/android-v1/operations.py). services.py가 만든 컨테이너의 정확한 ID·소유 label·PG17 이미지를 검사하고, 기존 동명 DB가 있으면 덮어쓰지 않는다. 임시 암호는 stdin/0600 파일로만 전달하고 컨테이너 내부 env/pgpass는 finally에서 삭제한다. raw 로그/dump/결과는 `/workspace/mungsil-setup/final-m12-auth/`(최종 SCRAM 재검증), APK manifest/서명 로그는 `final-m12/`, fixture는 최종 정리 때 제거한다. 24단계 실행 성공을 24개 독립 테스트 또는 전체 운영 보안 감사로 표현하지 않는다.

초기 권한 시험은 initdb loopback trust의 영향을 배제하지 못했다. 최종 도구는 loopback 대신 소유 컨테이너 IP를 사용하고 세 역할의 잘못된 암호가 `password authentication failed`로 거부되는지 확인한 뒤 LOGIN·API·dump/restore를 다시 실행했다. 초기 로그를 보존하고 위 표는 최종 결과를 따른다.

운영 역할 분리 적용, 실제 크기의 백업 시간/RPO/RTO, 외부 보관·보존기간·복원 후 서비스 전환은 미검증이다. 이 fixture 결과만으로 기존 관리자 접근을 제거하거나 운영 SQL을 적용하지 않는다.

## 빌드 산출물과 출시 차단 조건

| 항목 | 현재 결과·다음 확인 |
| --- | --- |
| Debug 앱·시험 APK | M-11 시험 자료 보완 뒤 앱/시험 APK를 함께 재빌드. 제품 소스는 위 SHA와 동일. 아래 SHA-256, 개발용 서명이며 배포 후보 AAB가 아님 |
| 코드 버전 | `kr.kro.mungsil`, 1.2.0(5), min24/target36/compile36. 현재 Play 최고 versionCode는 확인하지 않음 |
| `:app:bundleRelease` | 한 번 실행, 기존 Gradle guard가 `Release signing is not configured.`로 차단. 새 AAB 생성·서명 검증 미실행 |
| 기존 업로드 키 | `apps/android/keystore.properties` 없음. 원래 업로드 keystore와 private 설정 필요. 새 키 생성/guard 우회 없음 |
| Google·FCM | 현재 checkout의 `apps/android/app/google-services.json` 없음. 실제 프로젝트 설정·OAuth 지문·기기/계정이 필요. 합성 provider 성공과 구분 |
| App Links | 실제 HTTPS assetlinks·Play 서명 SHA-256·메일 링크 OS 진입 미검증 |
| 서버 호환 | M-10 API를 앱보다 먼저 배포하고 결과 정리 경로를 확인해야 함. 구버전 404에서 앱은 미확인 키 유지 |
| 배포 | 사용자 승인·대상 환경·원래 키가 갖춰진 후 별도 수행. 지금 배포하지 않음 |

```text
app-debug.apk (24,649,728 bytes)
046895aa501d8993d2830d408e6711ac1f40f4a7ca1a92dadf03929ef6f75c28
app-debug-androidTest.apk (1,374,981 bytes)
267b7ff1be01936fe46b2bfc610a0ee2561711b6d28ea8b0b1c0aa8c3568c7ac
```

기존 [Android 릴리스 안내](../../android-release.md)의 과거 제공 AAB는 이번 소스에서 새로 생성한 파일이 아니다. 산출물 manifest는 로컬 `artifact-manifest.json`에도 보존한다.

## 대상 환경이 갖춰졌을 때의 실행 순서

1. 원래 업로드 키/keystore.properties와 실제 google-services.json을 Git 밖 비밀 설정으로 제공하고 현재 Play 최고 코드를 확인한다. 기존 번호가 사용됐으면 기능 변경과 함께 다음 유효 번호를 정한다.
2. 안정적인 API24/지원 최신 Android·실기기에서 M-11의 미검증 목록과 TalkBack/IME/프로세스 종료·복원을 수행한다. Google 로그인, FCM 권한/수신/계정 분리, 사진 URI·업로드, 두 계정 소켓 재접속도 별도로 검증한다.
3. 대상 서버의 실제 권한·백업·복구 계획을 검토하고 승인된 배포에서 API→앱 순서를 지킨다. DB migration/역호환 범위를 확인하며 구버전 앱도 검사한다.
4. `:app:bundleRelease`와 기존 verify-bundle 스크립트로 패키지·버전·min/target·서명·기존 키 지문을 확인한다. 승인된 내부 트랙에서 설치·핵심 순환을 확인한 뒤 배포 판정한다.

GitHub Actions를 조회/재실행하지 않았고 workflow·결제 설정도 변경하지 않았다.

최종 정리 확인: fixture API/계정·기기 비밀 파일/forwarding·역할 env/정상·오답 pgpass와 소유 컨테이너4개/tmpfs·runtime 설정을 제거했다. 로그·합성 dump·APK manifest는 checkout 밖에 보존했다. 운영 자원은 변경하지 않았다.
