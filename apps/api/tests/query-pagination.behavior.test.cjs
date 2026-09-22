const assert = require("node:assert/strict");
const test = require("node:test");
const { BadRequestException } = require("@nestjs/common");
const { MungsilService } = require("../dist/src/mungsil.service.js");

const createdAt = new Date("2026-09-16T09:00:00.000Z");
const author = { id: "author", nickname: "작성자", handle: "author", avatarUrl: null, avatarMedia: null, lifetimePower: 0 };
const comment = (id) => ({ id, postId: "post", body: id, createdAt, author });

function serviceWith(prisma) {
  const service = new MungsilService(prisma, { viewUrl: async () => null }, {}, {}, {});
  service.readablePost = async () => ({ id: "post" });
  service.blockedUserIds = async () => [];
  return service;
}

test("댓글 커서는 같은 시각의 id를 기준으로 다음 페이지 중복을 막는다", async () => {
  const queries = [];
  const prisma = {
    comment: {
      findMany: async (query) => {
        queries.push(query);
        return query.where.OR ? [comment("c")] : [comment("a"), comment("b"), comment("c")];
      },
    },
  };
  const service = serviceWith(prisma);
  const first = await service.postComments("post", "viewer", { limit: 2 });
  assert.deepEqual(first.items.map((item) => item.id), ["a", "b"]);
  assert.ok(first.nextCursor);

  const second = await service.postComments("post", "viewer", { limit: 2, cursor: first.nextCursor });
  assert.deepEqual(second.items.map((item) => item.id), ["c"]);
  assert.equal(second.nextCursor, null);
  assert.deepEqual(queries[1].orderBy, [{ createdAt: "asc" }, { id: "asc" }]);
  assert.equal(queries[1].where.OR[1].id.gt, "b");
});

test("TODO 조회는 유효한 날짜 범위를 요구하고 선택 날짜 항목을 제한 없이 반환한다", async () => {
  let query;
  const prisma = { todo: { findMany: async (value) => { query = value; return [{ id: "todo" }]; } } };
  const service = serviceWith(prisma);
  assert.throws(() => service.listTodos("user"), BadRequestException);
  assert.throws(() => service.listTodos("user", "invalid", "2026-09-17"), BadRequestException);
  assert.throws(() => service.listTodos("user", "2026-09-17", "2026-09-16"), BadRequestException);
  assert.throws(() => service.listTodos("user", "2025-01-01", "2026-09-16"), BadRequestException);

  const result = await service.listTodos("user", "2026-09-16T00:00:00.000Z", "2026-09-16T23:59:59.999Z");
  assert.equal(result.length, 1);
  assert.equal(query.take, undefined);
  assert.deepEqual(query.orderBy, [{ completedAt: "asc" }, { dueDate: "asc" }, { id: "asc" }]);
});

test("TODO 그룹과 내부 항목은 제한 없이 안정적인 보조 키로 정렬한다", async () => {
  let query;
  const prisma = { todoList: { findMany: async (value) => { query = value; return []; } } };
  const service = serviceWith(prisma);

  await service.listTodoLists("user");

  assert.equal(query.take, undefined);
  assert.deepEqual(query.orderBy, [{ updatedAt: "desc" }, { id: "desc" }]);
  assert.equal(query.include.items.take, undefined);
  assert.deepEqual(query.include.items.orderBy, [{ order: "asc" }, { todoId: "asc" }]);
});
