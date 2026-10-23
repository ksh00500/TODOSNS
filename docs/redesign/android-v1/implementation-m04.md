# M-04 · 실제 완료일 기록 API

2026-10-23 UTC · 구현 및 현재 Codex 검증

대상: `codex/beta-core@ed0ac419047d83aa979dc4bc892cf9a4c2876a2f`에 이번 API·공용 계약·시험·문서 변경을 더한 작업 트리. [API 계약](history-api.md) · [개발 기본값 E-001](../decision-log.md)

## 1. 결과

| 변경 | 동작 |
| --- | --- |
| GET /todos/history | 현재 완료 상태인 본인·미삭제 TODO를 completedAt으로 조회. 기존 예정일 API 의미·응답 유지 |
| 날짜·시간대 | 첫 페이지 기본 최근7일, 명시 기간1~90일, 계정 timezone. 현지 다음 날 자정 미만으로 DST·없는/반복 자정 처리 |
| 페이지·total | 기본20/최대50, 완료 시각/ID 역순 커서, 기간 전체 total. 같은 응답의 계정/목록/total은 RepeatableRead 읽기 |
| 권한·개인정보 | 기존 실제 세션 guard와 transaction 내 활성 계정 검사. 타인 ID·기기 timezone 입력 불가, 삭제/취소 원문 재보유 없음 |
| 커서 | HMAC 서명과 계정·기간·timezone·limit·필터 버전 검증. 키 회전/잘못된 조건은 첫 페이지 재조회 |
| 공용 계약 | TodoHistoryItemDto/ TodoHistoryPageDto 추가, 기존 TodoDto 필드·categoryRef 재사용 |

기본 수치는 기존 초안의 개발 기본값으로 채택했다. 사용자에게 별도 확정 발언이 있었다고 기록하지 않는다. 운영 배포와 Android 기록 UI는 수행하지 않았다.

## 2. 실행 결과

| 검사 | 실제 결과 |
| --- | --- |
| 신규 기록 회귀 | `node --test apps/api/tests/todo-history.behavior.test.cjs apps/api/tests/todo-history.database.test.cjs`: 9 통과 / 0 실패 / 0 skip |
| 최종 API 회귀 | DB 전용 URL을 전달한 root `npm test`: API 138개 중 134 통과 / 4 조건부 skip / 0 실패. 신규 실제 DB 시험 포함 |
| Web 회귀 | 같은 명령의 Web: 53 통과 / 0 skip / 0 실패 |
| root lint | `npm run lint`: Web/API 통과 |
| 전체 build | `npm run build`: contracts → API → Web 통과 |
| 카테고리 관계 보강 | 실제 DB 시험에 포함. 숨긴 분류의 이름·archivedAt 직렬화와 내부 소유자 필드 제외 확인 |
| 문서·변경 | 상대 링크와 `git diff --check` 통과 |

앱/웹 화면 코드를 변경하지 않아 Android 빌드·unit·connected UI는 이번에 재실행하지 않았다. M-03의 Android98 결과는 해당 커밋의 이력이다. 기존 DB E2E3·스토리지1의 조건부 skip은 신규 기록 DB 성공과 구분한다.

## 3. 실제 PostgreSQL/HTTP 증거

공식 캐시 이미지 `postgres:17-alpine`, digest `sha256:eee6c6e1b0894fa4fe0075eb054af9fd1cf39a35321c2d4110626cfe506411fb`로 새 `todosns-m04-pg` 컨테이너를 만들었다. 기존 컨테이너·볼륨·운영 DB를 사용하지 않았다. tmpfs DB `todosns_m04`, loopback의 임시 포트, 합성 사용자·세션만 사용하고 저장소의 기존 migration15개를 적용했다. 새 schema/migration 소스는 만들지 않았다.

