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
