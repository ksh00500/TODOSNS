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
const runId = randomBytes(6).toString("hex");
const prefix = `direct-chat-${runId}-`;
const handles = Object.freeze({
  a: `dc_a_${runId}`,
  b: `dc_b_${runId}`,
  outsider: `dc_o_${runId}`,
});
const generatedHandles = Object.values(handles);
assert.equal(new Set(generatedHandles).size, generatedHandles.length, "direct-chat E2E handles must be unique before database setup");
for (const handle of generatedHandles) {
  assert.match(handle, /^[a-z0-9._]{3,20}$/, `invalid direct-chat E2E handle: ${handle}`);
}
const prisma = new PrismaClient();
const auth = (token) => ({ Authorization: `Bearer ${token}` });

test("1:1 E2E 합성 handle은 DB 연결 전에 유효하고 고유하다", () => {
  assert.equal(new Set(generatedHandles).size, generatedHandles.length);
  assert.equal(generatedHandles.every((handle) => handle.length <= 20), true);
});

async function createVerifiedUser(suffix) {
  return prisma.user.create({
    data: {
      email: `${prefix}${suffix}@mungsil.test`,
      passwordHash: await hash("Direct-chat-password-1", 4),
      nickname: `대화${suffix}`,
      handle: handles[suffix],
      birthDate: new Date("1995-01-01T00:00:00.000Z"),
      emailVerifiedAt: new Date(),
      timezone: "Asia/Seoul",
    },
  });
}

async function login(server, email) {
  const response = await request(server)
    .post("/api/v1/auth/login")
    .send({ email, password: "Direct-chat-password-1" })
    .expect(201);
  return response.body.accessToken;
}

test("1:1 요청 → 수락 → 전송 → 읽음 → 차단 뒤 모든 내용 변경 거부와 기록 보존", { skip: !enabled }, async () => {
  const app = await NestFactory.create(AppModule, { logger: false });
  app.setGlobalPrefix("api/v1");
  app.use(cookieParser());
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }));
  await app.init();
  const server = app.getHttpServer();

  try {
    await prisma.user.deleteMany({ where: { email: { startsWith: prefix } } });
    const [userA, userB, outsider] = await Promise.all([
      createVerifiedUser("a"),
      createVerifiedUser("b"),
      createVerifiedUser("outsider"),
    ]);
    const [tokenA, tokenB, tokenOutsider] = await Promise.all([
      login(server, userA.email),
      login(server, userB.email),
      login(server, outsider.email),
    ]);

    const requested = await request(server)
      .post("/api/v1/messages/requests")
      .set(auth(tokenA))
      .send({ receiverId: userB.id })
      .expect(201);
    assert.equal(requested.body.kind, "REQUEST");

    const accepted = await request(server)
      .post(`/api/v1/messages/requests/${requested.body.requestId}/accept`)
      .set(auth(tokenB))
      .send({})
      .expect(201);
    const conversationId = accepted.body.conversationId;

    const first = await request(server)
      .post(`/api/v1/messages/${conversationId}/messages`)
      .set(auth(tokenA))
      .send({ body: "차단 뒤에도 보존할 메시지" })
      .expect(201);
    const reply = await request(server)
      .post(`/api/v1/messages/${conversationId}/messages`)
      .set(auth(tokenB))
      .send({ body: "정상 답장", replyToId: first.body.id })
      .expect(201);
    await request(server)
      .post(`/api/v1/messages/${conversationId}/read`)
      .set(auth(tokenB))
      .send({ messageId: first.body.id })
      .expect(201);

    const removable = await request(server)
      .post(`/api/v1/messages/${conversationId}/messages`)
      .set(auth(tokenA))
      .send({ body: "차단 전 삭제 가능" })
      .expect(201);
    await request(server)
      .delete(`/api/v1/messages/${conversationId}/messages/${removable.body.id}`)
      .set(auth(tokenA))
      .expect(200);

    for (const attempt of [
      () => request(server).get(`/api/v1/messages/${conversationId}`).set(auth(tokenOutsider)).expect(404),
      () => request(server).post(`/api/v1/messages/${conversationId}/messages`).set(auth(tokenOutsider)).send({ body: "침입" }).expect(404),
      () => request(server).post(`/api/v1/messages/${conversationId}/messages/${first.body.id}/reactions`).set(auth(tokenOutsider)).send({ type: "CHEER" }).expect(404),
      () => request(server).delete(`/api/v1/messages/${conversationId}/messages/${first.body.id}`).set(auth(tokenOutsider)).expect(404),
    ]) await attempt();

    await request(server)
      .post("/api/v1/social/block")
      .set(auth(tokenB))
      .send({ userId: userA.id })
      .expect(201);

    const blockedPage = await request(server)
      .get(`/api/v1/messages/${conversationId}?limit=30`)
      .set(auth(tokenA))
      .expect(200);
    const preserved = blockedPage.body.items.find((message) => message.id === first.body.id);
    assert.equal(blockedPage.body.room.canSend, false);
    assert.equal(preserved.isMine, true);
    assert.equal(preserved.canDelete, false);
    assert.equal(preserved.body, "차단 뒤에도 보존할 메시지");

    await request(server).post(`/api/v1/messages/${conversationId}/messages`).set(auth(tokenA)).send({ body: "차단 뒤 전송" }).expect(403);
    await request(server).post(`/api/v1/messages/${conversationId}/messages`).set(auth(tokenA)).send({ body: "차단 뒤 답장", replyToId: reply.body.id }).expect(403);
    await request(server).post(`/api/v1/messages/${conversationId}/messages/${reply.body.id}/reactions`).set(auth(tokenA)).send({ type: "CHEER" }).expect(403);
    await request(server).delete(`/api/v1/messages/${conversationId}/messages/${first.body.id}`).set(auth(tokenA)).expect(403);
    await request(server).post(`/api/v1/messages/${conversationId}/read`).set(auth(tokenA)).send({ messageId: reply.body.id }).expect(201);

    const stored = await prisma.message.findUniqueOrThrow({ where: { id: first.body.id } });
    assert.equal(stored.deletedAt, null);
    assert.equal(stored.body, "차단 뒤에도 보존할 메시지");

    const outsiderRequest = await request(server)
      .post("/api/v1/messages/requests")
      .set(auth(tokenOutsider))
      .send({ receiverId: userA.id })
      .expect(201);
    await request(server).post("/api/v1/social/block").set(auth(tokenA)).send({ userId: outsider.id }).expect(201);
    await request(server)
      .post(`/api/v1/messages/requests/${outsiderRequest.body.requestId}/accept`)
      .set(auth(tokenA))
      .send({})
      .expect(403);
    const pending = await prisma.messageRequest.findUniqueOrThrow({ where: { id: outsiderRequest.body.requestId } });
    assert.equal(pending.status, "PENDING");
  } finally {
    await prisma.user.deleteMany({ where: { email: { startsWith: prefix } } });
    await app.close();
    await prisma.$disconnect();
  }
});
