# Android V1 · API·상태·호환 계약

문서 ID: AND-V1-CON-001 · v0.1 · 2026-10-23 (Asia/Seoul)

설계 조사 기준: `887fdef`. **기준 소스 확인**과 **추가 설계안**을 구분한다. 아래 개선 후보 중 완료·취소 정규화와 예약 조회는 후속 M-01에서 구현했으며 [구현 보고서](implementation-m01.md)를 참고한다. API 추가·서버 정책 변경은 하지 않았다.

## 1. 현행 계약 확인

모든 경로의 prefix는 `/api/v1`이다. 아래 정보는 코드 정적 조사이며 이번에 실제 DB·HTTP 동작을 재검증한 결과가 아니다.

| 행동 | 현행 HTTP·응답 | 권한·의미 | Android 반영 |
| --- | --- | --- | --- |
| 예정일 목록 | `GET /todos?from=<ISO>&to=<ISO>` → `TodoDto[]` | 본인, deletedAt=null, dueDate 범위. 시작/끝 포함. 최대 366일의 시간 범위. 고정 take 없음 | 계정 현지 날짜 시작부터 다음 날 시작-1ms까지. 완료일 조회가 아님 |
| 생성 | `POST /todos` → 저장된 TODO | 로그인, 제목·일정·카테고리·반복·그룹 소유 확인 | 성공 응답으로 ID·일정·상태 정규화 |
| 편집 | `PATCH /todos/:id` → 저장 결과 | ownTodo, 반복 범위 THIS/FUTURE, 소속 권한 | 관계 미확인 필드는 보내지 않아 기존 값 유지. 명시 해제와 미확인을 구분 |
| 완료 | `POST /todos/:id/complete` → `{todo, post, sharePrompt}` | 소유 확인, 미완료→완료를 트랜잭션 처리, 서버 완료 시각 | `share:false`; `todo`를 파싱해 서버 시각·값 반영 |
| 완료 취소 | `POST /todos/:id/uncomplete` → TODO | 소유 확인. 활성 게시 연결이 있으면 400 | 낙관적 변경 후 거부 시 원상복구·서버 사유 표시 |
| 카테고리 | `GET /me/todo-categories` | 본인 분류 | 실패 시 원본 categoryId 보존·재시도 |
| 그룹 | `GET /todo-lists` | 본인 그룹 | 실패 시 미소속으로 간주하지 않음 |
| 프로필 통계 | `GET /me` → profile/stats | completedCount는 전체 미삭제·완료 항목 수 | 기간별 실제 완료 기록 API를 대신할 수 없음 |

현행 TODO 목록의 순서는 `(completedAt asc, dueDate asc, id asc)`다. UI에서 ‘지금 할 일’을 선택할 때는 미완료 항목의 예정 시각·ID를 명시적으로 비교해 DB null 정렬의 묵시적 동작에 의존하지 않는다.

## 2. 작성·편집·재시도

| 계약 | 현행·설계 원칙 |
| --- | --- |
| 기본 필드 | title 1~120, notes 최대 500, category 기본 생활, dueDate 필수 ISO, visibility 기본 PRIVATE |
| 날짜 보존 | `TodoDraft.kt`는 날짜·분을 바꾸지 않았을 때 원본 dueDate 문자열을 유지한다. 초·밀리초를 잃는 재직렬화 금지 |
| 반복 보존 | 원본 repeatRule과 seriesId 의미 유지. 기존 복잡 규칙을 UI가 모른다는 이유로 null 전송 금지 |
| 그룹·분류 | `undefined` 성격의 미전송과 명시 `null` 해제를 구분. 조회 실패는 해제 요청의 근거가 아님 |
| 내용 고정 | 제출 직전 정규화한 body snapshot과 요청 키를 연결. 서버가 body JSON hash를 비교하므로 같은 키로 다른 body를 보내지 않음 |
| 요청 키 | 사용자+method/path+key 범위. 현행 서버는 정상 응답 24시간 재사용, 처리 중 중복은 409, 본문이 다르면 409 |
| 불확실한 결과 | timeout/5xx는 서버 반영 여부가 불명확. 서버는 미완료 키의 수명을 5분으로 조정할 수 있음. 무한 재전송·새 키 즉시 생성 금지 |
| 409 | ‘처리 중’은 결과 확인/일시 대기, ‘다른 내용’은 현재 입력과 기존 제출을 분리. 즉시 새 키로 자동 재시도하지 않음 |
| 성공 이후 | snapshot/키를 종료하고 새로운 행동에는 새 키. 캐시된 이전 응답이 다른 기기의 최신 상태까지 보증하지 않으므로 재조회 필요 |
| 사용자 전환 | 계정 세대 ID를 키 범위와 연결. 이전 계정의 응답·초안이 새 계정 상태로 흘러들지 않도록 차단 |

