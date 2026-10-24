# Android V1 · M-06 격리 통합 검증

운영 `.env`·실계정·기존 DB/볼륨을 사용하지 않는다. 임시 PostgreSQL/Redis/MinIO, 전체 AppModule, Android의 실제 Api/HistoryRepository/Compose를 연결하는 검사다. 결과와 미검증 범위는 [M-06 보고서](../../../docs/redesign/android-v1/implementation-m06.md)를 따른다. GitHub Actions를 조회하거나 실행하지 않는다.

## 서비스 준비와 회귀

저장소의 npm 의존성·Prisma client·API build와 로컬 Docker가 먼저 필요하다. 기존 [개발 준비 안내](../../../docs/redesign/development-readiness.md)를 사용한다. 아래는 저장소 루트에서 실행한다.

```bash
python infra/verification/android-v1/services.py start /workspace/mungsil-setup/m06
python infra/verification/android-v1/services.py test /workspace/mungsil-setup/m06
```

`start`는 고유 이름·소유 label의 컨테이너만 새로 만들고, loopback의 임시 포트·tmpfs PostgreSQL/MinIO·비영속 Redis를 사용한다. `todosns_m06`와 기록 DB 시험 전용 `todosns_m04`에 기존 migration을 적용하고 versioning이 켜진 새 버킷을 준비한다. 재호출은 소유 컨테이너를 확인한 뒤 재사용한다. 이미 존재하는 출처 불명 설정 파일은 덮어쓰지 않는다.

합성용으로 생성한 암호·JWT 키·접속 설정은 checkout 밖 `synthetic-runtime.json`(0600)에만 둔다. 값을 출력하거나 커밋하지 않는다. `test`는 이 설정을 해당 자식 프로세스에만 전달해 root lint/test/build를 실행하고 원래 exit status를 보존한다. DB E2E·기록 DB·객체 저장소 조건부 시험도 활성화한다. 외부 메일·Google 인증·푸시는 꺼둔다.

MinIO 이미지는 기존에 준비한 `todosns-m06-minio:2025-09-07`을 재사용하거나 공식 같은 release의 Go 모듈에서 빌드한다. Go module checksum과 TLS 검증을 유지하고, 빌드에만 세션 CA를 mount한다. Docker 인증 설정은 변경하지 않으며 Buildx 캐시 경로만 작업 디렉터리로 지정한다. Quay의 해당 이미지 접근 거부와 공식 바이너리 archive의 410 응답 때문에 이 소스 빌드를 사용했다.

## Android 실행 환경

이번 컴파일 도구는 SDK36/JDK21/wrapper8.14.3이다. 최종 연결 실행은 Emulator37.2.12와 **AOSP API29 x86_64 rev8**을 사용한다. 먼저 시도한 API35 rev2에서는 소프트웨어 실행의 System UI ANR을 관찰했으며 통과로 처리하지 않았다. Android 도구는 공식 SDK manager의 HTTPS 저장소 metadata/체크섬으로 설치한다. 새 버전에서 같은 결과를 보장하는 의미는 아니다.

```bash
. /workspace/tooling/todosns/android-env.sh
sdkmanager --sdk_root="$ANDROID_HOME" --channel=0 'emulator' 'system-images;android-29;default;x86_64'
cd apps/android
bash gradlew :app:assembleDebug :app:assembleDebugAndroidTest --no-daemon --max-workers=2 --console=plain
```

호스트 ADB는 `ANDROID_USER_HOME` 등과 무관하게 읽기 전용 `/home/agent/.android`를 만들려 한다. 호스트 홈이나 앱 설정을 바꾸지 않고, 쓰기 가능한 기본 홈을 가진 Debian 컨테이너에서 ADB와 에뮬레이터를 실행한다. SDK와 checkout은 read-only mount하고 AVD/로그 디렉터리만 쓰기 허용한다. `/dev/kvm`이 없어 `-accel off`를 사용한다. 부팅 완료 전의 ADB `device` 표시는 앱 실행 준비 완료가 아니다.

컨테이너 의존성은 `Dockerfile.android`에 있다. 기존 런타임을 유지 중이면 다시 만들지 않는다. 새 런타임에서는 다음처럼 이미지와 AVD를 준비한다.

