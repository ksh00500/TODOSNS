# DB 런타임·마이그레이션 권한 분리 및 의존성 검증 후속 프롬프트

작성일: 2026-09-10. 이 문서는 후속 작업 지시이며 운영 변경 승인이 아니다. 관리자 MFA 구현은 이번 범위에서 제외하고 미해결 운영 위험으로 유지한다.

## 확인한 현재 상태

- 로컬 HEAD: `2e6acb0eb5c41f26c1c3d259ebc6bc2d1a5929dc`.
- Node `v22.16.0`, npm `10.9.2`에서 읽기 전용 감사 실행.
- `package-lock.json` SHA-256: `A569171DA9AC32D2795FA075729F075B888F78327D7E0996124FFB2F82B60C53`.
- `npm audit --omit=dev --json`: 취약점 0건, exit 0.
- `npm audit --json`: 개발 의존성 포함 취약점 0건, exit 0.
- 위 결과는 현재 로컬 의존성 기준이며 운영 이미지·OS 패키지·기존 보고서의 경고가 해소됐다는 증거는 아니다.
- 저장소의 운영·staging Compose는 API 시작 명령에서 `prisma migrate deploy`와 서버 시작을 연달아 수행한다. API URL도 PostgreSQL 초기 계정과 같은 `mungsil`을 사용하도록 작성돼 있다. 실제 운영 역할 속성과 배포 파일은 별도 확인해야 한다.
- `infra/database/roles.sql`은 NOLOGIN capability 역할을 제공한다. 실제 API LOGIN 계정을 제한 계정으로 전환한 증거는 아니다.
- 현재는 expand 단계다. 기존 `public.User`와 제품 테이블이 실제 API 원본이고 새 identity/service는 shadow를 포함한다. 목표 스키마 역할만 API에 부여하면 기존 기능이 실패할 수 있다.
- shadow 동기화·snapshot 정리 trigger는 `SECURITY INVOKER`다. 제한 계정으로 바꿀 때 trigger의 후속 쓰기 권한까지 확인해야 한다.
- EC2 문서의 동일 호스트 순차 격리 검증은 과거 실행 기록이다. 운영 권한 분리 또는 실제 AWS S3 검증 완료와 동일하지 않다.

## 새 작업 실행 프롬프트

뭉실 프로젝트에서 다음 두 작업을 구현하고 검증해줘.

1. API 상시 실행 계정과 일회성 migration 계정의 실제 권한·비밀·실행 경로 분리.
2. npm 경고의 현재 상태를 재현하고, 남은 취약점이 있을 때 필요한 의존성만 수정. 현재 0건이면 무의미한 업그레이드 대신 재현성·CI·배포 이미지 검증을 보완.

### 시작과 범위

- `AGENTS.md`, 이 문서, `docs/reviews/2026-09-09-data-governance-ec2-verification.md`, `docs/architecture/database-boundaries-and-access.md`, `docs/reviews/2026-09-08-data-governance-security-progress.md`를 읽어라.
- `infra/database/roles.sql`, 실제 migration/trigger, 운영·staging Compose, API Dockerfile, 배포·백업 스크립트, Prisma 구성, package manifests/lockfile, CI를 확인한다.
- Git 변경을 보존하고 문서의 날짜·커밋·검증 결과를 재확인한다. 정책 승인 내용을 새 법률 승인으로 해석하지 않는다.
- 목표는 먼저 runtime과 DDL 권한 분리다. 모든 테이블 이동·User contract 제거·전체 인증 Repository 분할을 한 번에 강행하지 않는다. 현재 구조상 필요한 임시 권한과 다음 단계의 축소 대상을 문서화한다.
- MFA는 후속 위험으로 남기고 관리자 인터넷 공개 전 해결 조건을 유지한다. 관리자 인증을 약화하거나 우회 기능을 만들지 않는다.

### A. 실제 DB 계정 경계

권장 역할은 다음과 같다. 이름은 기존 충돌 여부를 확인하고 정한다.

