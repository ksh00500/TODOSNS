# DB runtime·migration 자격 증명 분리 운영 절차

상태: 로컬 구현 완료, 격리 PostgreSQL LOGIN 검증 및 운영 전환 승인 대기. 이 문서는 운영 변경 승인이 아니다.

## 경계와 역할

| 역할 | LOGIN | 허용 | 금지 |
| --- | --- | --- | --- |
| `mungsil_owner` | 아니요 | 뭉실 DB/schema/table/function/type 소유 | 애플리케이션 연결 |
| `mungsil_migrator` | 배포 시만 | owner로 명시적 `SET ROLE`, Prisma migration history와 DDL | superuser, DB/role 생성, 평상시 API 연결 |
| `mungsil_runtime` | 상시 API | 현재 public 제품 모델 CRUD, shadow 동기화, 탈퇴·객체 삭제 레지스트리 | 객체 소유, DDL/TRUNCATE, role 관리, owner/migrator 전환, migration history 쓰기, 분석·반출·정책 승인 원문 |
| `mungsil_backup` | 예약 백업 시만 | 모든 뭉실 schema의 읽기와 dump | 애플리케이션 쓰기, DDL, role 전환 |
| 기존 `mungsil` | 전환 중 관리 경로 | bootstrap·장애 복구 | API와 정기 백업에 계속 사용하지 않음 |

runtime allowlist는 `infra/database/apply-runtime-grants.sql`의 명시적 public 테이블 목록이다. 현재 Prisma 모델이 아직 public에 있으므로 이 임시 범위는 넓지만 `ALL ON SCHEMA`, owner membership, protected analytics 접근은 부여하지 않는다. identity의 `AccountIdentity`, service의 `ServiceProfile`은 `SECURITY INVOKER` shadow trigger에 필요한 SELECT/INSERT/UPDATE만 허용한다. governance에서는 `ErasureRequest`, `ErasureTask`, `ObjectDeletionTask`만 허용한다.

새 public 제품 테이블도 runtime 권한을 자동으로 받지 않는다. owner의 default privilege는 PUBLIC 접근을 닫고 backup SELECT만 유지한다. 새 테이블·시퀀스·타입의 runtime 권한은 기능 검토 후 `apply-runtime-grants.sql`의 allowlist 또는 해당 migration에 명시해야 한다. 보호 schema의 새 객체도 backup SELECT 외에 runtime 권한을 자동으로 받지 않는다.

## 비밀과 컨테이너 경계

운영 `.env`에는 실제 DB URL이나 비밀번호를 두지 않고 권한 `0600`인 파일의 절대 경로만 둔다. 운영 파일은 repository와 Docker build context 밖(예: `/srv/mungsil/secrets/`)에 둔다. `infra/secrets/*.example`은 Compose 해석용 placeholder이며 실제 접속에 사용하지 않는다.

| 호스트 파일 변수 | 컨테이너 대상 | 접근 서비스 |
| --- | --- | --- |
| `DATABASE_BOOTSTRAP_PASSWORD_FILE` | `/run/secrets/database_bootstrap_password` | PostgreSQL 초기화만 |
| `DATABASE_RUNTIME_URL_FILE` | `/run/secrets/database_url` | API, 승인된 일회성 seed |
| `DATABASE_MIGRATOR_URL_FILE` | `/run/secrets/database_url` | 일회성 migrate job만 |
| `DATABASE_BACKUP_PASSWORD_FILE` | `/run/secrets/database_backup_password` | PostgreSQL 내부 backup command만 |

API image에는 migration 코드와 Prisma CLI가 남아 있지만 migrator·owner·bootstrap 비밀은 없다. 따라서 runtime 자격 증명으로 CLI를 실행해도 DDL과 `_prisma_migrations` 쓰기가 거부돼야 한다. 같은 EC2의 root/Docker 관리자는 컨테이너 secret을 읽을 수 있으므로 이것을 호스트 관리자에 대한 격리로 과장하지 않는다.

runtime URL은 `mungsil_runtime`으로 직접 연결한다. migrator URL은 `mungsil_migrator`로 로그인하되 다음 옵션으로 현재 역할을 NOLOGIN owner로 바꾼다.

```text
...?schema=public&options=-c%20role%3Dmungsil_owner
```

두 entrypoint는 URL을 로그에 출력하지 않으며 연결 직후 `session_user/current_user`를 검사한다. 예상 역할과 다르면 서버나 migration이 시작되지 않는다. inline `DATABASE_URL`을 함께 제공하는 것도 거부한다.

## 신규 설치와 기존 볼륨 전환

`POSTGRES_USER` 변경만으로 기존 volume의 역할이 바뀌지 않는다. 기존 데이터를 보존한 채 다음 순서로 전환한다.