```bash
BUILDX_CONFIG=/workspace/mungsil-setup/m06/buildx docker --host=unix:///var/run/docker.sock build \
  --secret id=proxy_ca,src="$CODEX_PROXY_CERT" -f infra/verification/android-v1/Dockerfile.android \
  -t todosns-m06-android-runtime:bookworm infra/verification/android-v1
ANDROID_AVD_HOME=/workspace/mungsil-setup/m06/avds avdmanager create avd \
  --name todosns-m06-api29 --package 'system-images;android-29;default;x86_64' \
  --path /workspace/mungsil-setup/m06/avd29 --device pixel_2
```

`todosns-m06-android` 컨테이너를 위 이미지에서 새로 시작할 때 SDK/checkout/작업 디렉터리를 **같은 절대 경로**에 mount한다. 기존 동명 컨테이너가 있으면 소유자를 확인하고 재사용하며 임의로 지우지 않는다. 다음은 새 런타임용 예다. IPv6 loopback을 켜 emulator modem의 `::1` 접속을 지원하며 외부 네트워크 우회에 사용하지 않는다.

```bash
docker --host=unix:///var/run/docker.sock run --rm --name todosns-m06-android \
  --label todosns.verification=m06 --sysctl net.ipv6.conf.all.disable_ipv6=0 --cpus=3 --memory=10g -d \
  --mount type=bind,src=/workspace/tooling/todosns,dst=/workspace/tooling/todosns,readonly \
  --mount type=bind,src=/workspace/TODOSNS,dst=/workspace/TODOSNS,readonly \
  --mount type=bind,src=/workspace/mungsil-setup/m06,dst=/workspace/mungsil-setup/m06 \
  --mount type=bind,src=/etc/ssl/certs/ca-certificates.crt,dst=/etc/ssl/certs/ca-certificates.crt,readonly \
  -p 127.0.0.1:5037:5037 todosns-m06-android-runtime:bookworm
```

컨테이너 안에서는 아래 프로세스를 시작하고 로그를 작업 디렉터리에 남긴다. `<작업 경로>`는 실제 `/workspace/mungsil-setup/m06` 등으로 바꾼다. `docker exec -d`를 쓰면 프로세스를 유지할 수 있다.

```text
adb -a -P 5037 server nodaemon
ANDROID_AVD_HOME=<작업 경로>/avds ANDROID_EMULATOR_HOME=<작업 경로>/emulator \
  emulator -avd todosns-m06-api29 -no-window -no-audio -no-boot-anim -no-snapshot \
  -accel off -gpu swiftshader -feature -Vulkan -cores 2 -memory 2048
```

각 명령의 PATH에는 SDK platform-tools/emulator가 필요하다. `adb -s emulator-5554 shell getprop sys.boot_completed`가 `1`이 된 뒤 앱 APK와 테스트 APK를 **같은 소스로 함께** 설치한다. 애니메이션을 끄고 작은 화면 크기를 사용한다. 저속 소프트웨어 실행에서 첫 초기화가 시간 제한에 걸리면 로그로 원인을 확인하고, 패키지 AOT compile 후 다시 검사한다. assertion이나 실패 분기를 제거하지 않는다.

이번 호스트는33GiB였다. 초기6GiB 컨테이너에서는 장시간 폰트/화면 실행 후 OOM으로 qemu가 종료돼10GiB로 늘렸다. 시작 전 실제 호스트 여유 메모리를 확인한다. 같은 자원이 없는 환경에서 이 한도를 그대로 요구하거나 연결 미실행을 통과로 표시하지 않는다.

새 AVD는 논리 크기6GiB userdata를 만들기 위해 별도의 여유 디스크도 검사한다. 시작 전 `df -h /workspace`와 emulator 로그를 확인하고, `FATAL / Not enough space to create userdata partition`이면 ADB 부팅을 계속 기다리지 않는다. UI-02에서는 available7172.37MB/need7372.80MB로 시작하지 못했고 종료한 소유 검증 AVD의 재생성 가능한 데이터/설치 zip 캐시만 정리한 뒤 복구했다. 운영 자료·다른 작업의 파일·설치된 SDK·검증 로그/캡처를 지우지 않는다. boot 완료/메모리 자동 조정과 최초 실패/복구 후 실행을 구분한다.

