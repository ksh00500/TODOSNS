# Daytona 개발 환경 이전

운영 서버와 별개인 합성 데이터 개발 환경이다. Linux Container 2 vCPU / 4GiB / 8GiB 기준으로 웹·API 빌드를 순서대로 실행한다. Android 소스는 포함하지만 SDK·에뮬레이터·서명 키 설치는 포함하지 않는다.

## 소스 전송

로컬 저장소에서 `node infra/daytona/package-source.cjs`를 실행한다. Git의 추적 파일과 무시되지 않은 미커밋 파일을 현재 내용으로 묶고, 비밀키·환경파일·빌드 결과를 제외한다. `outputs/daytona/source-manifest.json`에 파일별 SHA-256과 원본 HEAD를 기록한다. 압축본은 작업 중인 파일 스냅샷이며 Git 이력은 포함하지 않는다.

`mungsil-source.tar.gz`와 `source-manifest.json`을 샌드박스로 전송한 뒤 **비어 있는 새 디렉터리** `/opt/mungsil`에 압축을 해제한다. 기존 디렉터리 위에 임의로 덮어쓰지 않는다. 전송 후 파일별 해시를 대조한다.

SSH 연결이 막혔다면 공식 Daytona SDK의 HTTPS 파일 전송을 사용한다. 로컬에서 다음을 준비한다. API 키는 `.daytona-private/daytona-api-key` 파일에만 두거나 명령 인자로 키 파일 경로를 제공한다. 이 폴더와 키는 Git·소스 압축본에 포함하지 않는다.

```powershell
npm install --prefix outputs/daytona/tooling --no-audit --no-fund @daytonaio/sdk@0.218.0
node infra/daytona/package-source.cjs
node infra/daytona/upload-source.cjs
```

전송은 `mungsil` 샌드박스를 조회하고, 확인된 터미널 hostname과 일치할 때만 진행한다. 새 임시 디렉터리에 업로드하므로 기존 프로젝트를 덮어쓰지 않으며 압축본·목록의 해시 확인 결과를 `outputs/daytona/transfer-receipt.json`에 저장한다. SDK 요청 오류에 키나 전체 HTTP 요청을 출력하지 않는다. 샌드박스를 새로 만들었다면 hostname을 임의로 바꾸지 말고 대상부터 다시 확인한다.

키를 숨긴 입력으로 로컬 파일에 저장하려면 사용자가 직접 `powershell -File infra/daytona/save-api-key.ps1`을 실행한다. 기존 키 파일은 덮어쓰지 않는다. 키를 채팅·명령 인자·환경 예제에 넣지 않는다.

새 프로젝트 디렉터리에 압축 해제 후 다음으로 파일별 해시를 확인한다. 목록 경로는 전송 영수증의 원격 디렉터리에 있는 파일을 사용한다.

```bash
node /opt/mungsil/infra/daytona/verify-source.cjs /opt/mungsil /tmp/<전송-디렉터리>/source-manifest.json
```

## 설치

Ubuntu 22.04 root 환경에서 다음을 실행한다.

```bash
bash /opt/mungsil/infra/daytona/bootstrap.sh
cd /opt/mungsil
bash infra/daytona/install-project.sh
```

설치 스크립트는 새 합성 DB에 migration을 적용하고 runtime·migrator·backup LOGIN을 분리한다. 새 환경파일이 이미 있으면 재생성하지 않는다. 비밀값은 샌드박스에서 생성하며 `.env`와 `.daytona-private`에 소유자만 읽을 수 있게 저장한다. 운영 키·운영 DB·실제 사용자 데이터는 필요하지 않다. Google 로그인과 FCM 발송은 비활성화한다.

MinIO의 기존 Quay 이미지가 내려받아지지 않으면 `Dockerfile.minio`로 **같은 공식 release 태그**를 빌드한다. 다른 S3 구현이나 출처가 불분명한 이미지로 바꾸지 않는다. 2 vCPU·4GiB에서 Go 빌드 동시 작업을 2개로 제한한다. 성공한 이미지 선택은 `.env`의 `MINIO_IMAGE`에 남겨 재시작 때 재사용하며, 실제 소스 빌드 결과와 스토리지 통합 검사 결과는 별도로 기록한다.

## Start / Stop 이후

Daytona에서 Start한 뒤 실행한다.

```bash
cd /opt/mungsil
bash infra/daytona/start.sh
```

Docker를 다시 시작하고 서비스와 API·웹·8080 개발 프록시를 실행한다. `/api/v1/ready`와 웹 응답을 확인한다. 시작은 migration이나 데이터 초기화를 수행하지 않는다.

프로젝트 서비스만 중지하려면 다음을 실행한다. DB·MinIO 볼륨은 보존한다.

```bash
cd /opt/mungsil
bash infra/daytona/stop.sh
```

이 명령은 샌드박스 과금을 멈추지 않는다. 사용을 마친 뒤 Daytona Dashboard에서 **Stop**한다. Auto-stop `0`, Auto-delete disabled, Ephemeral false 설정을 유지한다.

## 접근

8080은 웹·API·Socket.IO의 동일 출처 개발 프록시다. DB·Redis·MinIO·Mailpit은 loopback에만 바인딩한다. 직접 브라우저·사진 업로드 검증에는 SSH 포트 포워딩으로 8080과 9000을 로컬에 연결하고 `http://localhost:8080`에 접속한다. 이미 사용 중인 로컬 포트를 덮어쓰지 않는다.

```text
ssh -L 8080:127.0.0.1:8080 -L 9000:127.0.0.1:9000 <DAYTONA_SSH_TOKEN>@ssh.app.daytona.io
```

Daytona HTTPS 미리보기에서 로그인·메일 링크·사진을 검증하려면 해당 미리보기 URL에 맞춘 WEB_ORIGIN·SITE_ORIGIN·공개 스토리지 URL 설정과 추가 검증이 필요하다. 전체 서비스를 Public으로 전환하지 않는다.

## 검증

```bash
cd /opt/mungsil
set -a
. ./.env
set +a
npm run lint
NODE_ENV=test RUN_DATABASE_E2E=1 RUN_OBJECT_STORAGE_E2E=1 OBJECT_STORAGE_VERSIONED=1 npm test
npm run build
```

DB LOGIN 검사, migration 재실행, 백업·별도 DB 복원, Linux 이미지 검사는 `.github/workflows/ci.yml`의 합성 절차를 사용한다. 실행하지 않은 검사를 통과로 기록하지 않는다. 8GiB 디스크에서 이미지 빌드와 Android SDK 설치를 동시에 진행하지 않는다.
