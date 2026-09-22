# 격리 통합 검증 후속 실행 기록 — 2026-09-16

> 후속 서버 검증은 `docs/reviews/2026-09-22-server-integration-verification.md`에서 완료 상태와 남은 출시 조건을 기록했다.

이 기록은 운영 DB·스토리지·사용자 데이터를 사용하지 않은 로컬 시도다. 설정 존재를 실제 실행으로 세지 않는다.

## 변경과 재현

- `direct-chat.e2e.test.cjs`의 기존 handle은 긴 prefix에 역할 suffix를 덧붙인 뒤 20자로 잘라 A/B/외부인 모두 같은 값이 됐다. 12자리 랜덤 실행 ID와 역할 코드로 분리하고, PrismaClient 생성 전 모든 값의 정규식·20자 제한·고유성을 검사한다.
- 같은 잘림 결함이 `beta-flow.e2e.test.cjs`의 4계정과 초대 가입 2계정에도 있어 함께 수정했다. DB 없이 실행되는 사전검증 테스트는 통과했다.
- 1:1·챌린지 화면은 소켓 재접속 직후 방에 재참여하고 목록을 즉시 다시 조회한다. 기존 15초 폴링은 유지한다.
- TODO 완료·취소 실패는 캐시 복원과 함께 사용자 안내를 표시한다. 피드 응원 롤백은 기존 구현을 유지한다.
- CI의 잘못된 역할 테스트는 종료 코드뿐 아니라 예상한 세션/현재 역할 불일치 메시지를 확인한다. 백업·복원은 서버와 같은 PostgreSQL 17 컨테이너의 `pg_dump`·`pg_restore`를 사용하며 major 버전을 검사한다.

## 실행 결과

| 검사 | 결과 | 범위 |
| --- | --- | --- |
| `npm run lint` | 통과 | Web/API ESLint |
| `npm test` | 통과 | API 98건 중 95 통과·3 skip, Web 53 통과 |
| `npm run build` | 통과 | 최초 샌드박스 Prisma 다운로드 `ECONNREFUSED`; 허용된 외부 네트워크 재실행에서 contracts/API/Web 전체 완료 |
| `npm audit`, `npm audit --omit=dev` | 통과 | 실행 시 취약점 0건 |
| 두 운영/staging Compose `config --quiet` | 통과 | 구성 해석만 확인, 엔진 실행 아님 |
| `npm run test:browser -w @mungsil/web` | 미통과 | 첫 실행 3건 모두 초기 데이터 화면 로딩에 실패. trace 확인 뒤 localhost·서비스 워커 차단 설정을 수정했지만 재실행은 승인 사용량 제한으로 거부되어 최종 상태 미확인 |
| DB E2E 두 건·MinIO 통합 1건 | 실행 안 함 | `RUN_DATABASE_E2E=1`, `RUN_OBJECT_STORAGE_E2E=1` 미설정으로 기본 테스트에서 명시적 skip |
| DB 역할·migration 2회·dump/restore·Linux 이미지 | 실행 안 함 | Docker Linux 엔진 불가, CI는 아직 이 변경으로 실행되지 않음 |
| 실기기 모바일 키보드 | 실행 안 함 | 데스크톱 viewport 검증과 구분 |

Docker CLI와 Compose는 설치돼 있으나 Linux 엔진 파이프가 없다. Docker Desktop 백엔드 로그는 `AppData/Local/Docker/run/dockerInference` reparse point 제거 실패로 시작이 중단됨을 보여준다. 정확한 항목을 같은 폴더에 이동하려는 복구 시도도 Windows가 액세스를 거부했다. WSL 열거 역시 `E_ACCESSDENIED`였다. Docker factory reset, 이미지·볼륨 삭제, 운영 대체 연결은 하지 않았다. Windows `bash` 호출도 WSL 접근 거부로 실제 `bash -n` 검증이 되지 않았다.

## 재실행 조건

1. 관리자가 Docker Desktop/WSL 엔진 오류를 복구하거나 별도의 격리 Linux runner를 제공한다. 저장된 Docker 볼륨을 초기화하지 않는다.
2. CI와 같은 합성 PostgreSQL 17, Redis, 버전 관리가 켜진 MinIO를 준비한다. CI의 분리 LOGIN/권한 SQL과 migration을 적용한 뒤 `RUN_DATABASE_E2E=1 RUN_OBJECT_STORAGE_E2E=1 npm test`를 실행한다. DB URL은 이 합성 DB만 가리키고 테스트가 생성한 `@mungsil.test` 계정만 정리해야 한다.
3. CI job을 실제 실행해 PostgreSQL 17 클라이언트 일치, runtime/migrator/backup, 잘못된 역할 실패 로그, migration 재실행, 독립 복원 DB, Linux API/Web 이미지와 `bash -n`을 확인한다.
4. 설치된 Chrome에서 `npm run test:browser -w @mungsil/web`를 다시 실행한다. 초기 화면의 API 요청 trace, 실패·성공 지연 응답, 소켓 transport 단절/재연결과 메시지 ID 중복을 확인한다. 이 테스트의 합성 API/소켓 서버는 로컬 포트 3100/4998만 사용한다.