```text
adb -s emulator-5554 shell cmd package compile -m speed -f kr.kro.mungsil
adb -s emulator-5554 shell cmd package compile -m speed -f kr.kro.mungsil.test
adb -s emulator-5554 shell am instrument -w -r --no-window-animation -e disableAnalytics true \
  -e class kr.kro.mungsil.HistoryFlowTest kr.kro.mungsil.test/androidx.test.runner.AndroidJUnitRunner
```

ADB는 컨테이너 안에서 실행한다. 셸 exit0만으로 성공을 판단하지 않는다. `Process crashed`, instrumentation code0, 실패 stack, `FAILURES`를 거부하고 예상 테스트 수와 JUnit의 `OK`/instrumentation 최종 결과를 함께 확인한다. 캡처도 직접 열어 OS 미응답 경고창이 가리지 않는지 확인한다. Compose/semantic 성공은 실제 터치·시각 검수 성공을 보장하지 않는다.

## 실제 API와 기록 화면 연결

```bash
M06_RUNTIME_CONFIG=/workspace/mungsil-setup/m06/synthetic-runtime.json \
  node infra/verification/android-v1/real-api.cjs
```

이 호스트는 production AppModule에 테스트 경로를 추가하지 않는다. loopback DB 설정을 검증하고 A55개/B1개의 합성 완료 TODO·실제 로그인 가능한 두 계정을 만든다. API는 로컬 Docker bridge19106에만 bind한다. `/ready`가 DB/Redis/storage 모두 true인지 확인한 뒤 합성 로그인 자료를 작업 폴더의 `device-fixture.json`(0600)에 저장한다. 로그에는 Authorization·본문·cursor/query를 남기지 않는다.

호스트 PID는 `real-api.pid`, 요청 상태는 호스트별 `real-api-requests-*.jsonl`에 저장한다. 기존 fixture/PID 파일을 덮어쓰지 않는다. 성공한 실제 기록 시험은 A의 항목2개를 변경하므로, 같은 시험을 다시 실행하려면 fixture 호스트를 종료하고 새로 시작한 뒤 private fixture를 기기에 다시 복사한다.

호스트의 idle keep-alive timeout은50ms로 설정해 UI 조작 사이 서버가 연결을 닫는 조건을 재현한다. 읽기의 안전한 연결 복구와 쓰기 비재전송 검사는 이 조건과 별도 단위 회귀로 확인한다. production 서버의 timeout 설정을 바꾸지 않는다.

Android 컨테이너의 `socat`으로 container127.0.0.1:19106 → 실제 bridge 주소:19106을 연결하고 `adb reverse tcp:19106 tcp:19106`을 설정한다. fixture는 stdin을 이용한 `adb shell -T run-as kr.kro.mungsil ...`로 앱 내부 `files/m06-fixture.json`에 복사한다. 인증값을 command-line이나 로그로 넘기지 않는다. 준비가 끝나면 다음 instrumentation을 실행한다.

```text
adb -s emulator-5554 shell am instrument -w -r --no-window-animation -e disableAnalytics true \
  -e m06RealApi 1 -e class kr.kro.mungsil.HistoryRealApiTest \
  kr.kro.mungsil.test/androidx.test.runner.AndroidJUnitRunner
```

이 시험은 명시 opt-in이 없으면 skip한다. opt-in 후 fixture가 없거나 loopback19106이 아니면 실패한다. 실제 로그인·55개 pagination·취소/삭제 후 재조회·두 계정 전환·타 계정 cursor 거부·로그아웃한 세션 거부를 검사한다. production API URL과 토큰·서명 키·앱 저장 정책은 바꾸지 않는다.

실제 API의 긴 스크롤에서 발견한 stale 연결 문제는 Android `Api`의 읽기/쓰기 transport를 분리해 수정했다. GET만 연결을 복구하며, 쓰기 본문은 one-shot으로 보내 연결 실패나 서버503/0초 재시도 지시에도 불명확한 요청을 자동 반복하지 않는다. 사용자의 명시적인 결과 확인은 기존 본문과 동일 멱등 키로 수행한다.

## 종료

1. `real-api.pid`가 해당 fixture 호스트의 PID인지 확인하고 그 Node 프로세스에 SIGINT/SIGTERM을 보내 합성 두 계정·fixture/PID 파일을 정리한다. 도구의 터미널 종료만으로 Node 종료를 가정하지 않는다.
2. 기기의 `run-as`로 fixture 파일을 삭제하고 에뮬레이터를 종료한다. 이번에 만든 Android 컨테이너만 종료/제거한다.
3. `python infra/verification/android-v1/services.py stop /workspace/mungsil-setup/m06`으로 소유 ID/label이 일치하는 임시 서비스만 정리한다. tmpfs 데이터와 로컬 credential config가 제거된다. SDK/이미지·검증 로그는 보존한다.

