# 데이터 파기와 집계 반출 런북

상태: 파기 outbox 기반 구현, 분석 수집/반출 OFF. 실제 사용자 파기·외부 제공은 별도 승인 전 금지.

## 계정 탈퇴

1. API transaction에서 `deletionRequestedAt` 설정, 활성 Session 폐기, ErasureRequest와 `SERVICE_DATABASE/OBJECT_STORAGE/ANALYTICS_RESTRICTED` task를 생성한다.
2. transaction 성공 후 사용자 socket을 회수한다. 이후 Guard와 공개 query는 삭제 요청 계정을 거부한다.
3. 일률적인 복구 유예는 적용하지 않는다. `executeAfter=requestedAt`으로 기록하고 API 응답 직후 파기 worker를 시작하며, 1분 worker가 장애·재시작 시 재개한다.
4. maintenance는 유예 종료 요청을 PROCESSING으로 claim한다. 분석 job 성공 여부는 보지 않는다.
5. pending 원본 삭제 task와 Media 원본/full/thumb/version을 삭제·검증한다.
6. 한 DB transaction에서 User를 삭제하고 FK cascade/SetNull을 적용한 뒤 ErasureTask/Request를 완료한다.
7. 실패하면 최소 오류 코드만 기록하고 FAILED로 돌려 다음 실행에서 재시도한다. 원문/키는 삭제 확인 전에 추적에서 제거하지 않는다.

현재 User 삭제로 개인 TODO/게시 snapshot/세션/대화 멤버십/개인별 analytics map/event가 cascade된다. Challenge creator와 AdminAuditLog admin은 SetNull이다. 메시지 sender 등 공동 기록의 본문 개인정보와 신고 증거 보존은 정책 미확정이므로 운영 파기 승인 전에 관계별 SQL 결과를 다시 검토한다. 미확정 상태는 무기한 보유 권한이 아니며, 승인된 `RetentionPolicy`가 없는 예외 task를 `EXEMPT`로 만들지 않는다.

## 다른 수명 이벤트

- soft delete: 화면/일반 조회에서 숨기며 복구 가능. 실제 파기가 아니다. 삭제 TODO는 공개 그룹 조회·복제에서 제외한다.
- consent withdrawal: 해당 purpose 신규 수집을 즉시 막고 목적별 map/event 삭제 task를 만든다. 이 자동화는 consent 정책 승인 전 미활성이다.
- retention expiry: 승인된 RetentionPolicy가 있는 classification만 실행한다. 미확정 기간을 code default로 만들지 않는다.
- legal/dispute hold: 기본 OFF. 사건/근거/승인자/대상/만료·재검토일/접근 역할이 모두 있어야 EXEMPT 처리 가능하다.

## 백업 복원 후 재삭제

운영에 직접 복원하지 않는다. 격리 network의 새 DB/S3에 복원하고 migration 상태를 확인한다. 삭제 재적용 자료의 최소 식별 방식과 보유기간은 정책 승인 대기다. 이 방식이 확정되기 전에는 복원 DB를 서비스·분석 트래픽에 연결하지 않는다. 재삭제가 끝난 뒤 합성 account와 FK/count를 확인하고, 실제 사용자 원문을 검증 로그에 출력하지 않는다.

## 분석 release

1. ProcessingPurpose, 법적 근거/동의, PolicyVersion, allowed fields, RetentionPolicy가 승인돼야 collection을 검토할 수 있다.
2. 월말 AggregateReview에서 고유 참여자, 기여 상한, 작은 집단, 희귀 조합, 연령/카테고리 일반화, 이전 버전과 차분 위험을 확인한다.
3. 승인 행만 새 DatasetRelease version에 복사한다. release에는 userId, subject key, eventId, 이메일 hash, 원문/URL/정확 시각이 없어야 한다.
4. 목적·수신자·계약·보안·국외 이전·ReleaseReview 승인 후에만 export를 실행한다.
5. ExportAudit에는 actor, recipient, 목적, version, row count, checksum만 남기고 데이터 원문을 남기지 않는다.
6. `ANALYTICS_EXPORT_ENABLED` 기본 false이며 현재 export endpoint/외부 전송 구현은 없다.

## 중지 조건

객체 version 잔존, DB orphan, role 우회, 미승인 purpose/consent, 작은 집단 억제 실패, 여러 release 차분 위험, backup 재삭제 미완료, 법률/계약 승인 누락 중 하나라도 있으면 파기 완료 또는 외부 제공 승인으로 기록하지 않는다.

## 실제 실행 승인 체크

- [ ] 운영 대상과 실행자 확인
- [ ] 보유기간/유예/공동 기록/예외 보존 정책 승인
- [ ] 격리 restore와 삭제 재적용 성공
- [ ] DB role 및 S3 IAM 실제 거부 테스트 성공
- [ ] MinIO와 AWS 고유 versioning/lock/replication 구분 검증
- [ ] 법률 검토와 사용자 고지/동의 version 승인
- [ ] 수신자·계약·국외 이전·release 위험 검토 승인
