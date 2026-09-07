const test = require("node:test");
const assert = require("node:assert/strict");
const { readFile } = require("node:fs/promises");
const { resolve } = require("node:path");

test("초대 코드 생성과 사용은 같은 대문자 정규화 규칙을 사용한다", async () => {
  const [seed, auth] = await Promise.all([
    readFile(resolve(__dirname, "../prisma/seed.cjs"), "utf8"),
    readFile(resolve(__dirname, "../src/auth.ts"), "utf8"),
  ]);

  assert.match(seed, /inviteCode\.trim\(\)\.toUpperCase\(\)/);
  assert.match(seed, /update\(normalizedInviteCode\)/);
  assert.match(auth, /rawCode\.trim\(\)\.toUpperCase\(\)/);
});

test("운영 시드는 데모 데이터 생성을 명시적으로 켠 경우에만 허용한다", async () => {
  const seed = await readFile(resolve(__dirname, "../prisma/seed.cjs"), "utf8");

  assert.match(seed, /process\.env\.SEED_DEMO_DATA === "true"/);
  assert.match(seed, /if \(!seedDemoData\) return;/);
});
