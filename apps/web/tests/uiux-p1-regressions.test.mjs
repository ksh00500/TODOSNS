import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("공통 Sheet는 하나의 레이어 스택과 마지막 잠금 해제를 사용한다", async () => {
  const sheet = await source("../components/sheet.tsx");
  assert.match(sheet, /const sheetLayers/);
  assert.match(sheet, /isTopSheet\(id\)/);
  assert.match(sheet, /if \(!sheetLayers\.length\) unlockApp\(\)/);
  assert.match(sheet, /isUsableReturnFocus\(previous\)/);
  assert.match(sheet, /app-content/);
  assert.match(sheet, /stopImmediatePropagation/);
});

test("메시지 삭제 확인은 메뉴 시트와 동시에 열리지 않는다", async () => {
  for (const path of [
    "../app/(product)/messages/[id]/page.tsx",
    "../app/(product)/challenges/[id]/chat/page.tsx",
  ]) {
    const chat = await source(path);
    assert.match(chat, /onDelete=\{\(\) => \{ setDeleting\(menuFor\); setMenuFor\(null\); \}\}/);
  }
});

test("낮은 창과 중간 폭에서도 430px 프레임과 도달 가능한 높이를 유지한다", async () => {
  const css = await source("../app/globals.css");
  const frame = css.match(/\.mobile-app\s*\{[^}]+\}/)?.[0] ?? "";
  assert.match(frame, /width:min\(430px,100%\)/);
  assert.match(frame, /min-height:min\(700px,calc\(100dvh - 40px\)\)/);
  assert.doesNotMatch(css, /@media \(max-width:700px\)[\s\S]*?\.mobile-app\s*\{[^}]*width:100%/);
});

test("피드 행동은 맥락 있는 접근성 이름과 선택 상태를 제공한다", async () => {
  const card = await source("../components/feed-card.tsx");
  assert.match(card, /님의 프로필/);
  assert.match(card, /응원하기/);
  assert.match(card, /응원 취소/);
  assert.match(card, /aria-pressed=\{post\.cheered\}/);
  assert.match(card, /댓글 \$\{post\.commentCount\}개 보기/);
});

test("가져오기 모드 왕복은 항목 초안을 재생성하지 않고 명시적 초기화만 제공한다", async () => {
  const importer = await source("../app/(product)/todos/import/page.tsx");
  const chooseMode = importer.match(/const chooseListRepeatMode[\s\S]*?\n  \};/)?.[0] ?? "";
  assert.doesNotMatch(chooseMode, /setItemDrafts/);
  assert.match(importer, /const resetItemDrafts/);
  assert.match(importer, /원본으로 초기화/);
  assert.match(importer, /repeatEdited \? item\.repeatRule \|\| null : item\.originalRepeatRule/);
});

test("관계 조회 실패와 HTTP 오류는 데이터 손실 없는 상태로 구분한다", async () => {
  const composer = await source("../components/todo-composer.tsx");
  const api = await source("../lib/api.ts");
  assert.match(composer, /listsStatus === "ready" \? \{ todoListId/);
  assert.match(composer, /categories\.isSuccess \? \{ category, categoryId/);
  assert.match(composer, /기존 관계는 바꾸지 않아요/);
  for (const status of [401, 403, 404, 409, 429, 500]) assert.match(api, new RegExp(`status (?:>=|===) ${status}`));
  assert.match(api, /serverMessage !== "Internal server error"/);
});

test("날짜와 시간 선택 뒤 트리거 포커스를 복구하고 선택 위치를 맞춘다", async () => {
  const controls = await source("../components/todo-form-controls.tsx");
  assert.match(controls, /triggerRef\.current\?\.focus/);
  assert.match(controls, /closePicker\(dateTriggerRef\)/);
  assert.match(controls, /closePicker\(timeTriggerRef\)/);
  assert.match(controls, /selectedHourRef\.current\?\.scrollIntoView/);
  assert.match(controls, /role="option" aria-selected/);
});

test("프로젝트 터치 타깃과 공통 보조 버튼은 최소 44px이다", async () => {
  const css = await source("../app/globals.css");
  assert.match(css, /\.chat-message-menu \{ width:44px; height:44px/);
  assert.match(css, /^\.chat-message-actions\s*\{[^}]*min-height:44px/m);
  assert.match(css, /\.chat-reactions button\s*\{[^}]*min-height:44px/);
  assert.match(css, /\.secondary-button\s*\{[^}]*min-height:52px/);
  assert.match(css, /\.avatar\s*\{[^}]*width:44px; height:44px/);
  assert.match(css, /\.calendar-grid button\s*\{[^}]*min-width:44px; min-height:44px/);
  assert.match(css, /\.schedule-picker\s*\{ width:calc\(100% \+ 8px\)/);
});

test("게시와 사진 인증은 미리보기·제거·업로드 재사용·이탈 확인을 제공한다", async () => {
  const publish = await source("../components/publish-sheet.tsx");
  const challenge = await source("../app/(product)/challenges/[id]/page.tsx");
  for (const content of [publish, challenge]) {
    assert.match(content, /uploadedMediaId/);
    assert.match(content, /!mediaId/);
    assert.match(content, /미리보기/);
    assert.match(content, /사진 제거/);
    assert.match(content, /discardOpen/);
  }
});

test("반복 종료와 변경 이탈은 전용 확인 시트를 거친다", async () => {
  const composer = await source("../components/todo-composer.tsx");
  assert.match(composer, /setConfirmation\("end"\)/);
  assert.match(composer, /이 날짜 이후 반복을 종료할까요/);
  assert.match(composer, /이미 지난 일정과 완료 기록은 유지돼요/);
  assert.match(composer, /setConfirmation\("discard"\)/);
  assert.match(composer, /aria-pressed=\{recurrenceScope === "FUTURE"\}/);
});

test("채팅은 렌더된 마지막 메시지 기준으로 신규 수와 읽음 캐시를 맞춘다", async () => {
  for (const path of [
    "../app/(product)/messages/[id]/page.tsx",
    "../app/(product)/challenges/[id]/chat/page.tsx",
  ]) {
    const chat = await source(path);
    assert.match(chat, /lastMessageIdRef/);
    assert.match(chat, /items\.findIndex\(\(item\) => item\.id === previousId\)/);
    assert.match(chat, /nearBottomRef/);
    assert.match(chat, /queryKey: \["chat-inbox"\]/);
    assert.doesNotMatch(chat, /className="chat-messages" aria-live/);
    assert.match(chat, /draftVersionRef\.current === draft\.version/);
  }
});
