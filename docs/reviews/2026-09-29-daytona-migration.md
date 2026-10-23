# Daytona 개발 환경 이전 기록

## 현재 상태

이전 진행 약 40%. 웹 터미널에서 원격 명령 실행과 PostgreSQL·Redis·Mailpit 이미지 준비를 확인했으며 MinIO 소스 이미지 빌드·임시 컨테이너 준비 상태 검사까지 통과했다. 공식 HTTPS 전송 도구는 준비했지만 API 키가 없어 소스 전송과 프로젝트 설치는 완료하지 못했다. 운영 서버 이전이나 배포 작업이 아니다.

## 완료

- 사용자 제공 SSH로 대상 확인: Ubuntu 22.04.5 LTS, x86_64, root, 8GiB 디스크.
- 대상에 Node.js 24.21.0 / npm 11.19.0 / Docker 29.8.1 / Docker Compose 5.5.1 설치.
- 대상 Docker 데몬 응답 확인. 설치 직후 디스크 약 841MiB 사용, 약 7.2GiB 가용.
- 미커밋 소스를 포함한 이전 압축본과 파일별 SHA-256 목록 작성. 실제 환경파일, Firebase 관리자 키, Android 설정·서명 키, 의존성·빌드 결과와 Git 이력은 포함하지 않음.
- `infra/daytona`에 합성 환경 구성·설치·수동 재시작·중지 스크립트 준비. 로컬 소스의 기존 미커밋 작업 보존.
- Bash 문법, Compose 구성, JavaScript 문법 검사 통과.
- 합성 loopback 검사 통과: 로컬 전용 비밀값 생성, 기존 환경 덮어쓰기 거부, 웹/API 라우팅, POST 본문·요청 키 보존, upgrade 전달, 중지된 API의 502 응답.
- 원격 PostgreSQL 17·Redis 7·Mailpit v1.27 이미지 다운로드 확인. 서비스 컨테이너는 아직 실행하지 않음.
- 공식 Daytona SDK 0.218.0을 `outputs/daytona/tooling`에 별도 설치. 프로젝트 npm 의존성·잠금 파일은 수정하지 않음.
- HTTPS 전송 스크립트는 `mungsil` 이름과 확인된 hostname을 대조하고 새 임시 경로에만 업로드하며 압축본·목록의 SHA-256을 검증하도록 구성. 실제 API 전송은 미실행.
- 파일별 해시 검사에서 정상 파일, 중복 경로 거부, 경로 이탈 거부, 크기 변경·동일 크기 변조 탐지 확인. 키가 없는 전송은 사용자 데이터 전송 전에 중단됨.
- 사용자 직접 입력용 `save-api-key.ps1` 준비. 입력을 숨기고 키를 출력하거나 기존 파일을 덮어쓰지 않음. 실제 키는 아직 저장되지 않았으며 문법만 검사함.

## 연결 장애

도구 설치를 실행한 SSH 세션은 정상 종료됐다. 이후 SCP와 SSH 재접속이 `Connection timed out`로 실패했다. 당시 DNS의 세 IPv4 주소 모두 TCP 22번 연결 실패를 확인했다. SSH 호스트와 키 검증을 해제하거나 운영 환경으로 대체하지 않았다. 실패 원인을 Docker 설치나 토큰 만료로 확정하지 않는다. 자동 승인 검토의 거부는 발생하지 않았다.

사용자가 제공한 HTTPS Web Terminal에서 실제 명령 실행을 확인했다. root 계정, Node.js 24.21.0, Docker 데몬 29.8.1과 디스크 가용 공간 약 7.2GiB가 확인되어 기존 설치 환경이 유지되고 있다. SSH 연결 실패와 별개로 브라우저 터미널 접근은 가능하다. 계정 콘솔에 접근 가능한 브라우저 세션은 현재 도구에서 확인되지 않았다.

