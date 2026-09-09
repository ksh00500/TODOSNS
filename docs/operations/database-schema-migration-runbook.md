# 데이터 보존형 다중 스키마 migration 런북

상태: 운영 실행 금지. `20260908120000_data_governance_expand`는 로컬/CI 합성 DB 검증 대상이며 운영 적용은 별도 승인 대상이다.

## 사전 조건

1. 대상 hostname/database/schema를 출력하되 비밀번호는 출력하지 않는다. 뭉실 전용 격리 DB인지 두 사람이 확인한다.
2. 적용 중인 commit SHA, Prisma 6.12.0, PostgreSQL 17, 전체 migration checksum과 `_prisma_migrations` 상태를 기록한다.
3. schema/model/enum/constraint/index/sequence/view/trigger와 raw SQL 참조를 inventory한다.
4. 암호화 DB backup과 media inventory를 같은 변경 ID로 만들고 격리 복원 성공, RPO/RTO, checksum을 기록한다.
5. runtime/migrator LOGIN role, `search_path`, owner, public CREATE, default privileges를 확인한다.
6. 실제 운영 migration은 점검 창·실행자·rollback/전진 수정 승인 뒤 한 번만 수행한다. `db push`, `migrate reset`, 기존 migration 수정은 금지한다.

## 합성 검증 순서

### 빈 DB

1. 새 PostgreSQL 17 database를 만들고 기존 전체 migration을 `prisma migrate deploy`로 적용한다.
2. `infra/database/roles.sql`과 `verify-role-boundaries.sql`을 owner 연결로 실행한다.
3. 모든 schema/table/constraint/index/trigger와 `_prisma_migrations` 마지막 row를 확인한다.
4. 합성 A/B/admin/moderator를 만들어 로그인, TODO, 게시, 복제, 채팅, 챌린지, 삭제 요청을 수행한다.

### 기존 데이터 upgrade

1. 바로 전 migration까지만 적용한 별도 DB에 합성 사용자를 넣는다. 특수문자·null·긴 필드·공동 챌린지·메시지·media key를 포함한다.
2. 적용 전 아래 값을 저장한다: 테이블별 행 수, PK 목록 hash, FK orphan count, User email/google unique, 대표 행 content digest.
3. expand migration을 적용한다. 기존 테이블에 DROP/재생성이 없는지 PostgreSQL log와 SQL로 확인한다.
4. `public.User`와 AccountIdentity/ServiceProfile의 행 수와 필드 checksum을 비교한다.
5. User update/insert 후 shadow trigger 일치, User delete 후 shadow cascade를 확인한다.
6. role 검증과 핵심 순환 E2E를 다시 수행한다.

게시 snapshot은 `20260908130000_post_snapshot_expand`로 nullable 필드와 DB 방어 trigger만 먼저 추가한다. 이어 `infra/database/backfill-post-snapshots.sql`을 별도 승인된 batch로 실행한다. 과거 게시 시점 값은 존재하지 않으므로 legacy 행은 backfill 시점 상태라는 제한을 표본 검증에 기록하며, 표현할 수 없는 행은 공개하지 않는 fail-closed 상태로 둔다. snapshot 완성도 검증 전 애플리케이션 cutover를 실행하지 않는다.

## 검증 SQL 항목

- `pg_namespace`, `pg_class`, `pg_constraint`, `pg_indexes`, `pg_trigger`, `pg_type`, `information_schema.sequences` inventory.
- 각 FK에 대해 child key가 parent 없이 존재하는 row 수 0.
- 기존 table별 count와 PK checksum 전후 동일.
- AccountIdentity `userId,email,passwordHash,googleId,birthDate,emailVerifiedAt`과 User 일치.
- ServiceProfile `userId,nickname,handle,bio,timezone`과 User 일치.
- purpose/consent/retention/release row 수 0, collection/export default OFF.
- runtime capability role에 superuser/createdb/createrole/bypassrls 없음.

## 잠금과 실패

expand의 schema/table/index 생성과 initial shadow backfill은 User 규모에 따라 lock/I/O를 사용한다. 운영 실행 전 `EXPLAIN`, 행 수, 예상 backfill 시간과 statement/lock timeout을 정한다. trigger 생성 직전/직후 쓰기 경합과 unique 충돌을 합성 부하로 확인한다.

Prisma migration 실패 시 `_prisma_migrations`를 수동 변조하지 않는다. transaction에서 rollback된 경우 원인을 수정한 새 migration을 만든다. 부분 적용 가능한 DDL이 있다면 실제 catalog와 migration history를 비교해 Prisma의 공식 resolve 절차를 별도 검토한다.

## rollback 경계

- 앱: expand table을 읽지 않는 이전 이미지로 rollback 가능.
- expand schema: 기존 데이터에 영향이 없더라도 자동 DROP 금지. 새 governance 증빙이 생겼다면 삭제는 파괴적이다.
- shadow trigger: 장애 시 승인된 migration으로 trigger만 비활성화하고 drift를 기록한 뒤 재동기화한다.
- contract(기존 컬럼 제거/테이블 이동): rollback 불가능 단계로 취급한다. 별도 backup restore 또는 전진 수정 계획 없이는 실행하지 않는다.

## 운영 보류 사항

Prisma 6.13+ multiSchema 호환, 실제 runtime LOGIN 비밀 배포, maintenance/API DB 자격 증명 분리, lock 시간, backup 위치·보유기간, 복원 삭제 재적용 방식이 승인되지 않았다. 따라서 원격 DB에는 이번 migration과 roles.sql을 적용하지 않는다.
