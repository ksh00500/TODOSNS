const test = require("node:test");
const assert = require("node:assert/strict");
const { randomBytes } = require("node:crypto");
const cookieParser = require("cookie-parser");
const request = require("supertest");
const { ValidationPipe } = require("@nestjs/common");
const { NestFactory } = require("@nestjs/core");
const { PrismaClient } = require("@prisma/client");
const { hash } = require("bcryptjs");
const { AppModule } = require("../dist/src/app.module.js");

const enabled = process.env.RUN_DATABASE_E2E === "1";
const runId = randomBytes(5).toString("hex");
const prefix = `settings-${runId}-`;
const prisma = new PrismaClient();
const auth = (token) => ({ Authorization: `Bearer ${token}` });

async function createUser(suffix) {
  return prisma.user.create({
    data: {
      email: `${prefix}${suffix}@mungsil.test`,
      passwordHash: await hash("Settings-password-1", 4),
      nickname: `설정${suffix}`,
      handle: `st_${suffix}_${runId}`,
      birthDate: new Date("1995-01-01T00:00:00.000Z"),
      emailVerifiedAt: new Date(),
      timezone: "Asia/Seoul",
    },
  });
}

async function login(server, email) {
  const response = await request(server)
    .post("/api/v1/auth/login")
    .send({ email, password: "Settings-password-1" })
    .expect(201);
  return response.body.accessToken;
}