이는 Android 연결 합성 검사다. 실제 Google/FCM·Play 서명/배포·실기기·실제 프로세스 종료/복원·TalkBack·운영 DB 역할 분리/규모 검증을 대신하지 않는다.

## M-11 · 엄격한 instrumentation 판정

이번 재현은 기존 M-06 AVD를 재사용하지 않았다. SDK의 `system-images;android-29;default;x86_64`와 avdmanager를 사용해 새 AVD 이름/폴더를 만들고 기존 경로가 있으면 중단한다. 사용자/AVD 경로는 checkout 밖 WORK/android-user, WORK/avds, WORK/avd29로 지정한다. 기본 pixel_2 해상도로 부팅한 뒤 축소하지 말고 **첫 부팅 전** config.ini를 다음과 같이 설정한다.

| 설정 | 이번 값 |
| --- | --- |
| hw.lcd.width / height / density | 360 / 780 / 160 |
| hw.ramSize / hw.cpu.ncore | 1536 / 2 |
| hw.gpu.enabled / mode | yes / swiftshader |
| showDeviceFrame / fastboot.forceColdBoot | no / yes |
| disk.dataPartition.size | 3G |

Dockerfile.android 이미지에서 repo/SDK는 같은 절대 경로로 readonly, WORK만 writable로 mount한다. `--rm --label todosns.verification=final-m11 --memory=10g --memory-swap=10g --cpus=4 --shm-size=1g --sysctl net.ipv6.conf.all.disable_ipv6=0`을 사용하고, ADB5037은 host127.0.0.1에만 공개한다. 반환된 정확한 container ID를 WORK/android-container-id에 저장한다. 컨테이너 내부 ADB를 `-a -P 5037 server nodaemon`으로 실행하고, ANDROID_AVD_HOME/ANDROID_EMULATOR_HOME을 WORK 아래로 지정해 emulator를 `-no-window -no-audio -no-boot-anim -no-snapshot -accel off -gpu swiftshader -feature -Vulkan -cores 2 -memory 1536`으로 실행했다. sdk/emulator 업데이트의 경고와 실제 부팅/ANR을 구분한다.

boot 완료와 초기 OS 화면을 확인한 뒤 matching 앱/시험 APK를 설치하고 `cmd package compile -m speed -f PACKAGE`로 두 패키지를 준비한다. 애니메이션3종을0으로 설정하고 인터넷 Wi-Fi/data는 끈다. loopback 합성 HTTP만 허용한다. 큰 메모리/낮은 해상도를 다른 OS·실기기의 성능 검증으로 확대하지 않는다. 종료할 때도 ID와 label을 확인한 해당 disposable 컨테이너만 stop한다.

선택할 class/method·기대 건수·폭/높이/글꼴은 [device-matrix.json](device-matrix.json)에 보존한다. 이 파일의 expected는 실행 결과가 아니다. 실제 결과는 M-11을 따른다. `real-api360`은 위의 private fixture 준비가 필요하며 `todo-low-ime`은 disposable emulator의 `show_ime_with_hard_keyboard=1` 조건과 종료 뒤 원래 설정 복원을 별도로 준비한다. 예를 들어 필요한 한 묶음만 재현한다.

```bash
TODOSNS_DEVICE_WORK=/workspace/mungsil-setup/final-m11 TODOSNS_DEVICE_CASE=core390 python - <<'PY'
import json, os, subprocess
from pathlib import Path
base = Path('infra/verification/android-v1')
case = next(x for x in json.loads((base/'device-matrix.json').read_text())['cases']
            if x['label'] == os.environ['TODOSNS_DEVICE_CASE'])
runner = case.get('runner', 'connected.py')
assert runner in ('connected.py', 'ime.py')
subprocess.run(['python', str(base/runner), os.environ['TODOSNS_DEVICE_WORK'],
                case['label'], case['classes'], str(case['expected']), str(case['width']),
                str(case['height']), str(case['fontScale'])], check=True)
PY
```

