const test = require("node:test");
const assert = require("node:assert/strict");
const cookieParser = require("cookie-parser");
const request = require("supertest");
const { ValidationPipe } = require("@nestjs/common");
const { NestFactory } = require("@nestjs/core");
const { PrismaClient } = require("@prisma/client");
const { hash } = require("bcryptjs");
const { createHash } = require("node:crypto");
const { AppModule } = require("../dist/src/app.module.js");

const enabled = process.env.RUN_DATABASE_E2E === "1";
const prefix = `beta-${Date.now()}-`;
const prisma = new PrismaClient();
const testInviteHash = createHash("sha256").update("ONE-TIME-BETA").digest("hex");

const auth = (token) => ({ Authorization: `Bearer ${token}` });

async function createVerifiedUser(suffix) {
  return prisma.user.create({
    data: {
      email: `${prefix}${suffix}@mungsil.test`,
      passwordHash: await hash("Beta-password-1", 4),
      nickname: `베타${suffix}`,
      handle: `${prefix}${suffix}`.replace(/[^a-z0-9._]/g, "").slice(0, 20),
      birthDate: new Date("1995-01-01T00:00:00.000Z"),
      emailVerifiedAt: new Date(),
      timezone: "Asia/Seoul",
    },
  });
}

async function login(server, email) {
  const response = await request(server)
    .post("/api/v1/auth/login")
    .send({ email, password: "Beta-password-1" })
    .expect(201);
  return { token: response.body.accessToken, cookie: response.headers["set-cookie"][0] };
}

