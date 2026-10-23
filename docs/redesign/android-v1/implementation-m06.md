# M-06 · Android 연결 UI와 실제 합성 서비스 검증

2026-10-23 UTC · 현재 Codex 인스턴스의 실행 증거

대상: `codex/beta-core@ae63ef558d1c797aea72dc6e56e24c58717b3172`와 이번 Android HTTP 연결 복구·시험·검증 도구·문서 변경. API 계약·schema/migration·의존성/lockfile·workflow와 운영 환경은 변경하지 않았다. [재현 안내·도구](../../../infra/verification/android-v1/README.md).

첫20개를 읽은 뒤 긴 목록을 스크롤하고 추가 조회하면, 서버가 닫은 idle 연결을 재사용해 연결 오류가 발생했다. 안전한 GET만 연결을 복구하고 쓰기는 결과를 모른 채 자동 재전송하지 않도록 transport를 분리했다. 실제 합성 API의55개 조회와 계정·취소/삭제 경계로 확인한다.

## 1. 실제 실행 결과

| 검사 | 결과·범위 |
| --- | --- |
| API 전체 | root `npm test`: **138 통과 / 0 실패 / 0 skip**. 이전 조건부 DB E2E3·기록 DB1·저장소1도 이번에는 실제 실행 |
| Web 전체 | 같은 명령의 Web: **53 통과 / 0 실패 / 0 skip** |
| root lint/build | `npm run lint`, `npm run build` 통과. contracts → API → Web build |
| Android unit | **17 suites / 121 통과 / 0 failures / 0 errors / 0 skip**. 연결 복구·쓰기 비재전송/새 연결·서버 재시도 지시 회귀4개 추가 |
| Android 빌드/lint | 앱·테스트 Debug APK 조립 통과. lint **0 errors / 33 warnings** |
| 완료 기록 Compose | 실제 AOSP API29 기기 연결 instrumentation **3 통과 / 0 실패**. 기간 복원·추가 실패/재시도·마이→기록→서버 시간대 일정 이동 |
| 실제 API→Android | **1 통과 / 0 실패**. 실제 로그인·20→40→55개, 취소/삭제 후53개, B계정1개, 타 계정 cursor400·로그아웃 세션401 |
| 핵심 Compose 회귀 | **6 통과 / 0 실패**. 작성·정밀 일정/관계·저장 상태·완료/취소·조회 실패·자정/계정 경계 |
| 화면 폭·글자 | 로그인·5탭: **360/390/430dp 글자100%, 360dp 글자200%의 4회 실행 통과**. 기록 목록·상세·일정 글자200% **1회 추가 통과**. 모두 동작/semantic 검사 범위 |
| 최종 연결 합계 | **15회 통과 / 0 실패**, 서로 다른 시험 메서드11개. 폭·글자 조건을 바꾼 반복 실행을 포함하며 위 항목과 중복 합산하지 않음 |
| 문서·변경 | 상대 링크·`git diff --check` 검사 |

연결 실행은 ADB `am instrument -w -r`로 AndroidJUnitRunner를 직접 호출했다. Gradle `connectedDebugAndroidTest` 작업을 실행했다는 의미가 아니다. 예상 실행 수·각 status0·JUnit `OK (N tests)`·최종 instrumentation code를 함께 확인했다. 셸 exit0만으로 성공을 판정하지 않았다.

Android 컴파일은 SDK36·JDK21·wrapper8.14.3, worker2로 수행했다. **실제 연결 실행 OS는 API29**이며 compile/target SDK36과 구분한다. `/dev/kvm`은 없고 CPU 소프트웨어 emulation을 사용했다. 원본 로그·APK·임시 설정은 checkout 밖 `/workspace/mungsil-setup/android-m06/`에 두고 Git에는 코드·재현 도구·검토 문서를 올린다. 최종 캡처에서 System UI ANR 경고창을 발견해 해당 이미지는 시각 검증 증거에서 제외했다. Compose/semantic 검사는 시스템 경고창 뒤에서도 통과할 수 있으므로 15회 통과를 실제 터치·시각 검수 완료로 해석하지 않는다.

## 2. 실제 DB·Redis·MinIO와 AppModule

