import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("PWA manifest has the five-tab app identity", async () => {
  const manifest = JSON.parse(await readFile(new URL("../public/manifest.webmanifest", import.meta.url), "utf8"));
  assert.equal(manifest.short_name, "뭉실");
  assert.equal(manifest.display, "standalone");
  assert.equal(manifest.lang, "ko");
  assert.equal(manifest.icons.some((icon) => icon.sizes === "512x512"), true);
});

test("서비스 워커는 변경 요청을 캐시하거나 큐에 넣지 않는다", async () => {
  const worker = await readFile(new URL("../public/sw.js", import.meta.url), "utf8");
  assert.match(worker, /request\.method !== "GET"/);
  assert.match(worker, /url\.pathname\.startsWith\("\/api\/"\)/);
});
