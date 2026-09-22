const assert = require("node:assert/strict");
const test = require("node:test");
const { BadRequestException } = require("@nestjs/common");
const { TodoCategoryService } = require("../dist/src/todo-category.service.js");

const dueDate = new Date("2026-09-16T09:00:00.000Z");
const todo = (id) => ({ id, dueDate, completedAt: null, categoryRef: null });

function harness() {
  const queries = [];
  const prisma = {
    todoCategory: { findFirst: async () => ({ id: "category", name: "생활", isDefault: false }) },
    todo: {
      findMany: async (query) => {
        queries.push(query);
        return query.where.AND ? [todo("c")] : [todo("a"), todo("b"), todo("c")];
      },
      count: async ({ where }) => where.completedAt === null ? 3 : where.completedAt?.not === null ? 2 : 5,
    },
  };
  const service = new TodoCategoryService(prisma);
  service.ensureDefaults = async () => undefined;
  return { service, queries };
}

test("카테고리 TODO 커서는 같은 시각의 id를 기준으로 다음 페이지 중복을 막는다", async () => {
  const { service, queries } = harness();
  const first = await service.listTodos("user", "category", { limit: 2 }, "OPEN");
  assert.deepEqual(first.items.map((item) => item.id), ["a", "b"]);
  assert.deepEqual(first.counts, { all: 5, open: 3, done: 2 });
  assert.ok(first.nextCursor);

  const second = await service.listTodos("user", "category", { limit: 2, cursor: first.nextCursor }, "OPEN");
  assert.deepEqual(second.items.map((item) => item.id), ["c"]);
  assert.equal(second.nextCursor, null);
  assert.equal(queries[1].where.AND[0].OR[1].id.gt, "b");
  assert.deepEqual(queries[1].orderBy, [{ dueDate: "asc" }, { id: "asc" }]);
});

test("카테고리 TODO는 알 수 없는 상태와 손상된 커서를 실행 전에 거부한다", async () => {
  const { service, queries } = harness();
  await assert.rejects(() => service.listTodos("user", "category", { limit: 30 }, "UNKNOWN"), BadRequestException);
  await assert.rejects(() => service.listTodos("user", "category", { limit: 30, cursor: "broken" }, "ALL"), BadRequestException);
  assert.equal(queries.length, 0);
});

test("카테고리 도메인과 이전 1:1 구현은 거대 서비스에서 분리되어 있다", async () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const mungsil = fs.readFileSync(path.join(__dirname, "../src/mungsil.service.ts"), "utf8");
  const controllers = fs.readFileSync(path.join(__dirname, "../src/controllers.ts"), "utf8");
  assert.doesNotMatch(mungsil, /listTodoCategories|createTodoCategory|async requestMessage|async sendMessage/);
  assert.match(controllers, /TodoCategoryService/);
});
