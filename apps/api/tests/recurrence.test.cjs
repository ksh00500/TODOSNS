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

test("90일 뒤 시작하는 반복도 첫 발생과 이후 60일을 생성한다", async () => {
  const created = [];
  const startAt = new Date(Date.now() + 90 * 86_400_000);
  const tx = {
    todoSeries: {
      create: async ({ data }) => ({ id: "future", generatedThrough: null, endsAt: null, active: true, ...data }),
      update: async () => ({}),
    },
    todo: {
      createMany: async ({ data }) => { created.push(...data); },
      findFirstOrThrow: async () => created[0],
    },
  };
  const recurrence = new RecurrenceService({ $transaction: (callback) => callback(tx) });
  const first = await recurrence.createSeries("u", "Asia/Seoul", { title: "future", dueDate: startAt.toISOString(), repeatRule: "DAILY", category: "생활", visibility: "PRIVATE" });
  assert.ok(created.length >= 60);
  assert.equal(first.dueDate.toISOString(), startAt.toISOString());
});

test("활성 반복 시리즈를 500개에서 자르지 않고 안정된 커서로 모두 연장한다", async () => {
  const target = new Date(Date.now() + 59 * 86_400_000);
  const all = Array.from({ length: 501 }, (_, index) => ({ id: String(index).padStart(3, "0"), userId: "u", title: "t", notes: null, category: "생활", categoryId: null, visibility: "PRIVATE", repeatRule: "FREQ=DAILY", timezone: "UTC", startAt: new Date(), generatedThrough: target, endsAt: null, active: true }));
  const pages = [];
  const processed = [];
  const prisma = {
    todoSeries: { findMany: async (query) => { const start = query.cursor ? all.findIndex((item) => item.id === query.cursor.id) + 1 : 0; const page = all.slice(start, start + query.take); pages.push(page.length); return page; } },
    $transaction: async (callback) => callback({ todo: { createMany: async () => ({}) }, todoSeries: { update: async ({ where }) => { processed.push(where.id); } } }),
  };
  await new RecurrenceService(prisma).extendActiveSeries();
  assert.deepEqual(pages, [200, 200, 101]);
  assert.equal(new Set(processed).size, 501);
});
