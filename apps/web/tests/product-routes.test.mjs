import test from "node:test";
import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";

const routes = ["today", "explore", "todos", "todos/import", "challenges", "me", "notifications", "settings"];

test("상용 MVP 핵심 화면이 독립 라우트로 존재한다", async () => {
  await Promise.all(routes.map((route) => access(new URL(`../app/(product)/${route}/page.tsx`, import.meta.url))));
});

test("디자인 시스템에 제품 핵심 토큰과 모바일 프레임이 있다", async () => {
  const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  for (const token of ["--ink", "--paper", "--primary", "--blue", "--pink", "--lilac", "--mint", "--yellow"]) assert.match(css, new RegExp(token));
  assert.match(css, /\.mobile-app\s*\{/);
  assert.match(css, /width:438px/);
});

test("로컬 체험 모드는 운영 인증을 우회하지 않는다", async () => {
  const demo = await readFile(new URL("../lib/demo.ts", import.meta.url), "utf8");
  const auth = await readFile(new URL("../components/auth-screen.tsx", import.meta.url), "utf8");
  assert.match(demo, /process\.env\.NODE_ENV === "development"/);
  assert.match(demo, /mungsil_demo_mode/);
  assert.match(auth, /DemoEntryButton/);
});