- `mungsil_owner`: NOLOGIN 객체 소유 역할. 앱 로그인 불가.
- `mungsil_migrator`: 배포 시에만 쓰는 LOGIN 역할. 승인된 대상 DB와 owner 역할을 통한 DDL·Prisma migration history 관리. 평상시 API에 비밀을 제공하지 않는다.
- `mungsil_runtime`: API LOGIN 역할. 현재 서비스에 필요한 테이블·열·시퀀스·함수 권한만 허용. 객체 소유·DDL·role 관리·migration history 변경은 금지.
- 역할 생성·소유권 이전 등 bootstrap 관리자 권한은 위 migrator가 무조건 갖는 권한이 아니다. 승인된 관리 절차로 별도 수행한다.
- 백업/정리/집계 작업의 기존 접속 계정을 조사한다. API 비밀을 migrator 비밀로 바꿔 우회하지 말고, 필요한 역할을 별도로 설계한다. 분석 수집·반출 OFF는 유지한다.

필수 구현:

1. 실제 DB의 사용자 속성·소유권·직간접 membership·PUBLIC 권한·default privileges를 점검할 읽기 전용 SQL을 만든다. 비밀번호 해시나 연결 문자열은 출력하지 않는다.
2. runtime은 NOSUPERUSER/NOCREATEDB/NOCREATEROLE/NOBYPASSRLS이며 DB/schema/table/function owner가 아니어야 한다. migrator/owner로 `SET ROLE`할 수 있는 직간접 경로, ADMIN OPTION도 없어야 한다. NOINHERIT만으로 경계가 완성됐다고 판단하지 않는다.
3. DB CONNECT/TEMP, public 및 보호 schema CREATE/USAGE, sequence, function EXECUTE, PUBLIC/default 권한을 실제 기능에 맞게 정한다. 향후 migration 객체에도 올바른 권한이 적용되도록 실제 객체 생성 역할의 `ALTER DEFAULT PRIVILEGES`와 명시적 GRANT를 설계한다.
4. 기존 `public` 모델의 API query와 현재 기능을 추적해 임시 allowlist를 만든다. 편의를 위해 모든 schema 전체 권한, owner membership, superuser를 부여하지 않는다. API가 읽을 필요 없는 분석/매핑 테이블은 계속 거부한다.
5. INVOKER trigger가 수행하는 shadow·snapshot 쓰기를 제한 LOGIN으로 검증한다. 필요 최소 권한으로 충족하거나 한정된 DEFINER 함수를 검토한다. DEFINER가 필요하면 비슈퍼유저 소유자, 고정 안전 search_path, 완전 수식 객체명, PUBLIC EXECUTE 회수, 임의 동적 SQL 금지, 권한 상승/변조 테스트를 갖춰야 한다. 모든 함수를 일괄 DEFINER로 바꾸지 않는다.
6. `_prisma_migrations` 쓰기와 DDL은 runtime에서 거부한다. readiness가 읽어야 하는 metadata가 있으면 필요한 읽기만 허용한다.
7. 기존 적용 migration 파일은 수정하지 않는다. 소유권/권한 전환은 검토 가능한 후속 SQL·관리 단계로 만들고 재실행 안전성을 검증한다.

### B. 실행 경로와 비밀 분리

