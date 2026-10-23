# 완료 기록 API · 개발 계약 v1

2026-10-23 UTC · M-04 구현, 운영 배포 전. [개발 기본값 E-001](../decision-log.md) · [실행 결과](implementation-m04.md)

## 1. 의미와 권한

`GET /api/v1/todos/history`는 현재 완료 상태인 본인의 미삭제 TODO를 **실제 완료 시각**으로 조회한다. 미완료·삭제된 TODO는 제외하고 PRIVATE/FOLLOWERS/PUBLIC 모두 본인에게 반환한다. 완료 취소하면 제외되고, 다시 완료하면 현재의 새 completedAt에 속한다. 수정한 제목·메모·공개 범위를 현재 값으로 반환한다. 다른 사람의 메모·인증·미디어를 조회하거나 삭제 원문을 별도 보관하지 않는다.

기존 JwtAuthGuard로 유효한 세션·정지/탈퇴 요청 상태를 검사하고 읽기 transaction에서도 활성 사용자와 계정 시간대를 확인한다. userId와 timezone query를 받지 않는다. 기존 `GET /todos?from&to`는 예정일 조회와 끝 포함 의미를 유지한다.

## 2. 요청과 응답

| Query | 계약 |
| --- | --- |
| fromDate / toDate | `YYYY-MM-DD`의 실제 달력 날짜. 계정 시간대의 양 끝 날짜 포함, 1~90일. 첫 페이지에서 둘 다 생략하면 계정 오늘 포함 최근 7일. 하나만 전달하면 400 |
| limit | 정수 1~50, 기본 20 |
| cursor | 최대 2048자, 서버가 반환한 서명 커서. 후속 페이지에서는 응답의 fromDate/toDate와 동일 limit을 명시 |
| 그 외 | DTO의 미지원 query는 400. 타인 ID·기기 시간대로 범위를 바꾸지 않음 |

예시:

```text
GET /api/v1/todos/history?fromDate=2026-10-17&toDate=2026-10-23&limit=20
```

```json
{
  "items": [{
    "id": "synthetic-todo",
    "title": "작은 산책",
    "notes": null,
    "category": "건강",
    "categoryId": null,
    "categoryRef": null,
    "dueDate": "2026-10-21T03:00:00.000Z",
    "completedAt": "2026-10-23T03:00:30.123Z",
    "visibility": "PRIVATE",
    "repeatRule": null,
    "seriesId": null,
    "sourceTodoId": null,
    "occurrenceKey": null
  }],
  "nextCursor": null,
  "total": 1,
  "timezone": "Asia/Seoul",
  "fromDate": "2026-10-17",
  "toDate": "2026-10-23"
}
```

공용 타입은 `packages/contracts/src/index.ts`의 `TodoHistoryItemDto`·`TodoHistoryPageDto`다. item은 기존 TodoDto를 확장하고 completedAt을 필수 문자열로 좁힌다. categoryRef가 있으면 숨김 상태·이름·아이콘 등을 보존하며 내부 소유자/생성 시각은 반환하지 않는다. 예시는 합성 자료다.

## 3. 날짜·페이지 일관성

| 항목 | 규칙 |
| --- | --- |
| UTC 범위 | 계정 시작일의 첫 자정 이상, 종료일 다음 날의 첫 자정 미만. 자정이 없는 날은 첫 가능한 시각, 반복 자정은 첫 발생을 사용. 통째로 생략된 현지 날짜 한 날은 빈 구간 |
| DST | 현지 달력의 다음 날짜를 사용. 24시간 덧셈으로 끝을 계산하지 않음 |
| 정렬 | completedAt DESC, id DESC |
| 후속 페이지 | `completedAt < anchorAt OR (completedAt = anchorAt AND id < anchorId)`, limit+1 조회. 기준 행이 삭제/취소돼도 커서 위치는 사용 가능 |
| total | cursor 위치와 무관한 기간 전체 조건의 수. 페이지 길이와 구분 |
| 같은 응답 | 사용자 시간대·목록·total을 RepeatableRead transaction의 같은 읽기 snapshot에서 조회 |
| 페이지 사이 | 새 완료·취소·삭제·수정·공개 변경을 다음 요청에서 반영. total도 바뀔 수 있음. 앞 페이지 전체가 고정되거나 자동 정정되는 계약은 아님 |
| 클라이언트 | 기간·timezone·limit·계정 변경 시 누적 목록/커서 초기화. 같은 ID 중복 제거, 완료/취소·삭제 뒤 첫 페이지 재조회. 날짜가 바뀌어도 후속 요청은 반환받은 날짜 쌍 유지 |

예: 서울 2026-10-23의 범위는 `2026-10-22T15:00:00Z ≤ completedAt < 2026-10-23T15:00:00Z`. 어제 예정·오늘 완료 항목은 포함하고 오늘 예정·어제 완료 항목은 제외한다.

## 4. 커서와 오류

커서는 완료 시각·ID·버전·조건 해시를 포함하며 사용자·날짜 쌍·canonical timezone·limit·필터 버전에 연결한다. JWT_ACCESS_SECRET에서 목적별 키를 파생해 HMAC-SHA256으로 서명한다. 인증값·제목·메모를 담거나 별도 서버 보유 테이블을 만들지 않는다. 로그에 커서를 남기지 않는다. 키 회전은 이전 커서를 무효화한다.

| 응답 | 클라이언트 처리 |
| --- | --- |
| 200, items=[] / total=0 | 확인된 빈 기록 표시 |
| 400, `code=TODO_HISTORY_CURSOR_INVALID` | 위변조·다른 계정/기간/시간대/limit·구버전·잘못된 위치. 누적 조회를 초기화하고 첫 페이지 재조회 |
| 그 밖의 400 | 날짜 쌍·실제 달력·90일·limit·미지원 query 확인. 입력을 수정한 뒤 조회 |
| 401 | 만료/철회 세션·정지/탈퇴 요청/비활성 사용자. 기존 인증 흐름 적용, 이전 계정 자료 숨김 |
| 503 | 저장된 계정 시간대 또는 서명 설정 확인 실패. 임의 timezone/공개 기본키로 대체하지 않음 |
| 연결/서버 오류 | 기존 자료가 있으면 마지막 자료와 재시도 제공. 빈 기록으로 바꾸지 않음 |

## 5. 구현 범위

새 endpoint·DTO·전용 서비스·기록 조회만 추가한다. schema/migration·게시·완료/취소·포인트·파기 정책을 변경하지 않는다. 서명 키는 기존 서버 설정을 사용하고 새 비밀값을 코드/Git에 저장하지 않는다. 현재 API 코드와 실제 PostgreSQL 검증이 존재하며 Android 화면은 M-05 후속이다.
