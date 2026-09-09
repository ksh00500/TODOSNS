const test = require("node:test");
const assert = require("node:assert/strict");
const { cloneListRepeatRule } = require("../dist/src/mungsil.service.js");
const { CloneTodoListRepeatMode } = require("../dist/src/dtos.js");
const { readFile } = require("node:fs/promises");
const { join } = require("node:path");

test("루틴 가져오기 반복 정책을 항목별로 계산한다", () => {
  assert.equal(cloneListRepeatRule(CloneTodoListRepeatMode.KEEP, "FREQ=DAILY"), "FREQ=DAILY");
  assert.equal(cloneListRepeatRule(CloneTodoListRepeatMode.NONE, "FREQ=DAILY"), null);
  assert.equal(cloneListRepeatRule(CloneTodoListRepeatMode.CUSTOM, "FREQ=DAILY", "WEEKENDS"), "WEEKENDS");
  assert.equal(cloneListRepeatRule(CloneTodoListRepeatMode.CUSTOM, "FREQ=DAILY", null), null);
  assert.equal(cloneListRepeatRule(CloneTodoListRepeatMode.CUSTOM, "FREQ=DAILY"), "FREQ=DAILY");
});

test("삭제 TODO는 읽기와 직렬화 복제 트랜잭션 모두에서 제외한다", async () => {
  const source = await readFile(join(__dirname, "../src/mungsil.service.ts"), "utf8");
  assert.match(source, /items:\s*\{\s*where:\s*\{\s*todo:\s*\{\s*deletedAt:\s*null/);
  assert.match(source, /TransactionIsolationLevel\.Serializable/);
  assert.match(source, /삭제되었거나 가져올 수 없는 TODO/);
});
