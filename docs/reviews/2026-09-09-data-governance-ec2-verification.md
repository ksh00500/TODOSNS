# 데이터 거버넌스 EC2 격리 검증 기록

기준일: 2026-09-09. 이 문서는 합성 환경 검증 기록이며 법률 검토, 운영 migration, 실제 데이터 파기, 분석 수집, 외부 제공 또는 운영 배포 승인이 아니다.

## 운영 EC2 읽기 전용 조사

- DNS 대상: `mungsil.kro.kr` → `13.211.148.244`
- 운영체제/리전: Amazon Linux 2023, `ap-southeast-2`
- 인스턴스: `t3.micro`, 2 vCPU, 약 1 GiB RAM, 8 GiB root volume
- 조사 시점 여유: available memory 약 236 MiB, swap 약 519 MiB 사용, root disk 약 3.2 GiB 여유
- 운영 Compose: `/srv/mungsil/app/infra/docker-compose.yml`, 프로젝트 `mungsil`
- 운영 컨테이너: API, web, PostgreSQL, Redis, Caddy 5개
- 결론: 운영과 동시에 PostgreSQL·MinIO·검증 runner를 추가하면 OOM, swap 지연, disk 부족 위험이 있어 같은 인스턴스에서 전체 검증하지 않는다.

조사 과정에서 `.env`, container environment, 운영 DB와 운영 S3 객체·버킷 내용은 읽지 않았다.

## 승인된 격리안

- 별도 임시 EC2 `mungsil-dg-verify-20260909`: `t3.small`, Amazon Linux 2023, 20 GiB gp3, 최대 2시간
- Docker 프로젝트 `mungsil-dg-verify-20260909`, 전용 network/volume, 호스트 서비스 포트 없음
- PostgreSQL 17 384 MiB, MinIO 384 MiB, 검증 runner 768 MiB 상한
- AWS 테스트 버킷 `mungsil-dg-verify-20260909-01a07eca`: public access 차단, SSE-S3, versioning, bucket 한정 role
- 테스트 완료 후 위 이름의 합성 resource만 정리

## 현재 진행 결과

- 격리 Compose, runner image, 합성 upgrade fixture, schema/trigger 검증 SQL 구현
- 실제 S3 호환 SDK 경로의 unversioned/versioned 객체 삭제 E2E 구현
- `npm run lint`: 통과
- `npm test`: API 69개 중 67 통과, 실제 DB·storage E2E 2개 skip; web 50개 통과
- Compose config, shell syntax, `git diff --check`: 통과

## AWS 실행 상태

- 로컬 AWS CLI `default` 자격 증명: 유효하지 않은 token으로 호출 실패
- 운영 EC2 instance role: `MungsilEc2Role`
- 이 역할은 `ec2:DescribeInstances`가 거부되며 새 EC2를 만들 권한이 없음
- 운영 role 권한은 확대하지 않았다. AWS Console 로그인 화면을 작업 인계 상태로 열었다.
- 따라서 임시 EC2, 테스트 S3, IAM role은 생성하지 않았다. 이후 사용자 승인으로 아래 동일 EC2 저자원 순차 검증만 수행했다.

## 동일 EC2 저자원 순차 검증 결과

사용자 승인으로 별도 EC2 생성 대신 운영 EC2 내부의 전용 경로·network·volume을 사용하되 PostgreSQL과 MinIO 단계를 동시에 실행하지 않는 축소안을 적용했다.

- 전용 경로: `/srv/mungsil-dg-verify-20260909` — 검증 후 삭제 완료
- 전용 network/volume/container: `mungsil-dg-verify-20260909-*`와 검증 label 대상 — 검증 후 0개 확인
- 운영 Compose `mungsil`, 운영 DB, 운영 S3에는 테스트 연결하지 않음
- 빈 DB: 14개 migration 전체 적용 성공
- upgrade DB: 기존 12개 migration, 합성 fixture, 신규 2개 migration 순차 적용 성공
- capability role: 허용 query와 대표 forbidden query 통과
- shadow/snapshot: backfill, insert/update/delete cascade, 공개 범위 축소, snapshot scrub/tag 제거 trigger 통과
- MinIO: unversioned와 versioned 버킷에서 실제 SDK 객체·version·delete marker 삭제 및 이웃 prefix 비삭제 통과
- 최대 관측 사용량: 합성 PostgreSQL 약 49.21 MiB/192 MiB, MinIO 약 79.61 MiB/256 MiB
- 운영 API: 검증 전·단계 사이·정리 후 healthy
- 검증 로그 SHA-256: `4AB1B5B9082E5D3C6C9557EDDD04FDC459AAAA73050B8A54D55B959FA4DC4454`

실제 AWS S3 전용 버킷 검증은 생성 권한 부재로 미실행이다. MinIO 결과를 AWS 고유 versioning/IAM 동작의 증거로 대체하지 않는다.

## 운영 배포 사전 수치

- 현재 운영 migration: 12개, schema up to date
- 사용자: 1명
- 게시물: 0개 — direct/list 및 backfill 불가 행도 모두 0개
- DB 크기: 9,901,747 bytes
- backup timer: active, 최근 service result success/exit 0
- 배포 시 신규 2개 expand migration이 사용자 1명의 identity/profile shadow를 만들고 Post nullable field와 trigger를 추가한다.
- legacy post snapshot backfill 대상은 0개다.

## 원격 실행 시 기록할 증거

- instance ID, AMI, subnet/VPC, security group, test bucket ARN, instance role ARN
- source commit/diff hash, image digest, migration checksum과 `_prisma_migrations`
- 빈 DB·upgrade DB의 schema/constraint/index/trigger inventory
- shadow row 수·checksum, FK orphan 0, trigger 결과, capability role 허용/거부 결과
- MinIO와 AWS S3의 version/delete marker 삭제 결과 및 이웃 prefix 비삭제 결과
- 실행 시간, 최대 CPU/memory/disk, 운영 health 변화 없음
- 테스트 EC2·bucket·role·security group·Docker volume 정리 결과
