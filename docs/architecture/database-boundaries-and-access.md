# 데이터베이스 경계와 접근 제어 ADR

상태: expand 단계 구현, 운영 적용 승인 대기. 결정일 2026-09-08.

## 결정

PostgreSQL의 PK/FK/UNIQUE/CHECK를 유지하고 `identity`, `service`, `governance`, `security_audit`, `analytics_restricted`, `analytics_release` 스키마를 목적 경계로 사용한다. 스키마 이름만으로 격리됐다고 보지 않고 NOLOGIN capability role, 명시적 GRANT, 안전한 search path, 실제 거부 테스트를 함께 적용한다.

현재 Prisma 6.12.0은 multiSchema가 preview이며 6.13.0부터 GA다. 이번 변경은 패키지 버전을 올리거나 기존 모델에 `@@schema`를 일괄 추가하지 않는다. 먼저 raw SQL expand migration으로 새 경계와 shadow 테이블을 만들고 기존 `public.User`와 서비스 테이블을 그대로 유지한다. Prisma가 기존 테이블을 drop/create로 오판할 수 있는 이동 단계는 6.13 호환성 검증과 격리 복원 후 별도 migration으로 수행한다.

## 현재/목표 배치

| 영역 | expand 단계 | 목표 contract 단계 |
| --- | --- | --- |
| `public.User` | 기존 API의 authoritative 행. 제거/이동 없음 | 인증 필드는 AccountIdentity, 프로필 필드는 ServiceProfile로 전환 후 호환 view 또는 앱 contract 제거 |
| `identity` | AccountIdentity shadow, PurposeSubjectMap | 인증 전용 연결과 재연결 비밀. auth/erasure만 접근 |
| `service` | ServiceProfile shadow | 기존 TODO·피드·대화·챌린지 모델을 데이터 보존형 `ALTER TABLE SET SCHEMA`로 이동 |
| `governance` | 목적·정책·동의·파기·반출 검토 레지스트리 | 동일. 승인 workflow와 제한 역할만 변경 |
| `security_audit` | 새 최소 SecurityAuditEvent | AdminAuditLog 이동/통합은 보유정책 확정 후 |
| `analytics_restricted` | event/job/monthly/review 기반, 수집 OFF | 승인 목적별 최소 수집과 월 집계 |
| `analytics_release` | release/metric 기반, 반출 OFF | 승인된 익명 결과만 제공하는 view/API |

Post snapshot 필드는 Prisma 6.12 단일-schema cutover 제약 때문에 현재 `public.Post`에 nullable expand로 추가한다. 이는 영구적인 경계 결정이 아니라 서비스 데이터 전환 단계이며 identity·analytics 역할에는 snapshot 원문 권한을 부여하지 않는다.

AccountIdentity와 ServiceProfile은 기존 ID를 PK/FK로 유지한다. expand migration은 기존 User를 backfill하고 User 변경 trigger로 shadow를 동기화한다. 이 중복은 전환 기간에만 허용하며 contract 전까지 앱 DB 계정이 migration owner와 동일하면 완전한 격리가 아니다.

## FK와 삭제 의미

- 인증 shadow, 프로필, 세션, 목적별 매핑, 개인별 분석 event는 User 삭제에 cascade한다.
- 공동 챌린지 작성자와 AdminAuditLog actor는 기존 migration대로 SetNull이다. 본문에 남는 식별정보는 별도 정책 대상이다.
- ErasureRequest와 ObjectDeletionTask의 subject FK는 SetNull로 최소 증빙/재시도를 유지한다. object key와 증빙 자체의 후속 보유기간은 정책 대기다.
- release 결과에는 User/PurposeSubjectMap/AnalyticsEvent로 돌아가는 FK나 안정적 개인 키가 없다.
- 모든 기존 관계를 일괄 cascade 또는 FK 제거하지 않는다.

## 역할 행렬

`infra/database/roles.sql`은 비로그인 capability role만 만든다. 실제 LOGIN role과 비밀번호/IAM 연계는 승인된 배포 시스템에서 만든다.

| 역할 | 허용 | 명시적 거부/비허용 |
| --- | --- | --- |
| DB owner/migrator | migration, schema ownership | API 상시 연결 금지 |
| `mungsil_auth` | AccountIdentity SELECT/INSERT/UPDATE | restricted/release, 임의 DDL, 서비스 원문 |
| `mungsil_service` | service schema CRUD | AccountIdentity, purpose mapping, restricted/release |
| `mungsil_erasure` | Erasure/Object task 갱신, subject map/event 삭제 | 임의 분석, release, 역할/DDL |
| `mungsil_analytics_ingest` | 승인 registry 읽기, map/event/job/monthly 처리 | AccountIdentity, 서비스 원문 전체 덤프, release |
| `mungsil_analytics_reader` | MonthlyAggregate/AggregateReview SELECT | row-level event, subject map, identity |
| `mungsil_release_reader` | DatasetRelease/AggregateMetric SELECT | 운영/restricted/identity join |
| `mungsil_audit_writer` | SecurityAuditEvent INSERT | 감사 읽기/수정/삭제 |

모든 runtime capability role은 NOSUPERUSER/NOCREATEDB/NOCREATEROLE/NOBYPASSRLS다. `public` CREATE와 보호 스키마의 PUBLIC 권한을 회수한다. 역할 등급은 상속 관계가 아니며 운영자도 모든 L1/L2를 자동 열람하지 않는다.

## 실제 연결 검증

격리 합성 DB에 migration을 적용한 뒤 owner로 `roles.sql`, `verify-role-boundaries.sql`을 순서대로 실행한다. 검증 SQL은 각 역할로 `SET ROLE`해 허용 SELECT/INSERT를 수행하고 identity, mapping, row-level analytics, public User에 대한 대표 forbidden query가 `insufficient_privilege`인지 확인한다. CI에 두 스크립트를 연결했다.

이번 로컬 호스트는 Docker Linux 엔진이 실행 중이지 않아 실제 role 연결 검증은 아직 미실행이다. 정적 SQL 존재나 Prisma build만으로 권한 분리 완료로 표시하지 않는다.

## 다음 단계와 rollback

1. 빈 합성 DB 전체 migration과 기존 합성 DB upgrade를 수행한다.
2. shadow 행 수, PK, email/google unique, null 허용, 대표 해시 내용의 checksum을 비교한다.
3. 별도 auth/service LOGIN 계정을 만들고 repository/client 경계를 전환한다.
4. dual-write 오류와 drift를 0으로 확인한 뒤 읽기 전환한다.
5. 기존 열 제거·테이블 이동은 별도 contract 승인, 암호화 백업, 쓰기 중단/rollback 계획 뒤 수행한다.

expand migration은 기존 테이블을 drop/alter하지 않으므로 앱 rollback은 이전 이미지로 가능하다. 새 shadow와 registry 제거는 데이터·감사 손실 가능성이 있으므로 자동 rollback하지 않고 전진 수정한다.