- API command는 서버 시작만 수행한다. API 재시작마다 migration을 실행하지 않는다.
- migration은 일회성 deploy job/Compose 서비스로 분리하고, 성공 후에만 새 API가 시작/전환되게 한다. 실패 시 기존 서비스 유지 또는 명확한 중단 정책을 갖춘다.
- Prisma 6.12에서 동작하는 최소 방식을 택한다. 예: API는 runtime용 DATABASE_URL, migration job은 그 job 안에서만 migrator용 URL을 DATABASE_URL로 주입. `DIRECT_URL` 등 별도 필드가 꼭 필요하면 해당 버전 동작을 검증한다.
- API container environment/mount/image에 migrator·owner·bootstrap 비밀을 넣지 않는다. .env.example에는 설명용 placeholder만 두고 실제 URL·비밀번호를 커밋/로그/CLI 인자에 노출하지 않는다.
- 공통 .env 전체를 API에 주입하거나 Docker socket/호스트 배포 비밀을 마운트해 분리를 무효화하지 않는다. 같은 EC2 관리자에 대한 완전 격리라고 과장하지 않는다.
- 기존 DB volume은 초기 POSTGRES_USER 값을 바꾸는 것만으로 사용자/권한이 바뀌지 않으므로 데이터 보존형 ALTER/GRANT 절차를 작성한다. 볼륨 삭제·DB 재생성 금지.
- 새 runtime 연결과 기능을 검증한 뒤 기존 API 연결 회수·필요한 비밀 회전을 수행하도록 순서를 설계한다. 유일한 관리/복원 경로부터 제거하지 않는다.
- 신규 설치와 기존 DB 업그레이드 모두 지원한다. 백업 timer·healthcheck·seed·배포 스크립트가 함께 동작하는지 검증한다. 일반 seed를 시작 경로에 넣지 않는다.

### C. npm 감사와 공급망 검증

1. HEAD, lockfile hash, Node/npm/OS, audit scope를 기록하고 전체/운영 감사 두 종류를 다시 실행한다. 이전 고위험 보고서와 패키지·버전·잠금 파일·이미지 digest를 비교한다. 서로 다른 시점의 보고서를 합쳐 현재 결함처럼 보고하지 않는다.
2. 취약점이 있으면 advisory URL, 직접/전이 의존 경로, 운영/개발/빌드 포함 여부, 공격 조건, 실제 도달 가능성, 수정 버전을 정리한다. 개발 의존성도 CI/빌드 위험이 있어 무조건 무시하지 않는다.
3. `npm explain`/`npm ls`로 원인을 찾고 수정 가능한 최소 호환 업데이트를 우선한다. 기존 overrides의 필요성과 호환성을 확인한다. 경고를 없애기 위해 무조건 `npm audit fix --force`하거나 lockfile을 삭제하지 않는다.
4. 현재 0건이면 불필요하게 버전을 바꾸지 않는다. 감사 0건은 알려진 npm 취약점 검색 결과이지 전체 보안 완료가 아니다. deprecation/engine/peer 경고와 보안 advisory를 구분한다.
5. 운영 이미지가 node:24-alpine 기반이고 로컬 검사 환경과 다르므로 Linux의 실제 이미지 빌드·prune·Prisma 엔진·sharp 등 네이티브 모듈을 검증한다. 깨끗한 임시 checkout/runner에서 `npm ci` 재현성을 확인하고 공유 작업 중인 node_modules를 무단 제거하지 않는다.
6. 운영 컨테이너 내부에서 npm install/ci/update를 실행해 즉석 수정하지 않는다. 테스트한 잠금 파일로 이미지를 재빌드해 배포한다. build/runner/migration 이미지의 패키지 구성과 가능하면 SBOM·OS 이미지 취약점도 구분해 기록한다.
7. CI에 운영 감사와 전체 감사, lint/test/build를 명시한다. 남은 high/critical은 숨기거나 임계값을 완화하지 말고 수정 또는 근거·담당자·만료일이 있는 사용자 승인 예외로 관리한다.

### D. EC2 검증과 운영 반영은 구분