1. 대상 DB/hostname, 현재 커밋·migration·role·owner·PUBLIC/default privilege를 `inspect-role-boundaries.sql`로 읽기 전용 기록한다. 비밀번호 verifier와 연결 문자열은 출력하지 않는다.
2. 승인된 최신 DB 백업을 운영과 분리된 DB에 복원하고 핵심 합성 계정으로 복원 검증한다.
3. 서로 다른 32자 이상 runtime/migrator/backup 비밀번호를 승인된 secret manager 또는 권한 0600 파일로 생성한다. 채팅, shell history, CLI 인자에 넣지 않는다.
4. bootstrap 관리자 세션에 세 비밀번호를 환경 secret으로만 주입하고 `bootstrap-login-roles.sql`을 실행한다. SQL은 LOGIN 속성과 membership을 재실행 가능하게 교정하지만 비밀번호를 출력하지 않는다. capability 역할이 아직 없다면 같은 관리 세션에서 `roles.sql`도 실행한다.
5. 같은 관리 세션에서 DB 이름과 기존 owner를 확인한 뒤 `apply-runtime-grants.sql`을 실행한다. 이 단계가 기존 객체 소유권을 `mungsil_owner`로 이전하고 runtime/backup allowlist와 owner default privilege를 적용한다.
6. runtime·migrator URL secret 파일과 backup password 파일을 만들고 권한·소유자를 확인한다. URL 비밀번호는 percent-encoding이 맞아야 하며 세 역할의 비밀번호와 일치해야 한다.
7. `verify-db-logins.cjs`를 실제 세 LOGIN URL로 실행한다. runtime 허용 DML과 DDL/TRUNCATE/role/migration/analytics 거부, backup read-only, migrator의 owner 역할, 새 객체의 runtime 기본 거부와 검토된 명시적 GRANT 후 DML 허용을 확인한다.
8. 기존 API는 유지한 채 migration job을 중복 실행해 pending 0과 재실행 안전성을 확인한다. 실패하면 API를 교체하지 않는다.
9. 새 runtime API를 시작해 readiness와 핵심 순환을 확인한 다음 웹을 전환한다. 정기 백업도 `mungsil_backup`으로 성공하고 격리 복원이 되는지 확인한다.
10. 안정화 후에만 API/백업에서 기존 `mungsil` 비밀 사용을 회수한다. 유일한 bootstrap·복원 경로를 먼저 삭제하지 않는다.

일반 seed는 API 시작에 포함하지 않는다. 필요할 때만 `seed` profile의 일회성 job을 실행하며, 운영 demo seed는 계속 OFF다.

## 배포 실행 경로

`sh infra/deploy-separated.sh infra/docker-compose.yml /srv/mungsil/.env`가 지원 경로다. 순서는 PostgreSQL/Redis health → API/web 순차 build → migrate job → runtime API health → web → Caddy다. migration이 실패하면 실행 중인 기존 API는 교체하지 않는다. API 단순 restart는 migration을 실행하지 않는다.

운영자는 시작 전에 이전 API/web image digest와 DB backup 변경 번호를 기록해야 한다. `docker compose up` 직접 실행으로 migration 단계를 건너뛰지 않는다.

## 검증과 실패 복구

- runtime 연결 오류: 새 API만 시작하지 않고 기존 API와 기존 관리 자격 증명을 유지한다. role grant를 넓히기 전에 실패 query와 실제 allowlist를 비교한다.
- migration 실패: `_prisma_migrations`를 수동 수정하지 않는다. 기존 API를 유지하고 catalog와 migration 상태를 확인한 뒤 검토된 전진 수정 또는 Prisma 공식 resolve 절차를 사용한다.
- 새 API 기능 실패: migration이 이전 이미지와 호환되면 기록한 이전 image digest와 기존 관리 URL로 API를 되돌린다. role/ownership 변경은 자동 역전하지 않는다.
- backup 실패: runtime이나 migrator 비밀로 우회하지 않는다. `mungsil_backup`의 CONNECT/USAGE/SELECT와 backup password 파일 권한만 점검한다.
- owner/migrator secret 노출: migrator LOGIN을 즉시 차단·회전하고 실행 기록을 확인한다. runtime 비밀과 함께 재사용하지 않는다.

소유권 이전과 GRANT는 데이터 행을 삭제하지 않지만 운영 권한 오류를 만들 수 있다. 운영 적용 전에 빈 DB와 기존 14-migration 합성 DB에서 실제 LOGIN URL, INVOKER trigger, 핵심 API 흐름, 중복 migration, 실패 migration, backup/restore를 모두 검증한다.

## 계속 남는 위험

- 관리자 MFA·재인증·복구는 미구현이며 관리자 화면 인터넷 공개 전 해결 조건이다.
- 기존 public 모델의 runtime DML allowlist는 contract 단계에서 repository/schema가 분리될 때 더 축소해야 한다.
- 같은 EC2 root/Docker 관리자에 대한 비밀 격리는 아니다.
- npm audit 0건은 npm advisory 기준 결과일 뿐 OS image, 설정, 미공개 취약점의 안전을 보장하지 않는다.