Web Terminal 화면에는 터미널 입력만 확인되었으며 파일 업로드 기능은 확인되지 않았다. 따라서 웹 터미널 연결 성공을 소스 전송 완료로 기록하지 않는다. 원격 명령은 이 경로로 실행할 수 있지만 압축본 전송은 SSH 복구 또는 공식 HTTPS 파일 전송 경로 확보가 필요하다. 이 기록 변경 후 실제 전송 직전에 소스 압축본과 해시 목록을 다시 생성한다.

## MinIO 이미지 준비

기존 Quay 태그는 원격에서 `401 Unauthorized`, 로컬 Docker manifest 조회에서 `no such manifest`로 실패했다. 이를 Daytona에만 발생하는 문제나 잘못된 사용자 계정으로 확정하지 않는다. 동일 공식 release `RELEASE.2025-09-07T16-13-09Z`를 Go 모듈 검증을 거쳐 빌드하는 대체 이미지를 준비했다.

첫 소스 빌드의 Alpine 패키지 저장소는 `Permission denied`로 실패했다. 네트워크 제한을 해제하지 않고 Daytona가 허용하는 Debian 저장소를 사용하는 최종 이미지로 수정했다. 원격 `/tmp/mungsil-minio-source/Dockerfile`과 `/tmp/mungsil-minio-build.log`에서 빌드 완료를 확인했다. `mungsil-minio:RELEASE.2025-09-07T16-13-09Z-source` 이미지는 약 284MB이며 Go 런타임은 1.24.13이다. 바이너리 버전 표시는 `DEVELOPMENT.GOGET`이므로 이를 정식 배포 바이너리의 버전 출력으로 표시하지 않는다. 공식 release 태그를 지정한 `go install`로 소스 버전을 고정했다.

독립적인 임시 컨테이너 `mungsil-daytona-minio-smoke`에 원격에서 생성한 합성 자격 증명을 사용하고 `127.0.0.1:19000`의 `/minio/health/ready` 성공을 확인했다. 초기 연결 준비 중 재시도 후 `MINIO_READY_PASS`가 출력되었다. 검사 종료 후 임시 컨테이너를 중지했으며 기존 DB·MinIO 볼륨을 사용하지 않았다. 이는 HTTP 준비 상태 검사이며 S3 버전·delete marker·API 통합 검사는 아직 미실행이다. 준비 스크립트와 Compose의 `MINIO_IMAGE` 선택은 설치 시 재사용하도록 연결했다. 기존 CI·개발 환경의 Quay 설정은 변경하지 않았다.

공식 근거: [Daytona 파일 시스템 API](https://www.daytona.io/docs/file-system-operations/), [Daytona 허용 패키지 저장소](https://www.daytona.io/docs/en/network-limits/), [MinIO 공식 소스 설치](https://github.com/minio/minio#install-from-source).

## 아직 실행하지 않음

- 원격 소스 압축 해제와 파일별 해시 대조
- 원격 npm 의존성 설치, 실제 PostgreSQL·Redis·MinIO·Mailpit 컨테이너 실행
- 실제 migration·DB LOGIN 경계·migration 재실행·백업/별도 DB 복원
- 원격 API/Web lint·테스트·빌드 및 HTTP/DB·MinIO 통합 검사
- 원격 앱 기동·준비 상태 검사, 중지/재시작 후 복구
- Linux 제품 이미지 빌드·감사
- Android SDK·에뮬레이터·AAB 제작, Play Google 로그인·실제 푸시

## 재개

원격 환경을 삭제하거나 볼륨을 초기화하지 않는다. 확인된 Web Terminal과 이미 설치한 패키지를 재사용한다. 소스 전송 경로를 확보한 뒤 비어 있는 `/opt/mungsil`에 전송하고 해시 대조 후 `infra/daytona/README.md`에 따라 설치·검증한다. 준비한 스크립트는 아직 원격에서 전체 실행·통과한 상태가 아니다.

최종 전송 압축본과 SHA-256은 `outputs/daytona/mungsil-source.tar.gz`, `outputs/daytona/source-manifest.json`, `outputs/daytona/package-summary.json`에 기록한다. SSH 토큰은 이 문서와 이전 소스에 저장하지 않는다.
