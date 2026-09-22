const assert = require("node:assert/strict");
const test = require("node:test");
const { NotFoundException } = require("@nestjs/common");
const { MungsilService } = require("../dist/src/mungsil.service.js");
const date = new Date("2026-09-16T09:00:00.000Z");
const serviceWith = (prisma) => new MungsilService(prisma, {}, {}, {}, {});

test("차단 목록은 본인이 만든 관계만 조회하고 커서가 같은 시각의 대상을 구분한다", async () => {
  const seen = [];
  const row = (blockedId) => ({ blockerId: "me", blockedId, createdAt: date, blocked: { id: blockedId, nickname: blockedId, handle: blockedId, avatarUrl: null, deletionRequestedAt: blockedId === "b" ? date : null, suspendedAt: null } });
  const service = serviceWith({ block: { findMany: async (query) => { seen.push(query); return query.where.OR ? [row("a")] : [row("c"), row("b"), row("a")]; } } });
  const first = await service.blocks("me", { limit: 2 });
  assert.deepEqual(first.items.map((item) => item.userId), ["c", "b"]);
  assert.equal(first.items[1].user, null);
  const second = await service.blocks("me", { limit: 2, cursor: first.nextCursor });
  assert.deepEqual(second.items.map((item) => item.userId), ["a"]);
  assert.equal(seen[0].where.blockerId, "me");
  assert.equal(seen[1].where.OR[1].blockedId.lt, "b");
});

test("해제는 내 관계만 삭제하며 반복 호출에도 팔로우와 메시지를 건드리지 않는다", async () => {
  const blocks = [{ blockerId: "me", blockedId: "them" }, { blockerId: "them", blockedId: "me" }];
  const follows = [{ followerId: "me", followingId: "them" }];
  const messages = [{ id: "old", body: "보존" }];
  const service = serviceWith({ block: { deleteMany: async ({ where }) => { const before = blocks.length; for (let i = blocks.length - 1; i >= 0; i--) if (blocks[i].blockerId === where.blockerId && blocks[i].blockedId === where.blockedId) blocks.splice(i, 1); return { count: before - blocks.length }; } } });
  await service.unblock("me", "them");
  await service.unblock("me", "them");
  await service.unblock("me", "other");
  assert.deepEqual(blocks, [{ blockerId: "them", blockedId: "me" }]);
  assert.equal(follows.length, 1);
  assert.deepEqual(messages, [{ id: "old", body: "보존" }]);
});

test("알림은 소유권을 검사하고 개별 읽음은 반복해도 안전하다", async () => {
  const rows = [{ id: "mine", userId: "me", readAt: null }, { id: "other", userId: "other", readAt: null }];
  const service = serviceWith({ notification: {
    findFirst: async ({ where }) => rows.find((row) => row.id === where.id && row.userId === where.userId) ?? null,
    updateMany: async ({ where, data }) => { for (const row of rows) if (row.id === where.id && row.userId === where.userId && !row.readAt) row.readAt = data.readAt; return { count: 1 }; },
    findUniqueOrThrow: async ({ where }) => rows.find((row) => row.id === where.id),
    count: async ({ where }) => rows.filter((row) => row.userId === where.userId && !row.readAt).length,
  } });
  await assert.rejects(service.readNotification("me", "other"), NotFoundException);
  const first = await service.readNotification("me", "mine");
  const repeat = await service.readNotification("me", "mine");
  assert.equal(first.unreadCount, 0); assert.equal(repeat.unreadCount, 0);
  assert.equal(rows[1].readAt, null);
});

test("모두 읽음은 시작 경계를 적용해 새 알림을 남긴다", async () => {
  let boundary;
  const service = serviceWith({ notification: {
    updateMany: async ({ where, data }) => { boundary = where.createdAt.lte; assert.equal(data.readAt, boundary); return { count: 2 }; },
    count: async () => 1,
  } });
  const result = await service.readNotifications("me");
  assert.equal(result.count, 2); assert.equal(result.unreadCount, 1); assert.equal(result.readAt, boundary);
});

test("TODO 제목 검색은 날짜와 ID 복합 커서로 페이지 경계를 보존한다", async () => {
  const seen = []; const todo = (id) => ({ id, dueDate: date, title: id, seriesId: null });
  const service = serviceWith({ todo: { findMany: async (query) => { seen.push(query); return query.where.OR ? [todo("c")] : [todo("a"), todo("b"), todo("c")]; } }, todoListItem: { findMany: async () => [] } });
  const query = { from: "2020-01-01", to: "2030-01-01", query: "책", limit: 2 };
  const first = await service.searchTodos("me", query);
  const second = await service.searchTodos("me", { ...query, cursor: first.nextCursor });
  assert.deepEqual(first.items.map((item) => item.id), ["a", "b"]);
  assert.deepEqual(second.items.map((item) => item.id), ["c"]);
  assert.equal(seen[1].where.OR[1].id.gt, "b");
  assert.equal(seen[0].where.userId, "me");
  assert.equal(seen[0].where.title.contains, "책");
});

test("그룹 저장은 다른 그룹의 같은 반복 시리즈를 거부한다", async () => {
  const { BadRequestException } = require("@nestjs/common");
  const prisma = { todo: { findMany: async () => [{ id: "occurrence", seriesId: "series" }] }, todoListItem: { findFirst: async ({ where }) => { assert.deepEqual(where.OR[1].todo.seriesId.in, ["series"]); return { listId: "other" }; } } };
  prisma.$transaction = async (callback) => callback(prisma);
  const service = serviceWith(prisma);
  await assert.rejects(service.createTodoList("me", { title: "새 그룹", description: "", visibility: "PRIVATE", todoIds: ["occurrence"] }), BadRequestException);
});

test("그룹 이름과 구성 편집은 기존 공개 범위를 덮어쓰지 않는다", async () => {
  let updateData;
  const prisma = {
    todo: { findMany: async () => [{ id: "todo", seriesId: null }] },
    todoListItem: { findFirst: async () => null },
    $transaction: async (callback) => callback({ todo: { findMany: async () => [{ id: "todo", seriesId: null }] }, todoListItem: { findFirst: async () => null, deleteMany: async () => ({ count: 1 }) }, todoList: { update: async ({ data }) => { updateData = data; return { id: "list", visibility: "PUBLIC" }; } } }),
  };
  const service = serviceWith(prisma);
  service.ownTodoList = async () => ({ id: "list", visibility: "PUBLIC" });
  await service.updateTodoList("me", "list", { title: "새 이름", description: "", todoIds: ["todo"] });
  assert.equal(updateData.visibility, undefined);
  assert.deepEqual(updateData.items.create, [{ todoId: "todo", order: 0 }]);
});
