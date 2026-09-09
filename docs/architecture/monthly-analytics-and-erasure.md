# 월별 분석과 탈퇴 파기 분리 계약

상태: 기반/합성 함수 구현, 실제 수집·backfill·반출 OFF. 목적·법적 근거·동의·최소 집단 기준 승인 대기.

## 게이트

분석 경로는 환경변수 `ANALYTICS_COLLECTION_ENABLED=false`, `ANALYTICS_EXPORT_ENABLED=false`가 기본이다. 환경값만 true로 바꿔서는 충분하지 않다. ProcessingPurpose가 APPROVED이고 승인자·시각·PolicyVersion·필드 allowlist가 있어야 하며, 동의가 근거라면 해당 사용자/버전의 철회되지 않은 ConsentRecord가 필요하다. migration은 목적/동의/보유 승인 레코드를 만들지 않는다.

허용 후보 필드는 `eventType, occurredMonth, broadCategory, countValue, completedValue, eligibleValue, ageBand`뿐이다. 이메일, ID, 핸들, 생년월일, IP/기기, URL, TODO/메모/채팅/신고 원문, 정확 시각, 사용자 정의 카테고리는 수집 allowlist 밖이다.

## 시간과 연령

- 월은 Asia/Seoul `[월 1일 00:00, 다음 달 1일 00:00)`이다. 저장 event timestamp와 사용자가 의도한 현지 날짜는 별도 의미이며 섞지 않는다.
- `seoulMonthStart`는 연도/월 경계를 서울 시간으로 계산한다.
- 연령 지표가 승인된 경우에만 활동 당시 만 나이를 10년 구간(`20s`, `30s` 등)으로 만든다. 계산 불가/비정상은 `UNKNOWN`이다.
- 현재 나이를 과거 활동에 소급하지 않는다. 한 사람이 월중 생일로 구간이 바뀌면 지표별로 활동 당시 구간을 쓰되, 월 고유 사용자 총합에는 중복 가능성을 품질 메타데이터로 표시하거나 연령 차원을 제거한다.

## 초기 지표 정의 후보

| 지표 | 분자 | 분모 | 고유 주체 | 기여 상한 | 비고 |
| --- | --- | --- | --- | --- | --- |
| `todo_created_count` | 생성 TODO 수 | 없음 | 월중 생성한 subject | 정책 승인값 | 넓은 표준 카테고리만 |
| `todo_completion_rate` | 월중 완료 처리된 eligible TODO 수 | 월중 완료 가능 상태 TODO 수 | 월중 eligible subject | 정책 승인값 | 취소/재완료는 최종 상태 또는 event version 규칙 필요 |
| `challenge_join_count` | 참여 수 | 없음 | 월중 참여 subject | 목적별 1 또는 승인값 | 챌린지/사용자 ID 없음 |
| `challenge_completion_rate` | 기준을 충족한 참여 수 | 종료·평가 가능한 참여 수 | 참여 subject | 챌린지당 1 | 작은 챌린지 병합/억제 |
| `routine_retention_rate` | 승인된 N주차까지 유지한 routine 수 | 해당 cohort routine 수 | routine owner | 정책 승인값 | N과 중단 정의 승인 필요 |

숫자는 후보이며 수집 승인이 아니다. `contributionCap`은 각 결과에 기록한다. 최소 고유 참여자 수는 현재 미확정이며 10~30명 베타에서는 연령/카테고리 차원을 제거하거나 전부 restricted로 남길 수 있다.

## 일별 누적과 월말 검토

1. 승인 purpose와 consent/근거를 확인한다.
2. 멱등 키로 허용 필드만 AnalyticsEvent에 적재한다. 중복/늦은 재시도는 unique `(purpose,idempotencyKey)`로 차단한다.
3. AggregationJob unique `(purpose, period, metric, processingVersion)`으로 동시 실행을 잠근다.
4. 일별 실행은 MonthlyAggregate를 갱신하지만 `UNREVIEWED/PROVISIONAL`로 유지한다. 이 테이블은 개인정보 수준의 restricted 영역이다.
5. 월말에는 완료 취소·수정·늦은 event cutoff, unique subject, 기여 상한, 작은 집단, 희귀 조합, 여러 release 버전 차분 위험을 검토한다.
6. 승인된 행만 DatasetRelease/AggregateMetric으로 복사한다. 자동 job 성공이나 월말 도달은 익명 승인 조건이 아니다.
7. 실제 다운로드/API 제공은 별도 ReleaseReview와 외부 제공 승인 뒤에만 가능하다. 현재 export 코드/endpoint는 없다.

## 탈퇴와의 독립성

탈퇴 요청은 세션·소켓과 신규 분석 수집을 즉시 차단하고 ErasureRequest/Task를 같은 DB transaction에 만든다. 2026-09-08 승인에 따라 일률적인 복구 유예는 없으며 `executeAfter=requestedAt`으로 파기 worker를 즉시 시작한다. 1분 재개 worker 역시 analytics job·월말 집계 상태를 조회하거나 기다리지 않는다.

파기 순서는 pending object task와 Media의 원본·파생·version 삭제 확인 → User 삭제와 개인별 PurposeSubjectMap/AnalyticsEvent cascade → ErasureTask/Request 완료를 한 transaction에서 기록하는 방식이다. 객체 실패는 DB 사용자 삭제를 막고 오류 코드와 재시도를 남긴다. 집계 실패 때문에 원문을 별도 복사하지 않는다.

## 경합/재유입 규칙

- 요청 직후 `deletionRequestedAt`로 모든 인증·공개 조회·분석 intake를 거부한다.
- 분석 collector가 추가될 경우 `assertAnalyticsSubjectCollectable`을 반드시 통과해야 하며, 현재는 collection OFF이고 caller/endpoint가 없다.
- 집계가 event를 읽는 동안 map/User가 삭제되면 FK cascade와 transaction retry로 개인행이 남지 않아야 한다.
- 지연 event와 backfill은 active subject/purpose/consent를 다시 확인한다. 영구 사용자 해시 블랙리스트는 만들지 않는다.
- 백업 복원 후에는 서비스와 분석을 열기 전에 삭제 재적용 목록을 적용해야 한다. 이 목록의 최소 필드·보유기간은 정책 대기다.
- 삭제 때문에 정확한 재계산이 불가능하면 `qualityStatus`를 `INCOMPLETE_AFTER_ERASURE` 같은 명시 상태로 남기고 원문을 몰래 보관하지 않는다.

## 2026-09-08 합성 사례

합성 사용자 A가 9월 8일 탈퇴한다. 이미 승인·확정된 9월 익명 집계는 재식별 검토 결과에 따라 유지할 수 있다. A의 PurposeSubjectMap, AnalyticsEvent, 계정, TODO/채팅/사진 및 미완료 object task는 월말과 무관하게 유예 종료 후 파기한다. 분석 서버가 중단돼도 파기 큐는 독립 실행한다. 미집계분 손실은 품질 상태로 표시하며 A 원문을 보존하지 않는다.

필수 합성 검증은 서울 월/연도 경계, 생일 전후 age band, UNKNOWN, 중복 event, 완료 취소, late event, 동시 job, 탈퇴/집계 경합, 분석 장애 중 파기, 작은 집단 억제, release 버전 차분이다. 현재 순수 함수/기본 OFF/allowlist 테스트는 구현됐고 실제 PostgreSQL 동시성 검증은 Docker 엔진 대기 상태다.
