# M-10 · 미확인 응원 복구

2026-10-24 (Asia/Seoul). 기준 `aa3b7c2` 이후 `codex/beta-core` 변경. 배포하지 않았다.

M-08에서는 응원 toggle이 실패한 뒤 5분이 지나면 현재 상태를 읽어도 새 행동을 할 수 없었다. 이전 요청이 늦게 처리될 수 있어 GET만으로 잠금을 해제하지 않았기 때문이다. 이번에는 현재 상태를 확인하면서 이전 키의 지연 처리를 막는 서버 경로를 추가했다.

| 계약 | 동작 |
| --- | --- |
| `POST /api/v1/feed/posts/:id/cheer/result` | 인증 필수, `{requestKey}`. 키는 영문/숫자/`_.:-`, 1~100자 |
| 성공 201 | `{status:"RECONCILED",postId,cheered,cheerCount}`. 현재 snapshot의 응원 상태와 전체 수치 |
| 권한 | 기존 readablePost·작성자 활성·공개/팔로워·양방향 차단을 같은 Serializable transaction에서 확인 |
| 기존 요청 차단 | 계정·게시물·기존 POST 경로·키의 IdempotencyKey를 완료 처리하고 24시간 보존. Cheer/보상/알림을 새로 만들거나 취소하지 않음 |
| 지연된 toggle | 같은 transaction에서 멱등 행을 갱신. 정리 뒤 도착하면 완료 결과 반환, 이전 snapshot과 경합하면 rollback. 쓰기 자동 반복 없음 |
| 만료 정리 | 관측 뒤 새로 완료된 행을 삭제하지 않도록 조건부 삭제 후 재조회 |
| Android | 목록·상세 공유 receipt 유지, 만료 뒤에도 명시적 결과 확인 가능. 같은 receipt·세션과 엄격한 응답 형식 확인 뒤 잠금 해제·새 행동에 새 키 |
| 실패·이전 서버 | 404/권한/네트워크/잘못된 응답이면 기존 미확인 키 유지. 서버를 먼저 배포해야 함 |

RECONCILED는 과거 toggle이 적용됐다는 영수증이 아니다. 현재 상태로 정리하고 이전 키의 지연 변경을 막았다는 뜻이다. 키가 없는 기존 클라이언트의 toggle 계약은 보존한다. 보존기간 이후 임의로 과거 HTTP를 재전송하는 클라이언트까지 무기한 차단하지 않는다.

| 실제 검사 | 결과 |
| --- | --- |
| 실제 PostgreSQL/AppModule HTTP 경계 시험 | 새 6개 하위 + 상위 1개 통과. 완료/없음/만료 키, 계정·권한·입력, transaction 전 지연, 오래된 snapshot 경합, 만료 정리 경합 |
| root lint/test/build | 통과. API160/Web53, 실패0/skip0, 실제 DB·기록 DB·버전 관리 MinIO 활성화 |
| Android Debug·시험 APK·unit·lint | 통과. unit152/20 suites, 실패0. lint0errors/32warnings |
| Android 복구 unit | 만료 receipt 복원→정리→새 키, 잘못된 응답 보존, 다른 receipt/늦은 callback 거부, 이전 세션 HTTP 미전송 |
| 기기·화면 | M-11 결과로 별도 기록. Compose 코드 컴파일을 실행 통과로 계산하지 않음 |

로그는 checkout 밖 `/workspace/mungsil-setup/final-m10/`에 둔다. 재현은 `infra/verification/android-v1/services.py start/test/stop WORK`이며 운영 설정을 읽지 않는다. 운영 권한 계정에서 같은 HTTP 시험을 실행한 결과는 M-12에 기록한다.