`connected.py WORK LABEL CLASS EXPECTED WIDTH HEIGHT SCALE`은 WORK의 `android-container-id`와 `todosns.verification=final-m11` 소유 label이 일치하는 disposable Docker emulator-5554만 사용한다. 앱/시험 APK를 같은 소스로 먼저 빌드·설치한다. 예:

```bash
python infra/verification/android-v1/connected.py /workspace/mungsil-setup/final-m11 cheer360 \
  'kr.kro.mungsil.NativeFlowTest#cheerRetryKeepsKeyAndNextSuccessfulActionUsesNewKey,kr.kro.mungsil.NativeFlowTest#feedAndDetailConfirmTheSameUncertainCheerRequest' 2 360 780 1.0
```

boot 완료와 실행 전후 OS ANR을 검사하고 instrumentation 성공 수·JUnit OK·최종 코드를 함께 판정한다. 결과 JSON과 windows/events/log/PNG는 WORK/LABEL에 저장한다. OS ANR이 관측되면 qualifiedPass가 될 수 없다. qualifiedPass도 이미지 직접 검토·실제 손가락/TalkBack/OS 프로세스 복원을 대신하지 않는다. 실패 시 반복 루프를 돌리지 말고 근거와 환경 제한을 남긴다. 크기/글꼴 변경 대상은 폐기할 에뮬레이터뿐이다.

UI-02의 ui02-ime/ui02-ime-final/ui02-ime-qualified는 `ime.py`로 실행한다. 동일 인자와 소유 guard를 사용하고 `show_ime_with_hard_keyboard` 원래 값을 읽은 뒤1로 설정한다. `connected.py` 실행 동안 실제 input_method의 표시 상태를 관측하고 끝나면 원래 설정을 복원/대조한다. JUnit/OS 검수 통과·실제 IME 관측·설정 복원이 모두 성공해야 wrapper가 통과한다. 결과/관측 PNG는 WORK/ime-observation/LABEL에 보관한다. 새 label을 사용해 기존 로그를 덮어쓰지 않는다. 설정만 바꾸거나 키보드 없는 semantics 입력 성공을 실제 IME 증거로 취급하지 않는다.

## M-12 · 실제 LOGIN 권한과 백업 복원

```bash
python infra/verification/android-v1/operations.py /workspace/mungsil-setup/m06 /workspace/mungsil-setup/m12
```

`services.py start` 후 실행한다. 소유 PG17의 새 `todosns_m12`/`todosns_m12_restore`만 생성하며 동명 DB가 있으면 중단한다. migration·기존 capability/runtime SQL·SCRAM TCP LOGIN/잘못된 암호 거부·runtime HTTP 시험·backup pg_dump·migrator 복원·복원 불변식을 검사한다. stdin/0600 파일로만 임시 자격 증명을 전달하고 컨테이너 비밀 파일은 finally에서 삭제한다. 로그/dump는 checkout 밖에 보관하고 최종 `services.py stop`으로 tmpfs DB·전체 fixture를 제거한다. 운영 SQL 자동 적용·운영 백업 검증 도구가 아니다.

PostgreSQL initdb는 loopback에 trust를 둘 수 있다. operations.py는 소유 PG 컨테이너 IP와 private pgpass를 사용하고 runtime/migrator/backup 각각의 잘못된 암호가 인증 실패하는지 먼저 검사한다. 다른 session_user로 연결했다는 사실만으로 암호 인증을 통과했다고 판단하지 않는다. 운영 hba/계정은 변경하지 않는다.


UI-02 최종 시험은 `requireIme=true`일 때 입력 후와 저장 좌표 클릭 직전에 실제 IME 표시를 검사한다. `ime.py`는 이 인자를 전달하며 `connected.py` 결과에 imeAssertionRequested를 기록한다. 시험 내부 캡처는 OS `screencap -p` 원본으로 저장한다. 이전 takeScreenshot 캡처의 검은 키보드 영역은 시각 증거로 채택하지 않았다. Dialog Back 대상 지정 전의 ui02-os360 실패, 단독 실행과 최종 ui02-dialog360/200·ime-qualified의 실제 결과는 [UI-02 보고서](../../../docs/redesign/android-v1/implementation-ui02.md)를 따른다. matrix의 과거 label을 현재 시험으로 재현해도 과거 시험 APK와 동일한 실행이라는 뜻은 아니다.
