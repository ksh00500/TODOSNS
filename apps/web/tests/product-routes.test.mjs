import test from "node:test";
import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";

const routes = ["today", "explore", "explore/search", "todos", "todos/import", "todos/routines", "todos/categories", "challenges", "me", "notifications", "settings"];

test("상용 MVP 핵심 화면이 독립 라우트로 존재한다", async () => {
  await Promise.all(routes.map((route) => access(new URL(`../app/(product)/${route}/page.tsx`, import.meta.url))));
});

test("디자인 시스템에 제품 핵심 토큰과 모바일 프레임이 있다", async () => {
  const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  for (const token of ["--ink", "--paper", "--primary", "--blue", "--pink", "--lilac", "--mint", "--yellow", "--ease-standard", "--motion-fast", "--motion-standard", "--motion-slow"]) assert.match(css, new RegExp(token));
  assert.match(css, /\.mobile-app\s*\{/);
  assert.match(css, /width:min\(430px,100%\)/);
  assert.doesNotMatch(css, /font-size:\s*(?:[0-9]|1[01])px/);
  assert.match(css, /@media \(prefers-reduced-motion:reduce\)/);
});

test("오늘 화면은 진행률보다 현재 실천과 완료 행동을 우선한다", async () => {
  const today = await readFile(new URL("../app/(product)/today/page.tsx", import.meta.url), "utf8");
  assert.match(today, /today-overview/);
  assert.match(today, /today-focus/);
  assert.match(today, /이 실천 완료하기/);
  assert.match(today, /setEditing/);
  assert.match(today, /PublishSheet/);
  assert.match(today, /TODO 추가/);
  assert.doesNotMatch(today, /floating-add/);
});

test("모든 시트는 앱 프레임 밖 포털과 독립 스크롤 본문을 사용한다", async () => {
  const sheet = await readFile(new URL("../components/sheet.tsx", import.meta.url), "utf8");
  assert.match(sheet, /createPortal/);
  assert.match(sheet, /document\.body/);
  assert.match(sheet, /className="sheet-body"/);
  assert.match(sheet, /setAttribute\("inert"/);
});

test("TODO 작성과 가져오기는 뭉실 전용 선택기 계약을 공유한다", async () => {
  const composer = await readFile(new URL("../components/todo-composer.tsx", import.meta.url), "utf8");
  const importer = await readFile(new URL("../app/(product)/todos/import/page.tsx", import.meta.url), "utf8");
  const options = await readFile(new URL("../lib/todo-options.ts", import.meta.url), "utf8");
  for (const source of [composer, importer]) {
    assert.match(source, /TodoSchedulePicker/);
    assert.match(source, /CategoryPicker/);
    assert.match(source, /RepeatPicker/);
    assert.doesNotMatch(source, /type="(?:date|time)"/);
    assert.doesNotMatch(source, /<select/);
  }
  for (const category of ["생활", "건강", "운동", "공부", "독서", "마음", "커리어", "취미"]) assert.match(options, new RegExp(category));
  assert.match(options, /WEEKENDS/);
  for (const mode of ["원본 유지", "반복 없이", "항목별 설정"]) assert.match(importer, new RegExp(mode));
  assert.match(importer, /repeatMode: listRepeatMode/);
});

test("TODO 작성과 편집에서 기존 루틴 묶음을 지정하거나 해제할 수 있다", async () => {
  const composer = await readFile(new URL("../components/todo-composer.tsx", import.meta.url), "utf8");
  const today = await readFile(new URL("../app/(product)/today/page.tsx", import.meta.url), "utf8");
  const todos = await readFile(new URL("../app/(product)/todos/page.tsx", import.meta.url), "utf8");
  const dto = await readFile(new URL("../../api/src/dtos.ts", import.meta.url), "utf8");
  const service = await readFile(new URL("../../api/src/mungsil.service.ts", import.meta.url), "utf8");
  for (const source of [today, todos]) assert.match(source, /lists=\{lists\.data \?\? \[\]\}/);
  assert.match(composer, /todo-list-selector/);
  assert.match(composer, /그룹 없음/);
  assert.match(composer, /aria-pressed/);
  assert.match(composer, /todoListId: todoListId \|\| null/);
  assert.match(dto, /todoListId\?: string \| null/);
  assert.match(service, /setTodoListMembership/);
  assert.match(service, /preserveDetachedSeriesMembership/);
  assert.doesNotMatch(composer, /<select/);
});

test("오늘과 TODO 화면은 루틴을 접을 수 있는 스레드형 그룹으로 표시한다", async () => {
  const group = await readFile(new URL("../components/todo-group-list.tsx", import.meta.url), "utf8");
  const routineComposer = await readFile(new URL("../components/routine-composer.tsx", import.meta.url), "utf8");
  const today = await readFile(new URL("../app/(product)/today/page.tsx", import.meta.url), "utf8");
  const todos = await readFile(new URL("../app/(product)/todos/page.tsx", import.meta.url), "utf8");
  assert.match(group, /aria-expanded/);
  assert.match(group, /seriesId/);
  assert.match(group, /다음 \$\{next\.title\}/);
  assert.match(today, /TodoGroupList/);
  assert.match(todos, /TodoGroupList/);
  assert.match(routineComposer, /다른 그룹에 포함됨/);
});

test("TODO 일정·루틴·카테고리는 밀도 높은 별도 관리 화면을 사용한다", async () => {
  const todos = await readFile(new URL("../app/(product)/todos/page.tsx", import.meta.url), "utf8");
  const routines = await readFile(new URL("../app/(product)/todos/routines/page.tsx", import.meta.url), "utf8");
  const categories = await readFile(new URL("../app/(product)/todos/categories/page.tsx", import.meta.url), "utf8");
  const nav = await readFile(new URL("../components/todo-section-nav.tsx", import.meta.url), "utf8");
  const schema = await readFile(new URL("../../api/prisma/schema.prisma", import.meta.url), "utf8");
  const service = await readFile(new URL("../../api/src/mungsil.service.ts", import.meta.url), "utf8");
  assert.match(todos, /compact-week-card/);
  assert.doesNotMatch(todos, /calendar-switch|루틴 보관함/);
  for (const label of ["일정", "루틴", "카테고리"]) assert.match(nav, new RegExp(label));
  assert.match(routines, /RoutineComposer/);
  assert.match(categories, /base-category-options/);
  assert.match(categories, /todo-categories\/reorder/);
  assert.doesNotMatch(categories, /<select|type=["']date["']|window\.confirm/);
  assert.match(schema, /model TodoCategory/);
  assert.match(schema, /categoryId\s+String\?/);
  assert.match(service, /resolveTodoCategory/);
  assert.match(service, /최대 12개/);
});

test("루틴 복제 API는 반복 유지·제거·항목별 설정을 구분한다", async () => {
  const dto = await readFile(new URL("../../api/src/dtos.ts", import.meta.url), "utf8");
  const service = await readFile(new URL("../../api/src/mungsil.service.ts", import.meta.url), "utf8");
  for (const mode of ["KEEP", "NONE", "CUSTOM"]) assert.match(dto, new RegExp(mode));
  assert.match(service, /CloneTodoListRepeatMode\.NONE/);
  assert.match(service, /CloneTodoListRepeatMode\.CUSTOM/);
  assert.match(service, /이미 다른 루틴 그룹에 담긴 TODO/);
});

test("내부 발행은 게시 용어를 사용하고 API 호환용 share 필드는 유지한다", async () => {
  const publish = await readFile(new URL("../components/publish-sheet.tsx", import.meta.url), "utf8");
  const today = await readFile(new URL("../app/(product)/today/page.tsx", import.meta.url), "utf8");
  assert.match(publish, /실천 게시하기/);
  assert.match(publish, /피드에 게시하기/);
  assert.match(publish, /aria-pressed/);
  assert.doesNotMatch(publish, /<select/);
  assert.doesNotMatch(publish, /공유/);
  assert.match(today, /share: true/);
});

test("탐색은 여러 종류의 통합 검색과 게시 해시태그를 제공한다", async () => {
  const explore = await readFile(new URL("../app/(product)/explore/search/page.tsx", import.meta.url), "utf8");
  const publish = await readFile(new URL("../components/publish-sheet.tsx", import.meta.url), "utf8");
  for (const label of ["통합", "사용자", "실천", "루틴", "해시태그", "챌린지"]) assert.match(explore, new RegExp(label));
  assert.match(explore, /mungsil_recent_searches/);
  assert.match(explore, /search\/suggestions/);
  assert.match(explore, /startsWith\("#"\)/);
  assert.match(explore, /startsWith\("@"\)/);
  assert.match(publish, /해시태그/);
  assert.match(publish, /hashtags\.length >= 5/);
});

test("기본 탐색은 미니멀 피드이고 검색과 필터를 별도 흐름으로 연다", async () => {
  const entry = await readFile(new URL("../app/(product)/explore/page.tsx", import.meta.url), "utf8");
  const feed = await readFile(new URL("../components/explore-feed.tsx", import.meta.url), "utf8");
  const card = await readFile(new URL("../components/feed-card.tsx", import.meta.url), "utf8");
  assert.match(entry, /redirect\(`\/explore\/search/);
  assert.match(feed, /href="\/explore\/search"/);
  assert.match(feed, /FeedFilterSheet/);
  assert.match(feed, /피드 필터/);
  assert.match(feed, /필터 적용/);
  assert.match(feed, /aria-pressed/);
  assert.doesNotMatch(feed, /<select/);
  for (const removed of ["SearchBox", "search-discovery", "routine-feature", "interest-row"]) assert.doesNotMatch(feed, new RegExp(removed));
  assert.match(card, /\/explore\/search\?query=/);
});

test("로컬 체험 모드는 운영 인증을 우회하지 않는다", async () => {
  const demo = await readFile(new URL("../lib/demo.ts", import.meta.url), "utf8");
  const auth = await readFile(new URL("../components/auth-screen.tsx", import.meta.url), "utf8");
  const providers = await readFile(new URL("../components/app-providers.tsx", import.meta.url), "utf8");
  assert.match(demo, /process\.env\.NODE_ENV === "development"/);
  assert.match(demo, /process\.env\.NODE_ENV === "development" && process\.env\.NEXT_PUBLIC_DEMO_ADMIN === "true"/);
  assert.match(demo, /mungsil_demo_mode/);
  assert.match(auth, /DemoEntryButton/);
  assert.match(providers, /useSyncExternalStore\(subscribeSession, isDemoMode, \(\) => false\)/);
});

test("긴 가져오기 폼의 CTA는 스크롤 흐름과 안전 영역을 지킨다", async () => {
  const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  const importSubmit = css.match(/\.import-submit\s*\{[^}]+\}/)?.[0] ?? "";
  assert.match(importSubmit, /position:sticky/);
  assert.match(importSubmit, /safe-area-inset-bottom/);
  assert.doesNotMatch(importSubmit, /position:absolute/);
});

test("UI UX 회귀 규칙과 전체 라우트 점검 문서가 저장소에 있다", async () => {
  const agents = await readFile(new URL("../../../AGENTS.md", import.meta.url), "utf8");
  const review = await readFile(new URL("../../../docs/design-system/uiux-review.md", import.meta.url), "utf8");
  for (const rule of ["360px", "position:absolute", "window.confirm", "최소 44×44px"]) {
    assert.match(agents, new RegExp(rule.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  for (const route of ["/today", "/explore", "/todos", "/challenges", "/me", "/todos/import"]) {
    assert.match(review, new RegExp(route.replaceAll("/", "\\/")));
  }
});

test("회원가입과 게시물 삭제는 브라우저 기본 UI를 사용하지 않는다", async () => {
  const auth = await readFile(new URL("../components/auth-screen.tsx", import.meta.url), "utf8");
  const controls = await readFile(new URL("../components/todo-form-controls.tsx", import.meta.url), "utf8");
  const post = await readFile(new URL("../app/(product)/posts/[id]/page.tsx", import.meta.url), "utf8");
  assert.match(auth, /BirthDatePicker/);
  assert.match(controls, /생년월일 적용/);
  assert.doesNotMatch(auth, /type=["']date["']/);
  assert.match(post, /ConfirmSheet/);
  assert.doesNotMatch(post, /window\.confirm|window\.alert|window\.prompt/);
});

test("챌린지는 전용 선택 UI와 확인 시트를 사용한다", async () => {
  const composer = await readFile(new URL("../components/challenge-composer.tsx", import.meta.url), "utf8");
  const detail = await readFile(new URL("../app/(product)/challenges/[id]/page.tsx", import.meta.url), "utf8");
  const admin = await readFile(new URL("../app/(product)/admin/reports/page.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(composer, /type=["']date["']|<select/);
  assert.doesNotMatch(admin, /<select/);
  assert.doesNotMatch(detail, /window\.confirm/);
  assert.match(composer, /DatePicker/);
  assert.match(detail, /ConfirmSheet/);
});

test("챌린지 순위·칭호·참여자 사진 인증·운영자 모니터링 흐름이 화면에 연결된다", async () => {
  const detail = await readFile(new URL("../app/(product)/challenges/[id]/page.tsx", import.meta.url), "utf8");
  const admin = await readFile(new URL("../app/(product)/admin/reports/page.tsx", import.meta.url), "utf8");
  assert.match(detail, /leaderboard/);
  assert.match(detail, /titleAwarded/);
  assert.match(detail, /VerificationQueueSheet/);
  assert.match(detail, /challenge-verifications/);
  assert.match(detail, /verification-question/);
  assert.match(detail, /판단하기 어려워요/);
  assert.match(detail, /다음 기준/);
  assert.match(detail, /같은 사진 재검증/);
  assert.match(detail, /CHALLENGE_CHECK_IN/);
  assert.match(admin, /kind="OFFICIAL"/);
  assert.match(admin, /admin\/challenge-verifications/);
  assert.match(admin, /운영자는 개별 인증을 승인하거나 반려할 수 없어요/);
  assert.match(admin, /challenge-check-ins\/\$\{report\.targetId\}\/visibility/);
  assert.doesNotMatch(admin, /review\.mutate|status:\s*"APPROVED"|status:\s*"REJECTED"/);
});

test("운영 센터는 베타 운영을 서버 셸 없이 처리하고 기본 브라우저 UI를 피한다", async () => {
  const admin = await readFile(new URL("../app/(product)/admin/reports/page.tsx", import.meta.url), "utf8");
  const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  for (const section of ["현황", "사용자", "신고·콘텐츠", "챌린지", "기록"]) assert.match(admin, new RegExp(section));
  for (const flow of ["InviteCodeSheet", "UserSuspensionSheet", "ContentVisibilitySheet", "AdminAuditLog"]) assert.match(admin, new RegExp(flow));
  for (const endpoint of ["/admin/overview", "/admin/invite-codes", "/admin/users", "/admin/content", "/admin/audit-logs"]) assert.match(admin, new RegExp(endpoint));
  assert.match(admin, /aria-pressed/);
  assert.doesNotMatch(admin, /<select|type=["']date["']|window\.confirm|window\.alert|window\.prompt/);
  assert.match(css, /\.admin-section-tabs/);
  assert.match(css, /\.admin-metric-grid/);
  assert.match(css, /\.admin-content-list/);
});

test("챌린지 참여자 대화방은 전용 집중 화면과 운영·접근성 계약을 제공한다", async () => {
  const chat = await readFile(new URL("../app/(product)/challenges/[id]/chat/page.tsx", import.meta.url), "utf8");
  const detail = await readFile(new URL("../app/(product)/challenges/[id]/page.tsx", import.meta.url), "utf8");
  const shell = await readFile(new URL("../components/app-shell.tsx", import.meta.url), "utf8");
  const admin = await readFile(new URL("../app/(product)/admin/reports/page.tsx", import.meta.url), "utf8");
  const demo = await readFile(new URL("../lib/demo.ts", import.meta.url), "utf8");
  const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  assert.match(detail, /\/challenges\/\$\{challenge\.id\}\/chat/);
  assert.match(shell, /focusMode[\s\S]*chat\$/);
  for (const feature of ["replyToId", "메시지 수정", "수정 기록", "ReactionUsersSheet", "사진은 메시지마다 최대 4장", "새 메시지", "알림 설정", "MemberModerationSheet"]) assert.match(chat, new RegExp(feature));
  assert.match(chat, /getSocketAccessToken\(true\)/);
  assert.match(chat, /ReportSheet targetType="MESSAGE"/);
  assert.doesNotMatch(chat, /window\.confirm|window\.alert|window\.prompt|<select/);
  assert.match(admin, /message-context/);
  assert.match(admin, /앞뒤 3개 메시지/);
  assert.match(demo, /chatMutes/);
  assert.match(demo, /demo-chat-book-2/);
  assert.match(css, /\.chat-composer\s*\{[^}]*position:sticky/);
  assert.match(css, /safe-area-inset-bottom/);
});

test("통합 대화함은 1대1·챌린지를 모으고 1대1 상세는 집중 화면을 제공한다", async () => {
  const inbox = await readFile(new URL("../app/(product)/messages/page.tsx", import.meta.url), "utf8");
  const chat = await readFile(new URL("../app/(product)/messages/[id]/page.tsx", import.meta.url), "utf8");
  const profile = await readFile(new URL("../app/(product)/people/[handle]/page.tsx", import.meta.url), "utf8");
  const shell = await readFile(new URL("../components/app-shell.tsx", import.meta.url), "utf8");
  const demo = await readFile(new URL("../lib/demo.ts", import.meta.url), "utf8");
  for (const feature of ["메시지 요청", "최근 대화", "direct-message-requests", "chat-inbox", "\/messages\/inbox", "CHALLENGE", "message-request-summary", "Sheet"]) assert.match(inbox, new RegExp(feature));
  for (const feature of ["replyToId", "사진은 메시지마다 최대 4장", "DirectReactionSheet", "새 메시지", "ReportSheet", "ConfirmSheet"]) assert.match(chat, new RegExp(feature));
  assert.match(profile, /DirectMessageStart/);
  assert.match(profile, /"메시지"/);
  assert.match(shell, /href="\/messages"/);
  assert.match(shell, /focusMode[\s\S]*messages/);
  assert.match(demo, /directMessages/);
  assert.match(demo, /pathname === "\/messages\/inbox"/);
  assert.doesNotMatch(chat, /window\.confirm|window\.alert|window\.prompt|<select/);
});
