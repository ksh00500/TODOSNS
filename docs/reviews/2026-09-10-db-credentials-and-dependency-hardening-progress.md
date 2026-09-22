# DB 자격 증명·의존성 하드닝 진행 기록

기준일: 2026-09-10. 시작 HEAD `2e6acb0eb5c41f26c1c3d259ebc6bc2d1a5929dc`. 이 문서는 로컬 구현 기록이며 EC2 격리 테스트나 운영 전환 승인이 아니다.

## 구현 완료

- `mungsil_owner` NOLOGIN, `mungsil_migrator`/`mungsil_runtime`/`mungsil_backup` LOGIN bootstrap SQL 추가.
- 실제 role 속성·membership·owner·PUBLIC/default privilege를 비밀 없이 출력하는 읽기 전용 inventory 추가.
- 기존 객체 owner 전환, public 모델 runtime DML allowlist, shadow/erasure 최소 권한, backup SELECT, 신규 객체 runtime 기본 거부와 owner default privilege SQL 추가.
- API는 runtime URL secret file만 읽고 실제 `session_user/current_user=mungsil_runtime`일 때 서버를 시작한다.
- migration job은 migrator URL secret file만 읽고 `session_user=mungsil_migrator`, `current_user=mungsil_owner`일 때만 Prisma deploy를 실행한다.
- API command에서 migration 제거. migration 실패 전에 기존 API를 교체하지 않는 순차 배포 스크립트 추가.
- seed 비밀과 seed 실행을 상시 API에서 제거하고 일회성 profile로 분리.
- backup dump를 bootstrap `mungsil` 대신 read-only `mungsil_backup`으로 변경.
- 실제 secret 파일은 Git과 Docker build context에서 제외하고 설명용 placeholder만 추가.
- 기존 적용 migration 14개는 수정하지 않았다.

## npm·이미지 기준

| 항목 | 결과 |
| --- | --- |
| 로컬 OS | Windows NT 10.0.26200.0 |
| Node/npm | v22.16.0 / 10.9.2 |
| lockfile SHA-256 | `A569171DA9AC32D2795FA075729F075B888F78327D7E0996124FFB2F82B60C53` |
| `npm audit --json` | 0건, exit 0 |
| `npm audit --omit=dev --json` | 0건, exit 0 |
| 패키지 변경 | 없음 |

2026-09-09 EC2 이미지 build의 Node 24 Alpine/npm 11.19.0 출력에는 설치 직후 전체 11건(10 high, 1 critical), prune 뒤 운영 10건(9 high, 1 critical)이 표시됐다. 당시 API/web image digest는 각각 `76c300f7fea1...`, `05dc41870f78...`였고 lockfile은 현재 HEAD와 같았다. 이 경고를 현재 로컬 npm 10의 0건과 합쳐 현재 결함으로 단정하지 않는다. CLI·advisory 시점·Linux runner 차이를 재현하기 위해 Node base image를 당시 digest `e67514e5...`로 고정하고 CI가 runner image 내부에서 production audit을 다시 실행하도록 했다.

audit 0건이므로 `npm audit fix --force`, lockfile 삭제, 무관한 package update는 하지 않았다. deprecation/install-script 경고는 advisory와 구분한다.

## 로컬 검증 상태

- production/staging Compose secret·profile 구성 해석: 통과. API에는 runtime secret만, migrate에는 migrator secret만 포함됨을 해석 결과로 재확인.
- 전체/운영 npm audit: 각각 0건. lockfile hash 불변.
- 정적 credential separation 테스트: 6/6 통과.
- `npm run lint`: 통과.
- `npm test`: API 75개 중 73 통과·기존 실제 DB/S3 E2E 2개 skip, web 50/50 통과.
- `npm run build`: contracts/API/Next 24개 page 통과.
- production/staging Compose config, Node/shell 구문, `git diff --check`: 통과.
- Linux image build·runner 내부 audit: 로컬 Docker engine 부재로 미실행, CI/승인된 EC2 검증 대상.
- 실제 PostgreSQL LOGIN, INVOKER trigger, migration/default privilege, backup/restore: 로컬 Docker engine 부재로 미실행.

## 격리 환경 검증: 승인 대기