| 영역 | 확인한 사실 |
| --- | --- |
| 격리 | 이번에 만든 PostgreSQL17-alpine·Redis7-alpine·MinIO2025-09-07만 사용. loopback 임시 포트, PostgreSQL/MinIO tmpfs, 새 버킷과 합성 계정. 기존 DB·볼륨·운영 사용자 사용 없음 |
| schema | `todosns_m06` 및 기록 시험 전용 `todosns_m04`에 기존 migration15개 적용. 새 schema/migration 추가 없음 |
| 핵심 순환 | 실제 AppModule/JWT/DB에서 두 사용자의 생성→완료→게시→응원·댓글→가져오기→재완료, 멱등 재전송·동시 완료·상한·세션 회전과 개인정보 경계 확인 |
| 관계·대화 | 실제 HTTP/DB로 차단·해제, 알림 읽음 경계·그룹 후보 검색, 메시지 요청/수락·전송·읽음·차단 후 변경 거부와 기존 기록 보존 |
| 기록 | 실제 PostgreSQL/HTTP의 동일 완료시각55개·경계 포함 총57개 cursor 조회, 중복0·total, 예정일과 완료일 분리, 삭제/취소·다른 계정/시간대·위변조·만료/철회·snapshot 경합 확인 |
| 객체 저장소 | 실제 versioning이 켜진 MinIO에서 원본/thumbnail의 모든 버전·delete marker 파기, 비슷한 prefix의 이웃 객체 보존 |
| 의존 서비스 준비 | 별도 fixture host의 **전체 AppModule `/ready`가 database/redis/storage 모두 true**인지 확인. 열린 포트나 PID만으로 준비 완료를 판단하지 않음 |

API138에는 위 실제 조건부 시험5개가 포함된다. 준비 단계의 대표 시험과 합산해 건수를 부풀리지 않는다. DB 접속은 임시 superuser로 실행했으므로 운영 역할 분리·최소 권한 검증의 완료로 확대하지 않는다. S3 객체 파기와 `/ready` 통과는 Android 사진 업로드·처리·소켓/푸시 전달의 전체 통합 성공을 뜻하지 않는다.

## 3. Android 연결 범위

| 묶음 | 내용·판정 |
| --- | --- |
| `HistoryFlowTest` 3개 | 첫20개/전체21개 분리, 추가 조회503 후 같은 기간/cursor 재시도·상세/일정 이동. 날짜 선택 후 Compose 저장 상태 복원. 실제 NavHost의5탭·서버 New York 시간대 예정일 경계 |
| `HistoryRealApiTest` | 명시 opt-in·기기 private fixture 파일·localhost reverse만 허용. Repository의20/20/15개 고유55개와 UI20→40→55개, 실제 취소/삭제53개·이전 상세 제거, B1개·이전 계정 숨김, 다른 계정 cursor400/이전 session401을 확인 |
| `NativeFlowTest` 핵심6개 | 최초 실패/확인된 빈 목록·갱신 실패, 계정 컨텍스트 전환, 자정 변경 중 초안 유지, 완료 실패 원복/요청 키, 정밀 예정일/복잡 반복/관계·제출 복원, 작성 실패→결과 확인→완료→게시 |
| 폭/글자4회 | 실제 기기 `wm size`/density320·font_scale로 로그인·5탭을 실행. 360/390/430dp의100%, 360dp의200%. semantic 동작 실행 결과이며 시스템 경고창이 가린 캡처는 시각 검수 증거에서 제외 |

`Api.kt`는 GET 읽기 전용 client에서 끊긴 연결을 복구하고, 쓰기/인증/업로드는 별도 transport에서 유휴 연결 재사용을 피한다. 쓰기 본문을 one-shot으로 표시해 서버의503/`Retry-After: 0` 지시로도 결과 미확인 요청이 자동 반복되지 않게 했다. 명시적401 뒤 세션 갱신/같은 키 재전송, timeout·redirect/TLS·세션 세대 검사·멱등 키 계약은 유지한다. 쓰기는 유휴 연결 재사용의 성능 이점보다 불명확한 자동 전송을 피하는 쪽을 선택했다. 연결이 끊기는 회귀를 먼저 실행해 수정 전 GET 실패를 재현했고, 수정 후 전체 unit121과 명시 결과 확인만 같은 본문/키로 다시 전송하는 동작을 확인했다.

`StateRestorationTester`는 Compose 저장 상태 복원이다. 실제 OS 프로세스 종료·회전/복귀를 모두 확인했다는 의미가 아니다. 실제 두 계정 연결 시험도 한 합성 기기에서 REST 로그인·세션과 Compose 계정 소유자를 바꾸는 범위이며, 실계정·두 실물 단말의 운영 로그인 성공을 뜻하지 않는다.

기록 본문·토큰·cursor는 화면 `SavedState`에 보관하지 않는다. 시험용 합성 로그인 자료만 기기 private fixture 파일로 전달하며 종료 때 삭제한다. 서버 재시작마다 새 합성 계정/자료를 사용하고 완료 취소·삭제도 이 자료에만 수행했다. 최종 실제 API 검사 뒤 호스트를 종료하고 합성 계정0개·fixture/PID 파일 제거를 확인했으며, 이번에 만든 DB/Redis/MinIO와 생성한 접속 설정도 정리했다. 최종 화면 확인에 재사용한 Android 컨테이너도 종료했다.

## 4. 재현 도구와 실패 원인 구분