### 현행 Android의 개선 후보

| 코드 | 확인한 차이 | 구현 작업에서 바꿀 내용 |
| --- | --- | --- |
| `TodoRepository.complete` | 응답을 반환하지 않고 Unit으로 끝냄 | 완료 envelope의 todo / 취소의 직접 TODO를 명시적으로 구분·파싱 |
| `TodoModel.toggle` | 단말 Instant.now로 만든 낙관 항목을 성공 후 콜백에 전달 | 낙관 시각은 처리 중에만 사용, 서버 응답으로 canonical 행 교체 |
| `TodoModel.retryKeys` | 메모리 map이라 모델 재생성 뒤 보존 범위가 다름 | pending snapshot/키/작업 세대를 상태 소유자가 보존·결과 확인하도록 설계 |
| `TodoModel.load` | 쓰기 pending이면 재조회를 생략 | 쓰기 후 최신 재조회를 예약하고 응답 순서/날짜 전환을 시험 |
| `TodoForm.originalDraft` / dirty | 원본 list와 별도로 `chosenGroup != null`, scope 변경을 감지하므로 그룹 변경 감지가 이미 있음 | 현재 보호 동작 보존. 같은 그룹 재선택을 무조건 변경으로 보는 보수적 판정을 의미 비교로 개선할지 검토 |
| 기록 | 현행 프로필 완료 수와 dueDate 목록으로는 completedAt 기간 기록 제공 불가 | 별도 기록 계약 구현 후 UI 연결 |

이 표는 최초 `887fdef`의 정적 코드 차이 목록이다. 후속 M-01~03에서 완료 응답·조회/폼 처리를 구현했고 M-04에서 기록 API를 추가했다. 각 구현 보고서의 실제 실행 범위를 따르며 과거 차이를 현재 미구현 목록으로 취급하지 않는다.

## 3. 완료 기록 API 추가 설계안

M-04에서 아래 API를 구현했다. 개발 기본값 선택은 [E-001](../decision-log.md), 정확한 현재 요청·응답·오류는 [기록 API 계약](history-api.md), 실제 검증 범위는 [M-04 보고서](implementation-m04.md)를 따른다. 기본 정의는 ‘지금 완료 상태인 본인 항목을 실제 완료일로 조회’다. 전체 이벤트 감사 원장이나 파기한 기록의 재보유 기능을 추가하지 않는다. Android 기록 화면과 운영 배포는 아직 수행하지 않았다.

```text
GET /api/v1/todos/history
  ?fromDate=2026-10-17
  &toDate=2026-10-23
  &limit=20
  &cursor=<optional>
Authorization: <기존 자체 세션>
```

| 항목 | M-04 구현 계약 |
| --- | --- |
| 날짜 | 계정 timezone 기준 YYYY-MM-DD 양 끝 날짜 포함. fromDate ≤ toDate. 날짜 쌍 생략 시 첫 페이지는 오늘 포함 최근 7일. cursor 요청은 날짜 쌍 필수 |
| 서버 범위 | 서버가 계정 timezone으로 시작일 자정과 종료일 다음 날 자정을 계산해 `completedAt >= start AND completedAt < endExclusive` 적용 |
| 허용 기간 | 1~90개 현지 날짜. 역순·불가능한 날짜·범위 초과·잘못된 cursor/limit는 400 |
| 필터 | userId=인증 사용자, deletedAt=null, completedAt not null. 다른 계정 ID를 query로 받지 않음 |
| 정렬 | completedAt DESC, id DESC |
| 페이지 | 기본 limit 20, 최대 50. limit+1 조회로 nextCursor 계산, 안정 복합 커서. 서버가 서명·필드·범위·버전을 검사 |
| 커서 범위 | 사용자·기간·canonical timezone·limit·필터와 연결. 조건 변경 시 cursor/누적 목록 초기화. 다른 조건의 cursor 재사용 거부 |
| total | 커서 위치와 무관한 전체 조건의 완료 항목 수. 페이지 길이로 계산하지 않음. 계정 시간대/items/total을 같은 RepeatableRead transaction에서 산출. 다음 페이지까지 고정된 snapshot은 아님 |
| 변경 중 | 페이지 사이 완료 취소·삭제가 가능. 클라이언트 ID 중복 제거·재조회 제공. 과거 페이지가 완전 불변이라고 보장하지 않음 |
| 응답 | `{items: TodoHistoryItemDto[], nextCursor: string|null, total: number, timezone: string, fromDate: string, toDate: string}` |
| item | 기존 TodoDto의 필요한 필드 재사용, completedAt은 필수 string. title, dueDate, visibility, category/관계 등 기존 이름을 중복 정의하지 않음 |
| 오류 | 기존 401/403·세션 오류 체계 유지. 다른 사람의 항목 존재나 메모가 오류에 노출되지 않음 |
| 인덱스 | 합성 6천 행의 목록·count 계획에서 기존 userId/dueDate 인덱스 사용 확인. 운영 규모의 completedAt 인덱스 필요성은 후속 성능 검토. 이번 schema/migration 변경 없음 |
| 호환 | GET /todos의 예정일 의미·응답을 바꾸지 않는 추가 endpoint. 정적 `history` 경로를 동적 `:id` 경로보다 먼저 검토·등록 |