2026-09-16에는 GitHub Actions의 합성 서비스 경로를 보강했다. 빈 PostgreSQL에서 migration을 두 번 실행하고, runtime/migrator의 잘못된 entrypoint가 시작에 실패하는지 검사하며, 실제 세 LOGIN으로 runtime DML 허용·DDL/TRUNCATE/migration 거부와 backup read-only를 검증한다. MinIO를 별도 컨테이너로 시작해 스토리지 E2E를 명시적으로 활성화하고, backup LOGIN의 custom dump를 별도 `mungsil_restore` DB에 복원해 marker를 조회한다. Linux API/web image build와 image 내부 production audit도 조건 없이 실행되도록 유지했다. 이 항목들은 **CI 구성 완료**이지 이 로컬 작업에서 실행 완료한 결과가 아니다.

대상은 현재 알려진 EC2 `3.27.27.110`의 `/home/ec2-user/mungsil-dbcred-verify-20260910`과 Compose project `mungsil-dbcred-verify-20260910`으로 한정한다. 실행 직전에 instance 유형, 1/5/15분 load, `MemAvailable`, swap, root disk, 운영 container와 외부 health를 읽기 전용으로 재확인한다. root 여유 2 GiB 미만 또는 `MemAvailable` 700 MiB 미만이면 시작하지 않고 보고한다.

- 운영 DB·S3·기존 volume/network/secret/env/repository를 사용하거나 수정하지 않는다. 합성 비밀번호 파일, 비공개 Docker network, 호스트 port가 없는 PostgreSQL 17 volume을 새로 만든다.
- PostgreSQL은 256 MiB/0.35 CPU, 필요한 Redis는 64 MiB/0.10 CPU로 제한한다. MinIO와 AWS S3는 사용하지 않는다.
- API build/runner와 web runner를 기존 Node digest·현재 lockfile로 한 번에 하나씩 build한다. 후보 tag만 만들고 운영 container는 교체하지 않는다. 이미지 안 npm 전체/운영 audit, Node/npm/Alpine, Prisma engine, sharp, image digest를 기록한다.
- 빈 합성 DB migration과 기존 migration/fixture가 있는 합성 DB 전환에서 role bootstrap/grant 재실행, 실제 runtime/migrator/backup LOGIN, session/current role, 신규 객체 기본 거부와 명시적 GRANT, trigger, 허용 DML, DDL·TRUNCATE·role·migration/protected table 거부를 검사한다.
- runtime URL로 DB E2E를 실행하고 migration 재실행(no-op), 잘못된 role/secret의 migration·API 시작 실패, backup `pg_dump`와 두 번째 격리 volume 복원을 검사한다. 테스트 데이터는 합성 데이터뿐이다.
- build와 DB 검증은 순차 실행한다. 운영 health가 2회 연속 실패하거나 `MemAvailable` 512 MiB 미만, root 여유 1 GiB 미만이면 현재 단계를 중단한다.

예상 영향은 같은 EC2의 CPU·디스크 I/O와 image pull/network 사용으로 인한 일시적 응답 지연 가능성, 약 15~30분, 후보 layer 포함 임시 1~2 GiB다. 새 AWS 자원은 만들지 않아 별도 상시 비용은 없고 기존 EC2 사용량만 증가한다. 복구는 trap과 사후 점검으로 이번 project 이름의 container/network/두 volume, 후보 image tag, 작업 path만 제거하고 운영 health를 재확인한다. 기존 image와 build cache, rollback image는 prune하지 않는다. 이 계획은 아직 승인·실행되지 않았다.

## 운영 전환: 별도 승인 대기

운영 DB role 생성, owner 이전, GRANT/default privilege 변경, secret 파일 생성·회전, backup role 전환, migration job/API/web 배포 및 서비스 재시작은 실행하지 않았다. 사전 backup의 격리 복원, 이전 image digest, 기존 bootstrap 연결 보존, runtime 실패 시 기존 API 복구 절차를 제시한 뒤 별도 승인을 받는다.

## 남은 위험

- 관리자 MFA·재인증·복구는 후속이며 관리자 화면 인터넷 공개 전 해결 조건이다.
- 신규 객체의 runtime 기본 거부·명시적 GRANT와 protected schema의 INVOKER trigger는 실제 LOGIN E2E 전까지 완료로 표시하지 않는다.
- OS image 취약점/SBOM은 npm audit과 별개이며 Linux 검증에서 기록해야 한다.
- 같은 EC2의 root/Docker 관리자는 secret mount에 접근할 수 있다.
