# 운영 배포 전 서버 통합 검증 기록 — 2026-09-20~22

이 기록은 운영 배포 전 격리 검증 결과다. 운영 서비스 배포, 운영 migration, 운영 DB·스토리지·사용자 데이터 사용은 포함하지 않는다.

## 검증 대상

- 기준 커밋: `2e6acb0eb5c41f26c1c3d259ebc6bc2d1a5929dc` (`codex/beta-core`)
- 검증 대상에는 기존 미커밋 변경과 이번 보완을 포함했다.
- 최종 검증 기록 작성 직전 tracked/untracked 소스 매니페스트 SHA-256: `88dba4a15ab01f6f0e46f88dd2a85cbe84c25d12ff12fed9b72954d1fa0bd488`
- 원격 전개에 사용한 보안 보완 아카이브 SHA-256: `086ccbc193fc0a34f9aea3fc1701fe4ab61e008467dd8149039ee45b19d36468`. 이후 API Dockerfile의 npm workspace hoist 경로와 CI 검사 경로를 추가 수정해 별도 검증했다.

## 환경과 격리

- Amazon Linux 2023, Docker 25, Docker Compose 5.5.1, 2 vCPU, RAM 약 1.9GB, swap 1GB인 동일 서버에서 실행했다.
- `mungsil-integration-verify-20260920` 이름의 전용 네트워크, PostgreSQL·Redis·MinIO 컨테이너, 전용 볼륨, 합성 LOGIN과 합성 계정만 사용했다.
- 격리 Caddy는 `127.0.0.1:43020`에만 바인딩하고 SSH 터널로 브라우저에 연결했다.
- 작업 전 운영 컨테이너는 Web `a26b6cd6e1f8`, API `e39c3f1f49d3`, Caddy `292c4a43ad8d`, PostgreSQL `e51b0010a08f`, Redis `a0482cebfcbf`였다. 정리 후에도 ID와 healthy 상태가 동일했고 외부 `/api/v1/health`가 `ok: true`를 반환했다.

## 실행 결과

| 검사 | 결과 | 근거 |
| --- | --- | --- |
| `npm audit`, `npm audit --omit=dev` | 통과 | 전체·운영 의존성 모두 취약점 0건 |
| `npm run lint` | 통과 | Linux 격리 이미지와 최종 Windows 작업 트리에서 Web/API ESLint 완료 |
| `npm test` | 통과 | Linux 실제 통합 환경에서 API 106/106, Web 53/53, 총 159건 통과·skip 0. 최종 Windows 재실행은 API 102 통과·조건부 4 skip, Web 53 통과 |
| `npm run build` | 통과 | Linux에서 contracts, Nest API, Next 16.3.5 Web production build 완료 |
| Linux API image | 통과 | 고정 Node digest로 빌드, production 의존성 audit 0건, 비밀 파일·runtime 역할 확인 뒤 실제 health 통과 |
| Linux Web image | 통과 | production image 빌드, audit 0건, Caddy를 통한 `/` 200과 API health 통과 |
| runtime/migrator/backup LOGIN | 통과 | runtime DML 허용, DDL·TRUNCATE 거부, backup 읽기 허용·쓰기 거부, migrator owner 전환 확인 |
| migration | 통과 | migrator LOGIN으로 2회 실행해 모두 pending migration 없음 확인. runtime/migrator 역할을 바꿔 시작하면 예상 role mismatch로 실패 |
| backup/restore | 통과 | backup LOGIN으로 custom dump 생성 후 별도 `mungsil_restore` DB에 복원, `synthetic-backup-ok` 데이터 확인 뒤 제거 |
| MinIO 객체 파기 | 통과 | version·delete marker를 모두 제거하고 비슷한 prefix의 무관 객체가 남는지 실제 MinIO로 확인 |
| 핵심 TODO 순환 | 통과 | 생성→완료→게시→응원·댓글→가져오기→재완료를 실제 HTTP·DB로 확인 |
| 1:1 대화 | 통과 | 요청→수락→전송→읽음, 양방향 차단 뒤 변경 거부와 기록 보존을 실제 HTTP·DB로 확인 |
| 차단 해제·알림·그룹 검색 | 통과 | 소유권, 멱등성, 상호 차단 한쪽 해제, 팔로우 미복원, 알림 경계, 60일 밖 검색, 복합 커서, series 충돌을 실제 HTTP·DB로 확인 |
| 실제 Web/API 브라우저 | 부분 통과 | 합성 로그인, 알림 진입 시 미읽음 2건 유지, 한 건만 읽음과 badge 2→1, 명시적 모두 읽음과 badge 제거, 차단 목록 표시, 그룹 검색 조건 변경 뒤 선택 1건 유지, Sheet 이탈 확인을 실행 |
| 360/390/430px viewport | 통과 | 360×640, 390×600, 430×720에서 문서 폭이 viewport보다 작아 가로 넘침이 없음을 측정. 360px 스크린샷에서 단일 세로 스크롤을 확인 |

