# 뭉실 Cloud Comfort 제품 디자인 시스템

이 문서는 Stitch 결과물을 뭉실 서비스 전체에 적용하기 위한 구현 기준이다. 원본 HTML을 복사하지 않고, 화면에서 확인된 UI·UX 원리를 현재 Next.js 구조와 실제 API 위에 다시 구현한다.

## 1. 경험 원칙

### Reliable yet Whimsical

- 생산성 도구처럼 상태와 행동이 명확해야 한다.
- 웰니스 앱처럼 압박감이 적고 완료 순간이 부드러워야 한다.
- 귀여움은 구름 아이콘과 낮은 채도의 색에 한정한다.
- 장식보다 진행률, 실제 인증 이미지, 다음 행동이 먼저 보여야 한다.

### 핵심 행동 우선순위

1. 오늘 해야 할 일 확인
2. 현재 진행 중인 TODO 완료
3. 완료 결과 공유
4. 탐색 피드에서 실천 발견
5. `나도 할래요`로 가져오기
6. 저장 전에 제목·일정·카테고리·반복 수정

### 한 화면, 하나의 주 행동

- 오늘: 현재 TODO 완료
- 탐색: `나도 할래요`
- 가져오기: `내 TODO에 저장`
- 챌린지: 참여 또는 오늘 인증
- 마이: 나의 성장과 기록 확인

## 2. 시각 토큰

### 색

| 역할 | 값 | 용도 |
| --- | --- | --- |
| Background | `#FBF9F8` | 앱 전체 배경 |
| Surface | `#FFFFFF` | 기본 카드 |
| Surface Low | `#F5F3F3` | 입력, 비활성 영역 |
| Surface High | `#EAE8E7` | 선택·구분 배경 |
| Text | `#1B1C1C` | 주요 텍스트 |
| Text Variant | `#49454F` | 보조 텍스트 |
| Outline | `#7A7580` | 아이콘·보조 경계 |
| Outline Variant | `#CAC4D0` | 카드 경계 |
| Primary | `#625290` | 핵심 CTA, 포커스, 진행률 |
| Primary Fixed | `#E8DDFF` | 라일락 강조 배경 |
| Secondary | `#376666` | 완료 상태 텍스트 |
| Secondary Container | `#BBECEB` | 완료·현재 탭·안정 상태 |
| Tertiary Fixed | `#FFD9E1` | 응원·배지 강조 |
| Accent Yellow | `#F4F8D3` | 안내·성취 보조 |
| Error | `#BA1A1A` | 오류·삭제 |

색은 기능 상태를 구분하는 데 사용하며, 의미 전달을 색상에만 의존하지 않는다.

### 타이포그래피

- 영문 브랜드와 숫자: `Plus Jakarta Sans`
- 한글: 가독성이 높은 시스템 산세리프 폴백
- 모바일 화면 제목: 32/40, 700
- 섹션 제목: 24/32, 600
- 카드 제목: 18/24, 600
- 본문: 16/24, 400
- 보조 문구: 14/20, 400
- 메타데이터: 12/16, 700

영문과 한글을 한 문장 안에서 불필요하게 혼용하지 않는다. 브랜드명은 `뭉실`, 기능명은 한국어를 기본으로 한다.

### 간격과 형태

- 기본 간격 단위: 8px
- 모바일 좌우 여백: 24px
- 카드 내부 여백: 16px 또는 24px
- 섹션 간격: 32px
- 카드 기본 모서리: 16px
- 핵심 카드 모서리: 24px
- 버튼: 16~24px 또는 완전한 pill
- 터치 영역: 최소 44px

### 깊이

- 강한 테두리보다 넓고 낮은 불투명도의 그림자를 사용한다.
- 기본 카드는 흰색 Surface와 Ambient Shadow를 사용한다.
- 하단 내비게이션과 모달은 반투명 Surface와 blur를 사용한다.
- 정보 카드 내부에 글래스 효과를 중첩하지 않는다.

## 3. 공통 컴포넌트 규칙

### 앱 헤더

- 왼쪽: 홈 역할의 구름 아이콘
- 중앙: `뭉실` 워드마크
- 오른쪽: 알림 또는 로그인
- 콘텐츠와 분리된 흰색 플로팅 바

### 하단 내비게이션

- 오늘, 탐색, TODO, 챌린지, 마이 다섯 항목
- 활성 항목은 Secondary Container pill로 감싼다.
- 아이콘과 레이블을 함께 표시한다.
- 모바일 Safe Area를 포함한다.