test("두 사용자의 생성 → 완료 → 공유 → 응원·댓글 → 가져오기 → 재완료 순환", { skip: !enabled }, async () => {
  const app = await NestFactory.create(AppModule, { logger: false });
  app.setGlobalPrefix("api/v1");
  app.use(cookieParser());
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }));
  await app.init();
  const server = app.getHttpServer();

  try {
    await prisma.user.deleteMany({ where: { email: { startsWith: prefix } } });
    const [userA, userB, userCap] = await Promise.all([
      createVerifiedUser("a"),
      createVerifiedUser("b"),
      createVerifiedUser("cap"),
    ]);
    const [sessionA, sessionB, sessionCap] = await Promise.all([
      login(server, userA.email),
      login(server, userB.email),
      login(server, userCap.email),
    ]);

    const routine = await request(server)
      .post("/api/v1/todo-lists")
      .set(auth(sessionA.token))
      .send({ title: "출근 준비 루틴", todoIds: [], visibility: "PRIVATE" })
      .expect(201);
    const groupedRecurring = await request(server)
      .post("/api/v1/todos")
      .set(auth(sessionA.token))
      .send({ title: "가방 챙기기", category: "생활", dueDate: new Date(Date.now() + 300_000).toISOString(), repeatRule: "DAILY", visibility: "PRIVATE", todoListId: routine.body.id })
      .expect(201);
    let ownLists = await request(server).get("/api/v1/todo-lists").set(auth(sessionA.token)).expect(200);
    let groupedList = ownLists.body.find((item) => item.id === routine.body.id);
    assert.equal(groupedList.items.some((item) => item.todo.seriesId === groupedRecurring.body.seriesId), true);
    await request(server)
      .patch(`/api/v1/todos/${groupedRecurring.body.id}`)
      .set(auth(sessionA.token))
      .send({ todoListId: null })
      .expect(200);
    ownLists = await request(server).get("/api/v1/todo-lists").set(auth(sessionA.token)).expect(200);
    groupedList = ownLists.body.find((item) => item.id === routine.body.id);
    assert.equal(groupedList.items.some((item) => item.todo.seriesId === groupedRecurring.body.seriesId), false);

    const idempotencyKey = `todo-${Date.now()}`;
    const duplicatePayload = { title: "중복되지 않을 TODO", category: "생활", dueDate: new Date().toISOString(), visibility: "PRIVATE" };
    const firstCreate = await request(server).post("/api/v1/todos").set(auth(sessionA.token)).set("Idempotency-Key", idempotencyKey).send(duplicatePayload).expect(201);
    const replayedCreate = await request(server).post("/api/v1/todos").set(auth(sessionA.token)).set("Idempotency-Key", idempotencyKey).send(duplicatePayload).expect(201);
    assert.equal(replayedCreate.body.id, firstCreate.body.id);
    assert.equal(await prisma.todo.count({ where: { userId: userA.id, title: duplicatePayload.title } }), 1);

    const created = await request(server)
      .post("/api/v1/todos")
      .set(auth(sessionA.token))
      .send({ title: "저녁 산책 20분", category: "운동", dueDate: new Date(Date.now() + 3600_000).toISOString(), visibility: "PRIVATE" })
      .expect(201);

    const completed = await request(server)
      .post(`/api/v1/todos/${created.body.id}/complete`)
      .set(auth(sessionA.token))
      .send({ share: true, caption: "오늘도 가볍게 걸었어요.", visibility: "PUBLIC" })
      .expect(201);
    assert.equal(completed.body.todo.completedAt != null, true);
    const postId = completed.body.post.id;

    await request(server).post(`/api/v1/feed/posts/${postId}/cheer`).set(auth(sessionB.token)).send({}).expect(201);
    await request(server).post(`/api/v1/feed/posts/${postId}/comments`).set(auth(sessionB.token)).send({ body: "저도 오늘 따라 걸어볼게요!" }).expect(201);
    const copied = await request(server)
      .post(`/api/v1/todos/${created.body.id}/clone`)
      .set(auth(sessionB.token))
      .send({ dueDate: new Date(Date.now() + 7200_000).toISOString(), keepRepeat: true })
      .expect(201);
    assert.equal(copied.body.sourceTodoId, created.body.id);
    await request(server).post(`/api/v1/todos/${copied.body.id}/complete`).set(auth(sessionB.token)).send({ share: false }).expect(201);

    const detail = await request(server).get(`/api/v1/public/posts/${postId}`).expect(200);
    assert.equal(detail.body.cheerCount, 1);
    assert.equal(detail.body.commentCount, 1);
    const notices = await request(server).get("/api/v1/me/notifications?limit=20").set(auth(sessionA.token)).expect(200);
    assert.equal(notices.body.items.some((item) => item.targetType === "POST" && item.targetId === postId), true);

    const privateTodo = await request(server)
      .post("/api/v1/todos")
      .set(auth(sessionA.token))
      .send({ title: "공개하지 않은 일", category: "생활", dueDate: new Date().toISOString(), visibility: "PRIVATE" })
      .expect(201);
    await request(server).post(`/api/v1/todos/${privateTodo.body.id}/clone`).set(auth(sessionB.token)).send({}).expect(404);
    await request(server).post("/api/v1/social/block").set(auth(sessionB.token)).send({ userId: userA.id }).expect(201);
    await request(server).get(`/api/v1/public/posts/${postId}`).set(auth(sessionB.token)).expect(404);

    for (let index = 0; index < 6; index += 1) {
      const todo = await request(server)
        .post("/api/v1/todos")
        .set(auth(sessionCap.token))
        .send({ title: `상한 확인 ${index}`, category: "생활", dueDate: new Date(Date.now() + index * 60_000).toISOString(), visibility: "PRIVATE" })
        .expect(201);
      await request(server).post(`/api/v1/todos/${todo.body.id}/complete`).set(auth(sessionCap.token)).send({ share: false }).expect(201);
    }
    const capped = await prisma.user.findUniqueOrThrow({ where: { id: userCap.id } });
    assert.equal(capped.lifetimePower, 50);

    const firstRefresh = await request(server).post("/api/v1/auth/refresh").set("Cookie", sessionCap.cookie).send({}).expect(201);
    const rotatedCookie = firstRefresh.headers["set-cookie"][0];
    await request(server).post("/api/v1/auth/refresh").set("Cookie", sessionCap.cookie).send({}).expect(401);
    await request(server).post("/api/v1/auth/refresh").set("Cookie", rotatedCookie).send({}).expect(401);

    process.env.INVITE_REQUIRED = "true";
    const inviteCode = "ONE-TIME-BETA";
    await prisma.inviteCode.create({ data: { codeHash: testInviteHash, label: prefix, maxUses: 1 } });
    await request(server).post("/api/v1/auth/signup").send({ email: `${prefix}invite1@mungsil.test`, password: "Beta-password-1", nickname: "초대회원", handle: `${prefix}invite1`.slice(0, 20), birthDate: "1995-01-01", inviteCode }).expect(201);
    await request(server).post("/api/v1/auth/signup").send({ email: `${prefix}invite2@mungsil.test`, password: "Beta-password-1", nickname: "초대실패", handle: `${prefix}invite2`.slice(0, 20), birthDate: "1995-01-01", inviteCode }).expect(400);
  } finally {
    process.env.INVITE_REQUIRED = "false";
    await prisma.user.deleteMany({ where: { email: { startsWith: prefix } } });
    await prisma.inviteCode.deleteMany({ where: { codeHash: testInviteHash } });
    await app.close();
    await prisma.$disconnect();
  }
});
