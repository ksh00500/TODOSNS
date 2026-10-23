import { readFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { test, expect } from "@playwright/test";

const fixture = JSON.parse(readFileSync(new URL("../../../../packages/test-fixtures/android-parity.json", import.meta.url), "utf8"));
const output = resolve(process.cwd(), "../../outputs/android/web-parity");

for (const width of [360, 390, 430]) {
  test(`웹 기준 화면 ${width}px — 합성 데이터`, async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width, height: width === 360 ? 800 : width === 390 ? 844 : 932 });
    await page.route("**/api/v1/**", async route => {
      const path = new URL(route.request().url()).pathname.replace(/^\/api\/v1/, "");
      const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(new Date());
      const todos = fixture.todos.map(todo => ({ ...todo, dueDate: today + todo.dueDate.slice(10) }));
      const responses = {
        "/auth/refresh": { accessToken: "synthetic-session" }, "/auth/me": fixture.user,
        "/me": fixture.profile,
        "/public/users/parity.cloud": fixture.profile,
        "/social/followers/parity-user": { items: fixture.connections, nextCursor: null },
        "/social/following/parity-user": { items: fixture.connections, nextCursor: null },
        "/todos": todos, "/todo-lists": [], "/challenges": [],
        "/me/notifications/unread-count": { count: 0 }, "/messages/unread-count": { count: 0 },
        "/feed": { items: [fixture.post], nextCursor: null },
        "/feed/posts/parity-post": fixture.post,
        "/feed/posts/parity-post/comments": { items: [], nextCursor: null },
        "/me/todo-categories": fixture.categories,
        "/public/users/parity.cloud/posts": { items: [fixture.post], nextCursor: null },
        "/public/search": fixture.searchResults,
        "/public/search/suggestions": fixture.searchSuggestions,
      };
      if (["/me", "/todos/routines"].includes(new URL(page.url()).pathname)) responses["/todo-lists"] = fixture.groups;
      await route.fulfill({ status: path in responses ? 200 : 500, contentType: "application/json", body: JSON.stringify(responses[path] ?? { message: "Unhandled synthetic path" }) });
    });
    mkdirSync(resolve(output, String(width)), { recursive: true });
    for (const [path, label, ready] of [["today", "today", "이 실천 완료하기"], ["todos", "todos", "내 TODO"], ["explore", "explore", "잠깐의 산책으로 오후를 가볍게 시작했어요."], ["posts/parity-post", "post", "잠깐의 산책으로 오후를 가볍게 시작했어요."], ["me", "me", "나의 뭉실 등급"], ["todos/routines", "groups", "가벼운 하루"], ["todos/categories", "categories", "새 카테고리"], ["people/parity.cloud", "person", "게시한 실천"], ["people/parity.cloud/connections", "connections", "산책 구름"], ["explore/search?query=실천", "search", "5개의 공개 결과를 찾았어요"]]) {
      await page.goto(`/${path}`);
      await expect(page.getByText(ready, { exact: true }).first()).toBeVisible();
      if (path === "todos") await expect(page.getByText("점심 산책 10분", { exact: true }).first()).toBeVisible();
      if (path === "me") {
        await expect(page.getByText("가벼운 하루", { exact: true })).toBeVisible();
        await expect(page.getByText("1개의 최근 기록", { exact: true })).toBeAttached();
      }
      await page.evaluate(() => document.fonts.ready);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: resolve(output, String(width), `parity-${label}.png`) });
      if (label === "groups") {
        await page.getByRole("button", { name: "루틴으로 게시", exact: true }).click();
        await expect(page.getByRole("dialog", { name: "실천 게시하기" })).toBeVisible();
        await page.screenshot({ path: resolve(output, String(width), "parity-publish.png") });
        await page.getByRole("button", { name: "닫기", exact: true }).click();
      }
    }
  });
}