### TODO 카드 상태

- 완료: Secondary Container 채움, 체크 아이콘, 제목 취소선
- 진행 중: 흰색, 2px Primary 경계, 주변 그림자
- 예정: 옅은 배경 또는 점선 경계
- 행동 아이콘은 오른쪽에 배치한다.

### 피드 카드

- 작성자 → 인증 이미지 → 카테고리와 TODO 제목 → 본문 → 반응과 CTA 순서
- 인증 이미지가 카드의 가장 큰 면적을 차지한다.
- `나도 할래요`는 Primary pill 버튼으로 표시한다.
- 응원과 댓글은 아이콘 중심의 보조 행동이다.
- 단일 TODO와 리스트를 텍스트로 명확히 구분한다.

### 가져오기 화면

- 전역 내비게이션을 숨기는 집중 화면 또는 전체 높이 Sheet
- 상단에 원본 작성자와 습관 맥락 표시
- 제목, 시작일, 시간, 카테고리, 반복을 편집
- 하단에 `내 TODO에 저장` 고정 CTA
- 저장 성공 후 생성된 TODO 날짜로 이동

### 프로필

- 프로필 정보는 중앙 정렬
- 게시물·팔로워·팔로잉 수치를 동일한 카드로 표현
- 등급은 현재 점수, 다음 기준, 진행 바로 표현
- 배지는 획득/잠김 상태를 함께 보여준다.

## 4. 반응형 규칙

- 360px, 390px, 430px에서 동일한 정보 우선순위를 유지한다.
- 데스크톱에서는 최대 438px 앱 프레임을 중앙에 표시한다.
- 랜딩만 넓은 화면 레이아웃을 사용한다.
- 피드 이미지는 가로 폭에 맞춰 4:3 또는 16:10을 유지한다.
- 하단 CTA와 내비게이션이 겹치지 않게 스크롤 여백을 둔다.

## 5. 구현 원칙

- Stitch HTML의 Tailwind CDN과 Material Symbols를 복사하지 않는다.
- 기존 React 라우트, TanStack Query 상태, API 계약을 유지한다.
- 아이콘은 기존 Lucide를 사용한다.
- Stitch에서 생성된 이미지는 로컬 체험 화면의 시각 검증용으로만 보관한다. 운영 배포 전 사용 권한이 확인된 제품 자산으로 교체한다.
- 공통 토큰은 `globals.css` 한 곳에서 관리한다.
- 각 화면은 로딩, 빈 상태, 오류, 오프라인, 권한 없음 상태를 동일한 시각 언어로 제공한다.

## 6. 소셜 공유 이미지

- 생성 방식: Codex 내장 이미지 생성
- 결과 파일: `apps/web/public/mungsil-og-cloud-comfort.png`
- 용도: Open Graph 및 Twitter 대형 링크 미리보기
- 최종 프롬프트:

```text
Use case: ads-marketing
Asset type: Open Graph social sharing card for the Korean mobile product “뭉실”
Primary request: Create one polished landscape social card that introduces 뭉실 as a calm habit-and-encouragement social app. It must visually match the product’s “Cloud Comfort” UI system: reliable yet whimsical, adult lifestyle product rather than a children’s app.
Scene/backdrop: warm cream #FBF9F8 with broad, clean pastel color fields in purple #625290, mint #BBECEB, lavender #E8DDFF, blush pink #FFD9E1, and pale yellow #F4F8D3.
Subject: a refined editorial composition combining a large circular daily-progress ring, a minimal soft cloud mark, three practical TODO state cards, and one rounded lifestyle-photo card suggesting a completed healthy routine. These are product-design motifs, not a literal phone mockup.
Style/medium: premium flat editorial product illustration with subtle paper texture and soft ambient shadows; clean, modern, spacious Korean lifestyle brand.
Composition/framing: 1.91:1 landscape, centered balanced hierarchy, generous safe margins for link previews, no edge cropping.
Lighting/mood: soft morning calm, encouraging, dependable, gently uplifting.
Text (verbatim): Render exactly two Korean text lines and no other text: small brand “뭉실” and main line “좋아요로 끝나지 않는 건강한 루틴 SNS”. Use clean bold sans-serif typography, perfectly legible, with the brand in purple and the main line in very dark navy.
Constraints: no phone frame, no glassmorphism overload, no excessive gradients, no decorative cloud clutter, no childish cartoon characters, no unrelated icons, no watermark, no extra letters or words, no logos other than the simple original cloud mark.
```