| 실제 검사 | 확인한 사실 |
| --- | --- |
| 예정일과 완료일 | 과거 예정·조회일 완료 포함, 조회일 예정·전날 완료 제외, 시작 경계 포함/끝 경계 제외 |
| 동일 시각55개 | 다른 경계2개를 더한57개를 20개 단위로 모두 조회, 순서 일치·중복0·total57 |
| 삭제·취소·공개 변경 | 앞 페이지 기준 행 취소·뒷 페이지 항목 삭제 뒤에도 커서 진행, 제외·total 감소, 본인 공개 범위 변경은 본인 조회 유지 |
| 권한 | 실제 JWT와 DB 세션 guard 사용. 타 계정 커서·위변조·기간/시간대 변경 거부. 만료/철회 세션·정지·탈퇴 요청은401 |
| snapshot | findMany 후 count 전에 다른 DB 연결에서 완료 취소. 같은 transaction 응답은 이전 목록/total 일치, 다음 요청은 변경 반영 |
| 응답 최소화 | PRIVATE/FOLLOWERS/PUBLIC 본인 기록과 기존 숨긴 분류 유지. 타인의 메모·내부 userId 미노출 |

새 기능은 실제 PostgreSQL과 loopback HTTP로 확인했다. 전체 AppModule의 Redis/스토리지·다른 도메인까지 통합 검증한 결과는 아니다. 새 기록 DB 시험은 `TODO_HISTORY_TEST_DATABASE_URL`이 없으면 skip하며, loopback의 전용 `todosns_m04` DB만 허용한다. 합성 사용자 ID만 정리하고 마지막에 새 컨테이너를 종료해 임시 DB를 제거한다.

재현할 때는 새 격리 PostgreSQL에 기존 migration을 적용한 뒤, 그 loopback URL을 `TODO_HISTORY_TEST_DATABASE_URL`로 전달하고 API build 후 위 두 시험을 실행한다. 실제 비밀값·운영 DB URL을 전달하지 않는다. 원본 로그와 쿼리 계획은 `/workspace/mungsil-setup/api-m04/`에 두고 Git에는 올리지 않는다.

## 4. 날짜·커서·쿼리 계획

행위 시험은 서울 자정, 90일·윤년·잘못된 날짜, New York23/25시간, Sao Paulo의 없는 자정, Havana의 반복 자정, St Johns의 00:01 과거 시각 후퇴, Apia의 생략된 날짜를 확인했다. 서명 커서의 버전/필드/범위·위변조·사용자/기간/timezone/limit·키 변경 거부도 검사했다.

별도 합성2계정·총6천 행에서 핵심 필터/정렬·count SQL의 EXPLAIN ANALYZE/BUFFERS를 실행했다. 목록은 `Limit → Sort → Bitmap Heap/Index Scan`, count는 `Aggregate → Bitmap Heap/Index Scan`으로 기존 `Todo_userId_dueDate_idx`를 사용했다. 이 로컬 소량 검사는 운영 데이터 분포·규모의 성능 보증이 아니다. 추가 completedAt 인덱스는 운영 규모/쿼리 계획 검토 후 별도 결정하며 이번 schema/migration 변경은 없다.

## 5. 추적과 남은 범위

| 검수 항목 | 이번 범위 | 남음 |
| --- | --- | --- |
| AT-14 | 실제 완료일/예정일·날짜 경계 DB/HTTP 확인 | Android 기록 표시 |
| AT-15 | 동일 시각55개·안정 커서·전체 total·DB 동시 변경 | 앱 페이지 병합·늦은 응답·재조회 |
| AT-16 | 삭제·취소·공개 변경의 현재 조회 반영 | 전체 파기 worker·스토리지·앱 상세 갱신 |
| AT-20 | 실제 세션/계정·서명/조건 cursor 검증 | 두 실계정 기기 흐름 |

다음은 M-05 마이 내부의 기록 Repository/Model·화면이다. 기존5탭을 유지하고 위 계약의 기간·total·커서 오류·권한/계정 경계를 연결한다. 실제 기기·Google/FCM·release·운영 배포·대규모 성능은 이번 미검증이다. workflow·의존성/lockfile 변경, Actions 조회·재실행은 없다.
