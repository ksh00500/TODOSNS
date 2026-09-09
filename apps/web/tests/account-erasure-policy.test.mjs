import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("탈퇴 확인 UI는 7일 유예를 약속하지 않고 즉시 접근 중단과 삭제 시작을 알린다", async () => {
  const source = await readFile(new URL("../app/(product)/settings/page.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(source, /7일/);
  assert.match(source, /확정 즉시 이용이 중단되고 삭제 절차가 시작돼요/);
  assert.match(source, /탈퇴 확정 및 삭제 시작/);
});