test("차단 해제·알림 읽음·그룹 TODO 검색이 실제 HTTP와 DB 경계를 지킨다", { skip: !enabled }, async () => {
  const app = await NestFactory.create(AppModule, { logger: false });
  app.setGlobalPrefix("api/v1");
  app.use(cookieParser());
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }));
  await app.init();
  const server = app.getHttpServer();

  try {
    await prisma.user.deleteMany({ where: { email: { startsWith: prefix } } });
    const [userA, userB, userC] = await Promise.all([createUser("a"), createUser("b"), createUser("c")]);
    const [tokenA, tokenB] = await Promise.all([login(server, userA.email), login(server, userB.email)]);

    const conversation = await prisma.conversation.create({
      data: { kind: "DIRECT", members: { create: [{ userId: userA.id }, { userId: userB.id }] } },
    });
    const preservedMessage = await prisma.message.create({
      data: { conversationId: conversation.id, senderId: userA.id, body: "차단 해제 뒤에도 보존" },
    });
    await prisma.follow.createMany({
      data: [
        { followerId: userA.id, followingId: userB.id },
        { followerId: userB.id, followingId: userA.id },
      ],
    });

    await request(server).post("/api/v1/social/block").set(auth(tokenA)).send({ userId: userB.id }).expect(201);
    await request(server).post("/api/v1/social/block").set(auth(tokenA)).send({ userId: userC.id }).expect(201);
    await request(server).post("/api/v1/social/block").set(auth(tokenB)).send({ userId: userA.id }).expect(201);
    await prisma.user.update({ where: { id: userC.id }, data: { suspendedAt: new Date() } });

    const firstBlockPage = await request(server).get("/api/v1/social/blocks").query({ limit: 1 }).set(auth(tokenA)).expect(200);
    const secondBlockPage = await request(server).get("/api/v1/social/blocks").query({ limit: 1, cursor: firstBlockPage.body.nextCursor }).set(auth(tokenA)).expect(200);
    const ownBlockedIds = [...firstBlockPage.body.items, ...secondBlockPage.body.items].map((item) => item.userId);
    assert.deepEqual(new Set(ownBlockedIds), new Set([userB.id, userC.id]));
    assert.equal([...firstBlockPage.body.items, ...secondBlockPage.body.items].find((item) => item.userId === userC.id).user, null);
    assert.equal(ownBlockedIds.includes(userA.id), false);

    await request(server).delete(`/api/v1/social/blocks/${userB.id}`).set(auth(tokenA)).expect(200);
    await request(server).delete(`/api/v1/social/blocks/${userB.id}`).set(auth(tokenA)).expect(200);
    assert.equal(await prisma.block.count({ where: { blockerId: userB.id, blockedId: userA.id } }), 1);
    assert.equal(await prisma.follow.count({ where: { OR: [{ followerId: userA.id, followingId: userB.id }, { followerId: userB.id, followingId: userA.id }] } }), 0);
    assert.equal((await prisma.message.findUniqueOrThrow({ where: { id: preservedMessage.id } })).body, "차단 해제 뒤에도 보존");
    await request(server).post(`/api/v1/messages/${conversation.id}/messages`).set(auth(tokenA)).send({ body: "상호 차단 잔존" }).expect(403);
    await request(server).delete(`/api/v1/social/blocks/${userA.id}`).set(auth(tokenB)).expect(200);
    await request(server).post(`/api/v1/messages/${conversation.id}/messages`).set(auth(tokenA)).send({ body: "양방향 해제 뒤 전송" }).expect(201);

    const baseTime = Date.now() - 10_000;
    const [noticeOne, noticeTwo, otherNotice, futureNotice] = await Promise.all([
      prisma.notification.create({ data: { userId: userA.id, type: "SYSTEM", title: "첫 알림", body: "첫 알림", createdAt: new Date(baseTime) } }),
      prisma.notification.create({ data: { userId: userA.id, type: "SYSTEM", title: "둘째 알림", body: "둘째 알림", createdAt: new Date(baseTime + 1) } }),
      prisma.notification.create({ data: { userId: userB.id, type: "SYSTEM", title: "다른 사용자", body: "다른 사용자" } }),
      prisma.notification.create({ data: { userId: userA.id, type: "SYSTEM", title: "경계 뒤 알림", body: "경계 뒤 알림", createdAt: new Date(Date.now() + 3_600_000) } }),
    ]);

    const notificationPage = await request(server).get("/api/v1/me/notifications").query({ limit: 1 }).set(auth(tokenA)).expect(200);
    assert.equal(notificationPage.body.unreadCount, 3);
    assert.equal(await prisma.notification.count({ where: { userId: userA.id, readAt: null } }), 3);
    await request(server).post(`/api/v1/me/notifications/${noticeOne.id}/read`).set(auth(tokenA)).send({}).expect(201);
    await request(server).post(`/api/v1/me/notifications/${noticeOne.id}/read`).set(auth(tokenA)).send({}).expect(201);
    await request(server).post(`/api/v1/me/notifications/${otherNotice.id}/read`).set(auth(tokenA)).send({}).expect(404);
    assert.equal((await prisma.notification.findUniqueOrThrow({ where: { id: noticeTwo.id } })).readAt, null);
    await request(server).post("/api/v1/me/notifications/read").set(auth(tokenA)).send({}).expect(201);
    assert.notEqual((await prisma.notification.findUniqueOrThrow({ where: { id: noticeTwo.id } })).readAt, null);
    assert.equal((await prisma.notification.findUniqueOrThrow({ where: { id: futureNotice.id } })).readAt, null);
    assert.equal((await request(server).get("/api/v1/me/notifications/unread-count").set(auth(tokenA)).expect(200)).body.count, 1);

    const oldDate = new Date(Date.now() - 120 * 24 * 60 * 60 * 1000);
    const todoIds = [`${prefix}todo-a`, `${prefix}todo-b`, `${prefix}todo-c`];
    await prisma.todo.createMany({
      data: todoIds.map((id, index) => ({ id, userId: userA.id, title: `오래된 검색 TODO ${index}`, dueDate: oldDate, visibility: "PRIVATE" })),
    });
    const searchQuery = { query: "오래된 검색", from: new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString(), to: new Date().toISOString(), limit: 1 };
    const foundIds = [];
    let cursor;
    do {
      const response = await request(server).get("/api/v1/todos/search").query({ ...searchQuery, ...(cursor ? { cursor } : {}) }).set(auth(tokenA)).expect(200);
      foundIds.push(...response.body.items.map((item) => item.id));
      cursor = response.body.nextCursor;
    } while (cursor);
    assert.deepEqual(foundIds, [...todoIds].sort());
    assert.equal(new Set(foundIds).size, todoIds.length);

    const group = await request(server).post("/api/v1/todo-lists").set(auth(tokenA)).send({ title: "검색으로 만든 그룹", visibility: "PUBLIC", todoIds: [todoIds[0]] }).expect(201);
    const groupedSearch = await request(server).get("/api/v1/todos/search").query({ ...searchQuery, limit: 10 }).set(auth(tokenA)).expect(200);
    assert.equal(groupedSearch.body.items.find((item) => item.id === todoIds[0]).group.id, group.body.id);
    const renamed = await request(server).patch(`/api/v1/todo-lists/${group.body.id}`).set(auth(tokenA)).send({ title: "이름만 변경" }).expect(200);
    assert.equal(renamed.body.visibility, "PUBLIC");
    assert.deepEqual(renamed.body.items.map((item) => item.todoId), [todoIds[0]]);

    const foreignTodo = await prisma.todo.create({ data: { userId: userB.id, title: "다른 사람 TODO", dueDate: oldDate } });
    await request(server).post("/api/v1/todo-lists").set(auth(tokenA)).send({ title: "소유권 위반", todoIds: [foreignTodo.id] }).expect(403);

    const series = await prisma.todoSeries.create({ data: { userId: userA.id, title: "반복 검색", repeatRule: "DAILY", startAt: oldDate } });
    const occurrenceA = await prisma.todo.create({ data: { userId: userA.id, title: "반복 검색 A", dueDate: oldDate, kind: "ROUTINE", repeatRule: "DAILY", seriesId: series.id, occurrenceKey: `${series.id}:a` } });
    const occurrenceB = await prisma.todo.create({ data: { userId: userA.id, title: "반복 검색 B", dueDate: new Date(oldDate.getTime() + 86_400_000), kind: "ROUTINE", repeatRule: "DAILY", seriesId: series.id, occurrenceKey: `${series.id}:b` } });
    await request(server).post("/api/v1/todo-lists").set(auth(tokenA)).send({ title: "반복 그룹 A", todoIds: [occurrenceA.id] }).expect(201);
    await request(server).post("/api/v1/todo-lists").set(auth(tokenA)).send({ title: "반복 그룹 B", todoIds: [occurrenceB.id] }).expect(400);
  } finally {
    await prisma.user.deleteMany({ where: { email: { startsWith: prefix } } });
    await app.close();
    await prisma.$disconnect();
  }
});