예시: Asia/Seoul의 `2026-10-23` 하루는 UTC `2026-10-22T15:00:00Z ≤ completedAt < 2026-10-23T15:00:00Z`. DST 지역도 단순 24시간 덧셈 대신 local date의 자정을 사용한다.

## 4. 앱 상태와 갱신 순서

### 조회 상태

```text
Loading(no data) → Ready(rows) / Empty / Error(no data)
Ready(rows) → Refreshing(rows) → Ready(new rows) / RefreshError(old rows)
계정·날짜·시간대 변경 → queryGeneration 증가 → 새 조건 조회
이전 generation의 응답 → 화면 반영하지 않음
```

### 쓰기 상태

```text
Idle → Validating → Submitting(snapshot, key, account, operationGeneration)
Submitting → Confirmed(serverTodo) → 새로고침 예약 → Idle
Submitting → Rejected → 원상복구·입력/재시도 키 보존
Submitting → OutcomeUnknown → 동일 요청/조회로 결과 확인
```

| 데이터 소유자 | 저장 범위 | 초기화·주의 |
| --- | --- | --- |
| 조회 모델 | 조건+generation, rows/loading/error | 계정 변경 시 즉시 과거 데이터 제거. 화면 회전으로 불필요한 중복 요청 방지 |
| 폼 상태 | 필드·원본 기준·dirty·선택 관계 | UI의 로컬 시트 상태만으로 전체 복원 완료 판정하지 않음 |
| 제출 상태 | 정규화 snapshot·key·action·대상 ID·generation | 실패 재시도와 수정 후 새 제출을 구분. 이전 성공으로 새 입력을 지우지 않음 |
| 완료 처리 | 원본 행·낙관 행·서버 행 | 서버 확정 전 진행 합계를 확정값처럼 표시하지 않음 |
| 기록 모델 | 기간·timezone·cursor·rows·total | 조건 바꾸면 cursor 폐기, 늦은 페이지 무시, 첫 조회 실패와 더 보기 실패 분리 |

복원 데이터는 Bundle/SavedStateHandle의 용량·민감정보 범위를 검토한다. 필요 시 보관 대상 필드만 계정별 로컬 저장으로 분리하고 로그아웃 때 정리한다. 프로세스 종료 뒤 HTTP 성공 여부는 상태 복원만으로 알 수 없으므로 서버 확인이 필요하다.

## 5. 서버 의미를 보존하는 경계

- 완료와 게시는 다른 상태다. 게시 연결이 있으면 완료 취소가 거부되는 현재 정책을 클라이언트가 우회하지 않는다.
- 삭제·탈퇴·공개 철회·미디어 파기는 기존 governance 흐름을 유지한다. 새 기록 화면이 삭제된 메모·사진을 되살리지 않는다.
- 반복 발생 단위와 시리즈 전체 변경을 구분한다. 이번만/이후 의미와 그룹 한 곳 소속을 보존한다.
- API 추가 시 runtime·migrator·backup 역할과 기존 웹 계약을 유지한다. 필요한 DB 변경은 별도 검토·migration으로 수행한다.