| 발견 | 구분·조치 |
| --- | --- |
| 호스트 ADB의 `/home/agent/.android` EROFS | 환경 설정 경로 문제. 호스트 홈을 변경하지 않고 writable 기본 홈을 가진 격리 Debian 컨테이너에서 ADB/에뮬레이터 실행. SDK/checkout은 read-only mount |
| Buildx의 읽기 전용 홈 | `BUILDX_CONFIG`만 작업 디렉터리로 변경. 기존 Docker 인증 설정과 proxy/CA를 유지 |
| MinIO Quay 접근 거부·공식 archive410 | 앱/테스트 결함과 구분. 동일 공식 release의 Go source를 checksum/TLS 검증과 함께 빌드. 런타임 CA를 image에 복사하지 않음 |
| AOSP API35 초기 종료 | 저속 부팅/초기화 ANR 및 **System UI 응답 없음**을 관찰. AOT 후 일부 시험은 진행했지만 이 환경의 API35 통과로 처리하지 않음. 최종 API29 실행과 분리 |
| 장시간 API29 실행 중 단절 | 컨테이너6GiB의 `oom_kill=1`·`OOMKilled=true`와 qemu 종료를 확인. 호스트 여유 자원 안에서10GiB로 늘려 재시작하고 미완료 검사를 재실행. 단절된 실행을 통과로 처리하지 않음 |
| 최종 API29 캡처의 System UI ANR | 동작 검사는 통과했지만 일부 최종 이미지에 OS 경고창이 포함됨. 이미지를 게시하지 않고 실제 터치/시각 검수와 결과를 구분. 콜드 재시작 후에도 dumpsys에서 `Application Not Responding: com.android.systemui` 재확인. 추가 시각 검사 실행은 환경 복구 실패로 중단했으며 최종15회 합계에 포함하지 않음 |
| 실제 긴 목록의 추가 조회 오류 | 모델의 버튼 처리 뒤 IOException, 서버에는 다음 GET 미도착. 빠른 Repository 직접20/20/15 호출은 성공. 끊긴 pooled read 연결의 EOF 회귀를 재현해 GET 복구와 쓰기 보호를 수정 |
| 상세의 예정일 문구2개 | 목록과 dialog에 같은 문구가 존재하는 시험 선택자 오류. dialog 범위로 한정해 날짜 의미에 대한 assertion 유지 |
| 비동기/화면 밖 항목 검색 | 실제 HTTP 완료 전 count 검색과 미합성 LazyColumn의 새로고침 검색을 보완. 응답 뒤 갱신 수치를 기다리고 목록을 먼저 스크롤. assertion 삭제/우회 없음 |

`services.py`는 고유 이름·소유 label/ID로 임시 자원만 만들고 정리한다. config/암호는 checkout 밖0600 파일에만 생성하며 값을 출력하지 않는다. 재현 검사는 새 서비스를 시작→같은 시작 명령 재호출→실제 기록 DB/S3 대표2개 통과→종료까지 확인했다. `Dockerfile.android` 의존성 이미지와 실제 emulator/ADB 실행도 확인했다. Dockerfile에는 공식 base digest·MinIO release를 고정했다.

fixture host는 일반 서버에 테스트 endpoint를 추가하지 않고, local Docker bridge19106에서만 전체 AppModule을 실행한다. 최종 연결 회귀에서는 idle timeout을50ms로 줄여 UI 조작 사이의 연결 종료를 강제한다. Authorization·본문·query/cursor를 로그에 남기지 않는다. 종료 시 자신이 만든 계정과 fixture/PID 파일만 제거한다. 중복 호스트 실행을 거부하며 기존 private fixture와 PID 파일이 그대로 유지되는 것도 확인했다.

## 5. 남은 범위와 인수인계

| 남은 항목 | 현재 상태 |
| --- | --- |
| API35·최신 Android·API24·실기기 | API35 소프트웨어 환경은 미통과, API24/실기기 미검증. 가속 가능한 환경/기기에서 별도 실행 필요 |
| 전체 화면 접근성 | 시스템 경고창 없는 최종 전체 화면 시각 검수는 미완료. 로그인/5탭 폭·글자 semantic 실행과 구분. 전체 화면의200%·IME·TalkBack·포커스/뒤로 가기·최장 콘텐츠 전체 검수는 미완료 |
| OS 수명주기 | 실제 회전·프로세스 종료/재시작·실제 자정/백그라운드 복귀 전체 흐름 미검증 |
| 외부 서비스 | 실제 Google 로그인·FCM 기기 전달·사진 presign/upload/process·실제 소켓 단절/재접속 전체 흐름 미검증 |
| 운영/출시 | 운영 DB 역할 경계·규모 성능·백업/복구·release 서명·Play/운영 배포 미실행 |

GitHub Actions 조회·재실행·결제 제안·CI 유도 커밋과 workflow 수정은 하지 않았다. 이번 자료는 현재 소스의 격리 검증 근거다. 전체 제품 검수·실기기·출시 또는 전체 프로젝트의 최종 인수인계 완료 판정으로 사용하지 않는다.
