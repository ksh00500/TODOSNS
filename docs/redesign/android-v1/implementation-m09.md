# M-09 · 공개 안전·권한·삭제 경계

2026-10-24 UTC · A-08. 기준 `codex/beta-core@c3317ed87c667eff719cad4dab37b4d03d36e837` + 이번 API·시험·문서 변경. 운영 서비스·실사용자에 대한 시험이나 배포는 하지 않았다.

## 1. 확인된 문제와 수정

이번 검토는 TODO/루틴 가져오기, 게시물 응원·댓글, 차단/팔로워/신고, 원본 삭제·탈퇴의 서버 경계에 한정한다. 전체 인증·관리자·인프라 보안 감사 완료를 의미하지 않는다. `security-router` 라우터는 읽었으나 참조하는 `보안/공통/검토원칙.md`, `출력형식.md`, 인가·리소스 소유권·민감정보 세부 파일은 제공된 리소스에서 읽을 수 없었다. 세부 가이드 적용 완료로 표시하지 않고 AGENTS·코드·실행 증거를 근거로 판단했다.

| ID·확실성 | 심각도·조건 | 근거·영향 | 수정·검증 |
| --- | --- | --- | --- |
| M09-01 확인됨 | 높음. 인증된 사용자의 가져오기와 원본 변경이 겹침 | `cloneTodoList`의 권한/차단 확인은 트랜잭션 밖, 내부 조회는 ID만 확인. 반복 `cloneTodo`도 이전 원본을 사용. 공개 범위 축소/차단 완료 뒤 복제가201로 성공하는 사례3개 재현 | 원본 가시성·작성자 활성·차단 조회와 복제를 같은 Serializable 트랜잭션으로 이동. 수정 후404와 복제 TODO/그룹/시리즈·알림 미생성 확인 |
| M09-02 확인됨 | 중간. 접근 확인과 쓰기 사이 게시물 숨김 | `toggleCheer`/`comment`는 읽기 허용을 확인한 뒤 별도로 저장. 숨김 뒤 응원·댓글이201로 생성되는2사례 재현 | 같은 트랜잭션 snapshot에서 접근 확인과 저장. 수정 후404·응원/댓글/보상/알림 미생성 확인 |
| M09-03 확인됨 | 낮음. 루틴 사전 조회 뒤 원본 hard delete | 내부 `findUniqueOrThrow`가500을 반환 | 접근 가능한 원본을 트랜잭션 안에서 `findFirst`로 확인해404. 복제 잔여물 없음 |

구현: [MungsilService](../../../apps/api/src/mungsil.service.ts)의 `cloneTodoList`, `cloneTodo`, `toggleCheer`, `comment`와 접근 helper. helper에 transaction client를 전달해 차단 조회도 같은 snapshot을 사용한다. 단일 복제의 대상 그룹 소유권·분류 조회·그룹 연결도 같은 트랜잭션에서 처리한다. [TodoCategoryService](../../../apps/api/src/todo-category.service.ts)의 기존 호출 방식은 유지하고 선택적 client를 추가했다.

시험: [social-access.database.test.cjs](../../../apps/api/tests/social-access.database.test.cjs). 수정 전 실제 HTTP/DB에서 경계6사례가 **201 다섯 건/500 한 건**으로 실패했고, 수정 후 모두404로 거부됐다. Node는 이 초기6개 자식과 부모를 합쳐7개로 보고한다. 취약점7개로 해석하지 않는다.

시험은 별도 Prisma client로 변경을 commit한 뒤 서비스의 실제 트랜잭션을 시작하도록 순서를 제어한다. 기존 트랜잭션 밖 게시물 조회 경로는 조회 직후 같은 중단점을 사용한다. DB 응답을 모의 값으로 대체하지 않았다. 모든 가능한 동시 실행 순서를 증명한 것은 아니며, 트랜잭션이 시작되기 전에 완료된 철회와 같은 snapshot의 인가/쓰기 경계를 검증한다.

## 2. 실제 합성 통합 범위

| 범위 | 실제 확인 |
| --- | --- |
| 원본 변경 경합 | 루틴 공개 축소·차단·삭제, 반복 TODO 공개 축소, 게시물 숨김 전후 응원·댓글의 경계6사례 |
| 단일 가져오기→재완료 | 새 사용자 PRIVATE TODO·원본 출처·내 그룹/분류·밀리초 일정, 같은 키로1개만 생성, 내 TODO 재완료, 원본 제목 불변·게시 연결의 완료 취소 제한 |
| 루틴 | KEEP/NONE/CUSTOM, 새 사용자 PRIVATE 그룹/항목·출처,26시간 간격과 밀리초 보존, 반복 유지/해제, 같은 키의 동일 그룹 응답 |
| 차단·팔로워 | 양방향 차단으로 피드/검색/상세/응원/댓글/가져오기/신고 거부. 해제 후 접근 재허용, 팔로우 관계는 자동 복원하지 않음. 팔로워 전용 게시물의 비회원/다른 사용자 거부·팔로우 해제 후 신규 읽기/복제 거부 |
| 신고·소유권 | 접근 가능한 게시물 신고·중복409, 다른 사용자의 게시물/TODO 삭제404. 거부된 신고/응원/댓글의 DB 잔여물 없음 |
| snapshot 철회 | 원본 공개 범위 축소 후 상세/검색/복제 거부. 다시 공개해도 기존 snapshot 접근은 복원하지 않음 |
| 원본 삭제·실제 MinIO | 삭제 후 caption/snapshot/검색 필드/태그 파기·Media 행 제거. 원본/thumbnail의 여러 버전·delete marker 모두 제거, 비슷한 prefix의 이웃 객체2버전 보존. 삭제 전 발급 URL200→객체 파기 후404. 삭제 TODO를 복구해도 기존 snapshot은 복원하지 않음 |
| 탈퇴 | 실제 `auth/delete-account` 호출 직후 기존 access token·refresh cookie401, 공개 게시물404. 실제 worker의 DB/객체 파기 완료, 사용자/TODO/게시물/세션/미디어0, ErasureRequest·목적별3개 Task COMPLETED·subjectUserId 해제. 다른 사용자가 이미 소유한 복제 TODO와 계정은 유지 |

