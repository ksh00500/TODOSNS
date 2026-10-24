# M-13 · 최종 검수표와 개발 인수인계

2026-10-24 (Asia/Seoul). 개발 기준 `codex/beta-core`. 이번 앱/API 검증 소스는 `f686a1edabb9e38c7b7c37d7b6aa9d4e5122aa0e`이다. 최종 시험/검증 도구는 `858abb29b64b71543bb4aa6279f9f8eb16baf81f`이며 마지막 변경은 OS 캡처를 사용하는 시험 코드다. 초기 연결의 시험 자료 실패·별도 작은 창 시험·실제 IME에서 확인한 시트 문제와 수정 후 재검수를 M-11에서 구분한다.

사용자의 “남은 M 전부 진행”에 따라 M-09 이후 남은 작업을 M-10~13으로 정리했다. 아래는 개발 환경에서 완료한 범위이며 정식 출시나 전체 제품 정책의 확정을 의미하지 않는다.

2026-10-24 사용자 후속 요청으로 Google/Firebase·서명 등 사용자 제공 항목은 보류하고 [화면 완성도 작업](ui-polish-plan.md)을 먼저 진행한다. 현재 우선순위와 후속 결과는 [UI-01](implementation-ui01.md)을 따른다. 아래 M 검수와 외부 미검증 항목은 이력으로 보존한다.

추가로 승인된 차분한 매거진·파스텔 방향의 오늘/탐색/마이 첫 시각 고도화는 [파스텔 보고서](implementation-pastel.md)에서 확인한다. 이후 소스/검증·대표 이미지와 기존 M 검수의 시점을 구분한다.

| M | 처리 결과 | 근거·남은 경계 |
| --- | --- | --- |
| M-01~03 개인 TODO·폼·오늘 | 구현·unit/API 회귀 완료 | 기존 보고서와 현재 API160/Web53/Android152 검사. 기기 수명주기·접근성은 M-11 범위만 인정 |
| M-04~05 완료 기록 | 구현·실제 DB/HTTP 완료 | 본인·기간/시간대·커서/total·삭제 반영. Android 연결 결과는 M-11 |
| M-06 합성 통합 | 실제 DB/Redis/MinIO와 연결 검증 이력 유지 | 당시 System UI ANR에 가린 이미지는 통과 증거로 사용하지 않음 |
| M-07 게시 | 구현·모델/복원/HTTP 검사 완료 | 사진 URI/mediaId/pending·초안/본문/키. 실제 카메라/사진 권한·업로드·OS 프로세스 복원 별도 |
| M-08 응원·가져오기 | 구현·모델·서버 권한 검사 완료 | 현재 원본/복제 소유권, KEEP/NONE/CUSTOM. 만료 응원 복구는 M-10으로 보완 |
| M-09 공개 안전 | 실제 HTTP/DB/S3 경계 검증 완료 | 같은 transaction 인가/쓰기, snapshot/태그·버전 객체/탈퇴 worker 파기. 전체 운영 보안·소켓 검증으로 확대하지 않음 |
| [M-10 응원 복구](implementation-m10.md) | 구현·현재 로컬 검사 완료 | 이전 요청 재반전 없이 결과 정리, 실제 지연/만료/경합 시험. API 우선 배포 필요 |
| [M-11 기기 검수](implementation-m11.md) | 환경에서 가능한 연결 시험 실행 | 정확한 건수·시각 증거·환경 제한은 보고서. 실기기/전체 지원 OS/실제 OS 복원은 별도 |
| [M-12 운영·릴리스](implementation-m12.md) | 격리 권한·백업/복원·준비 완료, 서명/외부 검증 보류 | 기존 키·Google 설정 없음. 운영 DB 적용/배포·AAB/Play 성공 아님 |
| M-13 인수인계 | 검수표·재현 절차·차단 조건 문서화 | GitHub docs와 Basic Memory handoff/current-status에 실제 최종 commit·결과 기록 |

## 현재 소스의 공통 실행 결과

