const test = require("node:test");
const assert = require("node:assert/strict");
const { RecurrenceService } = require("../dist/src/recurrence.service.js");

test("반복 규칙을 하나의 계약으로 정규화한다", () => {
  const recurrence = new RecurrenceService({});
  assert.equal(recurrence.normalizeRule("DAILY"), "FREQ=DAILY");
  assert.equal(recurrence.normalizeRule("WEEKDAYS"), "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR");
  assert.equal(recurrence.normalizeRule("WEEKENDS"), "FREQ=WEEKLY;BYDAY=SA,SU");
  assert.equal(recurrence.normalizeRule("FREQ=WEEKLY;BYDAY=MO,WE,FR"), "FREQ=WEEKLY;BYDAY=MO,WE,FR");
  assert.throws(() => recurrence.normalizeRule("EVERY OTHER DAY"));
});

test("주말 반복은 토요일과 일요일만 선택한다", () => {
  const recurrence = new RecurrenceService({});
  const rule = recurrence.normalizeRule("WEEKENDS");
  const parsed = recurrence.parseRule(rule, new Date("2026-08-29T00:00:00.000Z"), "UTC");
  assert.deepEqual(parsed, { frequency: "WEEKLY", days: ["SA", "SU"] });
});

test("사용자 시간대의 오전 9시를 정확한 UTC 시각으로 변환한다", () => {
  const recurrence = new RecurrenceService({});
  assert.equal(recurrence.zonedDate(2026, 7, 28, 9, 0, 0, "Asia/Seoul").toISOString(), "2026-07-28T00:00:00.000Z");
  assert.equal(recurrence.zonedDate(2026, 7, 28, 9, 0, 0, "America/New_York").toISOString(), "2026-07-28T13:00:00.000Z");
});
