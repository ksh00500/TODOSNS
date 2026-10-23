# 뭉실 재설계 문서

기존 서비스의 큰 틀을 유지하면서 요구사항부터 다시 검토하기 위한 문서입니다.

기준일: 2026-10-23 (Asia/Seoul) · 버전: v0.1 · 상태: 검토용 초안

| 문서 | 내용 | PDF |
| --- | --- | --- |
| 요구사항 분석서 | 서비스 방향, 기능 요구사항, 정책 결정 목록, 품질 요구사항, 첫 출시 범위 제안 | [PDF 보기·다운로드](TODOSNS_Requirements_v0.1.pdf) |
| RFP · 제안요청서 | 재설계 수행 범위, 산출물, 검수 기준, 일정·비용 제안 항목, 운영 제약 | [PDF 보기·다운로드](TODOSNS_RFP_v0.1.pdf) |

확정된 서비스 방향과 기능·범위 제안 및 미정 사항을 구분했습니다. 예산·일정·플랫폼·출시 범위는 추가 합의가 필요합니다. RFP는 외부 공고나 계약 체결 문서가 아닙니다.

GitHub에서 PDF를 열어 확인하거나 파일 화면의 다운로드 버튼을 사용하세요.

## 설계·개발 준비

첫 구현 대상은 **Android 우선**으로 결정했습니다. Kotlin/Compose 네이티브 앱을 우선 설계하고 공통 API·기존 웹의 호환성을 보존합니다.

| 문서 | 내용 |
| --- | --- |
| [Android 응원·가져오기 설계](android-v1/social-and-import-spec.md) · [M-08 결과](android-v1/implementation-m08.md) | 응원 원복/요청 공유·루틴 복원·소유권과 현재 검사/미검증 |
| [Android 선택적 게시 설계·M-07](android-v1/publishing-spec.md) · [구현 결과](android-v1/implementation-m07.md) | 게시/사진 초안·세션 경계·불확실한 결과 확인, 현재 검사와 미검증 |
| [Android M-06 연결·통합 검증 결과](android-v1/implementation-m06.md) | 실제 합성 API/DB/스토리지·Android 연결 UI, 재현 도구와 남은 검증 |
| [Android M-05 완료 기록 구현 결과](android-v1/implementation-m05.md) | 마이 내부 기록·기간·페이지 조회와 현재 검증/미검증 범위 |
| [Android V1 상세 설계·화면 초안](android-v1/README.md) | 오늘·작성·완료·기록 화면, API/상태 계약과 검수 시나리오 |
| [설계 계획](design-plan.md) | 단계별 산출물·완료 조건, 핵심 구현 순서, UX·API·데이터 설계 원칙 |
| [결정 로그](decision-log.md) | 사용자 확정 결정과 합의가 필요한 정책 |
| [Android 우선 백로그](android-first-backlog.md) | 사용자 흐름, 재사용 코드, 첫 구현 작업·검증 기준 |
| [개발 준비 현황](development-readiness.md) | 현재 Codex 실행 결과, 도구·명령, 실패·미검증과 다음 조치 |

PDF v0.1은 최초 초안입니다. 이후 확정된 Android 우선 결정과 실행 결과는 위 Markdown 문서를 따릅니다.