| 검사 | 환경·결과 |
| --- | --- |
| root lint / test / build | 격리 PG17·Redis7·버전 관리 MinIO, 모두 통과 |
| API | 160/160, 실패0/skip0. 실제 DB/객체 시험 활성화 |
| Web | 53/53, 실패0/skip0 |
| Android unit | 152/152, 20 suites, 실패0 |
| Debug·시험 APK / lint | 빌드 통과, lint0errors/32warnings |
| Android 연결 | 시트 보완 후21개·390/430 공유 화면 각1개, 최종 상세2개·200%9개·실제 IME1개·작은 TODO1개 통과. 초기 실패/skip/측정 예외는 M-11에 별도 보존 |
| 제한된 DB LOGIN의 API | runtime으로 M-10 HTTP/DB 7/7, 실패0/skip0 |
| 백업·복원 | backup LOGIN dump → migrator LOGIN/owner role restore → 데이터·소유권·권한 검사 통과 |
| Release AAB | 기존 서명 설정 없음으로 Gradle guard 차단, 미생성·미검증 |

명령과 로그 위치는 [재현 안내](../../../infra/verification/android-v1/README.md), APK 해시는 M-12에 있다. 로그·fixture 암호·dump·APK는 Git에 넣지 않는다. 현재 lint warnings32개는 오류0과 구분해 유지하며 경고 전체 해소를 주장하지 않는다.

## 환경·외부 설정이 필요한 잔여 검수

| ID | 미검증 항목 | 필요한 입력/환경·완료 증거 |
| --- | --- | --- |
| B-01 | 서명 AAB·Play 내부 트랙 설치 | 원래 업로드 키·private keystore.properties·현재 최고 versionCode, verify-bundle/서명 지문·실제 설치 버전 |
| B-02 | 실제 Google 로그인·FCM | 실제 프로젝트 google-services.json·OAuth/Play 서명 지문·테스트 계정/기기, 서버 세션·푸시 수신/권한/토큰 회전·계정 분리 |
| B-03 | 지원 OS·접근성·실제 수명주기 | API24/지원 최신 OS·안정적인 가속 장치·실기기, TalkBack·IME·회전/프로세스 종료·복원·실제 터치·권한 확인 |
| B-04 | 두 계정의 실제 사진·소켓 | 테스트 서버·실제 저장소/사진 권한·두 기기/계정, 업로드와 원본 삭제·차단·재연결 중 누락/중복/읽음 경계 |
| B-05 | 운영 DB 권한·재해 복구 | 대상 환경과 승인된 실행 창, 현재 역할 inventory·별도 백업·복원 시간/RPO/RTO·서비스 전환 확인 |
| B-06 | API·웹·앱 배포와 App Links | 승인된 대상, M-10 API 선행·구버전 호환·실제 HTTPS assetlinks·메일 링크·내부 배포 확인 |
| B-07 | 미정 제품 정책 | 대표 사용자/MVP·공개 기본값·복제 보유/수익·운영 조건 등의 별도 제품 결정. E-001~005 개발 선택을 사용자 확정으로 취급하지 않음 |

위 조건이 없어 실행하지 못한 항목은 미검증 상태로 유지한다. 임시 키 생성·서명 guard 우회·운영 자료로 검증·가린 캡처를 정상 화면으로 채택하지 않는다.

## 다음 세션의 시작점

1. `codex/beta-core`의 HEAD·원격·미커밋 상태를 확인하고 AGENTS.md와 current-status의 실제 검증 SHA를 읽는다. 옛 main/work나 과거 AAB를 최신 구현으로 취급하지 않는다.
2. 외부 조건이 갖춰지면 B-01~06 중 해당 범위만 실행한다. 이미 통과한 로컬 검사를 새 변경/실패 근거 없이 반복하지 않는다. 키/토큰을 문서·로그·Git·채팅에 넣지 않는다.
3. M-10을 배포할 때 서버를 먼저 반영한다. 구버전 서버 404는 앱의 응원 잠금을 유지하므로 배포 순서를 생략하지 않는다. 공개·복제·멱등 기록·수명 정책을 임의로 바꾸지 않는다.
4. GitHub Actions는 알려진 결제 제약으로 가용하지 않다. 상태 조사·수동 재실행·결제 제안·workflow 변경·CI용 커밋 없이 실제 구현과 필요한 현장 검증을 진행한다.

Basic Memory에는 이 문서와 최종 Git SHA·실제 통과/미검증·배포 없음·정리 결과를 새 handoff로 기록하고 current-status 앞에 추가한다. 기존 handoff/운영 결정은 보존한다.

최종 환경 정리: 합성 API와 두 계정·기기 fixture·forwarding·역할 비밀 파일·소유 컨테이너4개/tmpfs·runtime 설정 제거를 확인했다. 로그와 합성 검토 자료만 보존하며 운영 변경/배포는 없다.
