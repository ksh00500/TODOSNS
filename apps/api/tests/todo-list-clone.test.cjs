const test = require("node:test");
const assert = require("node:assert/strict");
const { cloneListRepeatRule } = require("../dist/src/mungsil.service.js");
const { CloneTodoListRepeatMode } = require("../dist/src/dtos.js");

test("루틴 가져오기 반복 정책을 항목별로 계산한다", () => {
  assert.equal(cloneListRepeatRule(CloneTodoListRepeatMode.KEEP, "FREQ=DAILY"), "FREQ=DAILY");
  assert.equal(cloneListRepeatRule(CloneTodoListRepeatMode.NONE, "FREQ=DAILY"), null);
  assert.equal(cloneListRepeatRule(CloneTodoListRepeatMode.CUSTOM, "FREQ=DAILY", "WEEKENDS"), "WEEKENDS");
  assert.equal(cloneListRepeatRule(CloneTodoListRepeatMode.CUSTOM, "FREQ=DAILY", null), null);
  assert.equal(cloneListRepeatRule(CloneTodoListRepeatMode.CUSTOM, "FREQ=DAILY"), "FREQ=DAILY");
});