## 검증 중 수정한 결함

1. bootstrap 계정이 PostgreSQL 초기 superuser일 때 `REASSIGN OWNED BY mungsil`이 시스템 객체까지 건드려 실패했다. `infra/database/apply-runtime-grants.sql`을 애플리케이션 schema·table·sequence·view·function·type의 명시적 ownership 이전으로 바꿨다. 깨끗한 합성 DB에서 owner mismatch 0건을 확인했다.
2. `minio/minio:latest`가 더 이상 pull되지 않았다. CI와 dev/staging/data-governance 구성을 공식 Quay의 `RELEASE.2025-09-07T16-13-09Z`로 고정했다.
3. production audit에서 Next.js, sharp, nodemailer, multer, Playwright 취약점이 검출됐다. 잠금 파일과 직접 의존성을 보안 수정 버전으로 갱신했고 전체·production audit 0건을 확인했다.
4. sharp 0.35.4의 CommonJS 타입/런타임 import 차이를 `media.service.ts`와 회귀 테스트에서 맞췄다.
5. npm 11이 Prisma 산출물을 루트 `node_modules`에 hoist해 API image가 존재하지 않는 앱 내부 경로를 복사하다 실패했다. API Dockerfile을 루트 production 의존성만 복사하도록 수정하고, CI가 이미지 안에서 `@prisma/client`, `sharp`, `nodemailer`를 루트 해석으로 불러오도록 바꿨다. 이미지 build·기동·health와 회귀 테스트 7/7을 확인했다.

## 브라우저 결과의 한계

- 저장소의 Playwright 모의 API 브라우저 suite는 Windows 샌드박스가 브라우저 프로세스 생성을 `spawn EPERM`으로 거부해 실행하지 못했다.
- 소켓 강제 단절·재접속, 실패 주입 시 초안·캐시 복원은 실제 브라우저에서 재현하지 않았다. 대신 Linux Node 동작 테스트에서 소켓 재접속 후 조회·ID 중복 방지, 채팅 초안 보존, 낙관적 캐시 복원을 통과했다.
- 차단 해제는 실제 HTTP·DB E2E로 검증했고 브라우저에서는 합성 차단 목록과 해제 버튼 표시까지 확인했다. 해제 버튼 실제 클릭은 실행하지 않았다.
- 실제 모바일 키보드와 200% 확대는 확인하지 않았다. viewport 검사와 구분한다.

## 정리와 운영 영향

- 격리 컨테이너 6개, 전용 볼륨 3개, 네트워크 1개, API/Web/MinIO 검증 이미지, 합성 비밀·DB·객체·소스 아카이브를 제거했다.
- 사용자가 승인한 범위에서 2026-09-20에 생성된 이번 검증 BuildKit 캐시 ID만 제거했다. Docker 전체 prune은 실행하지 않았다.
- 운영 컨테이너 재시작, 운영 migration, 운영 DB·스토리지 접근, 운영 설정 변경, 배포를 하지 않았다.

## 출시 판단과 남은 조건

서버 통합 검증 범위에서는 배포 후보 상태다. 실제 PostgreSQL 17·Redis·MinIO, 분리 LOGIN, 백업 복원, Linux image runtime, 실제 Web/API 연결까지 통과했다.

운영 배포 전에는 다음 조건을 별도로 완료해야 한다.

1. 현재 미커밋 작업 트리를 검토 가능한 커밋으로 고정하고 그 정확한 커밋에서 CI를 통과시킨다.
2. 운영용 runtime/migrator/backup 비밀 파일과 역할을 배포 절차에 따라 준비하고, 운영 변경 승인과 롤백 지점을 확보한다.
3. 가능하면 브라우저 프로세스를 실행할 수 있는 runner에서 Playwright 실패 주입·소켓 단절 suite를 재실행한다.
4. 운영 배포와 운영 migration은 이 기록과 분리된 후속 작업으로 수행한다.
