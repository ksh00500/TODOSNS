import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("PWA manifest has the five-tab app identity", async () => {
  const manifest = JSON.parse(await readFile(new URL("../public/manifest.webmanifest", import.meta.url), "utf8"));
  assert.equal(manifest.short_name, "뭉실");
  assert.equal(manifest.display, "standalone");
  assert.equal(manifest.lang, "ko");
});
