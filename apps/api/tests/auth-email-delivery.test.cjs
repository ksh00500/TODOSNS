const test = require("node:test");
const assert = require("node:assert/strict");
const { readFile } = require("node:fs/promises");
const { resolve } = require("node:path");

test("인증 메일 장애가 생성된 계정을 500 응답으로 숨기지 않는다", async () => {
  const [auth, contract, screen] = await Promise.all([
    readFile(resolve(__dirname, "../src/auth.ts"), "utf8"),
    readFile(resolve(__dirname, "../../../packages/contracts/src/index.ts"), "utf8"),
    readFile(resolve(__dirname, "../../web/components/auth-screen.tsx"), "utf8"),
  ]);

  assert.match(auth, /const verificationEmailSent = await this\.deliverEmail/);
  assert.match(auth, /requiresVerification: true as const, verificationEmailSent/);
  assert.match(auth, /auth\.email_delivery_failed/);
  assert.match(contract, /verificationEmailSent: boolean/);
  assert.match(screen, /sent=\$\{sent\}/);
});