스토리지 시험은 새 합성 객체와 본인 READY Media fixture를 준비해 연결/파기를 검사했다. Android 사진 선택·presign/upload/변환 처리의 전체 흐름은 아니다. 탈퇴 시험은 worker의 실제 완료 Promise를 관측했으며 완료 처리를 모의 응답으로 대체하지 않았다. 일반 원본/다른 사용자의 복제본 보유·파기 정책을 새로 결정하거나 바꾸지 않았다.

## 3. 현재 실행 결과

| 검사 | 결과 |
| --- | --- |
| API 전체 | **153 통과 / 0 실패 / 0 skip**. 기존 조건부 DB3·기록 DB1·S3저장소1도 실제 실행. 신규 소셜 DB 스위트는 자식14개와 부모1개로15건 보고 |
| Web 전체 | **53 통과 / 0 실패 / 0 skip** |
| lint/build | root `npm run lint`, `npm run build` 통과. 최종 `npm test` 통과. 탈퇴 시험 추가 뒤 전체 test를 다시 확인했으며 같은 production source의 lint/build 결과와 구분 |
| Android | 이번 소스/DTO 변경 없음, Android 작업 미실행.148개 단위 시험과 기기 실패/미검증은 M-08·M-06 당시 이력이며 이번 API 검증으로 대체하지 않음 |
| 문서 | 상대 링크·`git diff --check` 확인 |

환경은 기존 검증 도구 `infra/verification/android-v1/services.py`의 격리 PostgreSQL17·Redis7·MinIO versioned storage다. 이번 소유 label/ID·loopback·tmpfs 자원만 사용하고 기존15개 migration을 적용했다. 자격 증명은 checkout 밖0600 설정에서 자식 프로세스에만 전달하며 출력/Git/기억에 남기지 않았다. API의 요청·응답 계약/schema·의존성/lockfile·workflow·기존 기본값/수명 정책은 변경하지 않았고 API의 트랜잭션 경계만 보강했다.

원본 로그: checkout 밖 `/workspace/mungsil-setup/android-m09/`의 `source-boundary-before.log`, `source-boundary-after.log`, `account-and-access.log`, `root-test.log`, `root-lint.log`, `root-build.log`. 준비·대표 시험과 전체 회귀를 중복 합산하지 않는다.

시험 후 합성 계정0·해당 S3 prefix의 버전/delete marker0을 확인하고 이번 컨테이너·tmpfs 데이터·접속 설정을 정리했다. 기존 운영 DB·볼륨·실계정은 사용하지 않았다.

## 4. 남은 검증·위험

| 항목 | 현재 상태 |
| --- | --- |
| 동시성·부분 실패 | 같은 snapshot의 인가/쓰기는 보강했지만 모든 스케줄·운영 부하를 검증한 것은 아님. Serializable 충돌이 발생할 수 있으며 불명확한 쓰기를 자동 반복하지 않음. 보상/알림은 기존대로 commit 뒤 실행하므로 부분 실패의 결과 확인 계약도 유지 |
| 사진/세션/기기 | 기발급 사진 URL의 공개 축소·차단 직후 TTL/캐시 동작, 실제 업로드/변환·소켓/FCM 전달·실기기 화면/프로세스 복원은 별도. 객체 파기 후 URL404를 즉시 권한 철회 전체의 증거로 확대하지 않음 |
| 운영 권한·출시 | 임시 superuser DB 시험이며 운영 runtime/migrator/backup 역할 분리·규모/복구·Play 서명·운영 배포 미검증 |
| 이전 미완료 | M-08 만료된 불확실 응원의 작업 상태 조회/명시적 상태 계약과 M-06 연결 기기 ANR 문제는 이번에 해결하지 않음 |

GitHub Actions 조회·수동 재실행·결제 제안·CI 유도 커밋/Push와 workflow 수정은 하지 않았다. A-08의 확인된 서버 경계 보강·합성 통합과 전체 보안/실기기/출시 완료를 구분한다. 다음은 A-09의 기기·접근성·수명주기·출시 준비 검증과 남은 결과 확인 계약이다.