- EC2 검증 문서에 따르면 운영 서버는 t3.micro·메모리 약 1 GiB였다. 현재 상태를 읽기 전용으로 재확인한다. 과거 같은 호스트 테스트 승인을 이번 추가 부하/배포 승인으로 재사용하지 않는다.
- 로컬 Docker 엔진이 없으면 EC2/CI 등 격리 Linux 대안을 제시한다. 접속 정보가 없으면 사용자에게 필요한 정보만 질문하고 개인키 내용은 요구/출력하지 않는다.
- 운영 DB·S3는 합성 테스트 대상으로 쓰지 않는다. 별도 path/project/DB login/network/volume, 자원 상한과 포트 비노출, 실행·정리 대상, 비용/운영 영향, 중단 조건을 제시해 승인을 받은 뒤 실행한다.
- 같은 EC2에서 승인된 저자원 순차 테스트를 한다면 동시 대규모 이미지 빌드·DB·MinIO 기동을 피하고 단계별 운영 health·메모리·디스크를 관측한다. 임시 자원 정리는 이번에 생성한 정확한 대상만 수행한다.
- 실제 역할 전환·비밀 교체·migration·서비스 재시작·배포는 별도 운영 변경 승인 후 실행한다. 사전 백업/격리 복원 검증, 적용 순서, 예상 영향, 실패 시 복구 절차를 먼저 제시한다.

### E. 완료 조건과 결과물

- 테스트는 owner의 SET ROLE만으로 끝내지 않고 실제 runtime LOGIN URL로 연결한다. session_user/current_user·membership을 확인한다.
- 허용: 로그인·Google 로그인·TODO 생성/수정/완료/삭제·게시·복제·채팅·챌린지·탈퇴/정리 경로·shadow/snapshot trigger 동작.
- 거부: CREATE/ALTER/DROP/TRUNCATE, role 관리, migrator/owner SET ROLE, `_prisma_migrations` 쓰기, 승인 정책/감사/분석 보호 테이블의 불필요한 변경.
- migrator만 새 migration을 적용할 수 있고, 새 객체의 권한도 올바르며 API에는 migration 비밀이 없음을 검증한다.
- 빈 DB/기존 합성 DB 업그레이드, API 재시작, migration 실패, 연결 전환·권한 오류, 중복 deploy job, backup/restore 회귀를 검증한다.
- lint·전체 테스트·프로덕션 빌드·npm 감사·Linux 이미지 검증 결과를 기록하고 skip은 성공으로 세지 않는다.
- `docs/operations/database-runtime-migration-separation.md`: 권한 행렬, 비밀/실행 경계, 초기화·전환·복구 절차.
- `docs/reviews/2026-09-10-db-credentials-and-dependency-hardening-progress.md`: 기준 버전, 감사 전후, LOGIN 거부 테스트, 로컬/격리/운영 상태, 남은 위험.
- 기존 DB 경계 ADR과 배포/백업 런북의 오래된 상태도 실제 증거에 맞춰 갱신한다.

로컬 코드·설정·테스트·문서 구현은 진행하되, 실제 운영 변경·기존 데이터 backfill/파기·분석 수집·외부 제공·배포·커밋·푸시는 별도 승인 전 실행하지 않는다. 최종 답변은 ‘구현 완료’, ‘격리 환경 검증’, ‘운영 전환 승인 대기’를 분리한다.

## 기술 기준 출처

- [PostgreSQL 17 역할 속성](https://www.postgresql.org/docs/17/role-attributes.html): 비로그인 소유 역할·권한 상속과 별개로 실제 membership/SET 경로 검토.
- [npm audit 공식 문서](https://docs.npmjs.com/cli/v11/commands/npm-audit/): audit scope·fix/force 의미 확인. 실제 CLI 10의 동작도 설치 버전 기준으로 확인.

## 새 작업에 붙여 넣을 지시

```text
docs/reviews/2026-09-10-db-credentials-and-dependency-hardening-prompt.md를 전체 읽고 실행해줘.
관리자 MFA는 후속으로 남기고, 우선 API 런타임과 migration의 실제 DB 계정·비밀·실행 경로를 분리해줘. npm 감사는 현재 로컬 전체/운영 모두 0건이었다는 점을 재확인하고, 이전 경고와 운영 이미지의 버전 차이를 조사한 뒤 필요한 수정만 해줘.
로컬 구현은 진행하되 EC2 격리 테스트는 대상·자원·영향을 제시하고 승인을 받아 실행해줘. 운영 DB 권한/비밀 변경·배포·커밋·푸시는 별도 승인 전 하지 마.
```
