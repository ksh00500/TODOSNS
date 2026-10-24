const test = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const cookieParser = require("cookie-parser");
const { randomBytes, createHash } = require("node:crypto");
const { hash } = require("bcryptjs");
const { ValidationPipe } = require("@nestjs/common");
const { NestFactory } = require("@nestjs/core");
const { SchedulerRegistry } = require("@nestjs/schedule");
const { PrismaClient } = require("@prisma/client");
const { AppModule } = require("../dist/src/app.module.js");
const { PrismaService } = require("../dist/src/prisma.service.js");

const enabled = process.env.RUN_DATABASE_E2E === "1";
function latch() { let release; const promise = new Promise((resolve) => { release = resolve; }); return { promise, release }; }
async function bounded(promise) {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(Error("Scheduling boundary was not reached")), 3000); })]); }
  finally { clearTimeout(timer); }
}
test("응원 결과 정리는 만료·지연된 원래 요청의 재반전을 막는다", { skip: !enabled }, async (t) => {
  const db = new PrismaClient();
  const app = await NestFactory.create(AppModule, { logger: false });
  app.setGlobalPrefix("api/v1"); app.use(cookieParser());
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }));
  const run = randomBytes(5).toString("hex"); const prefix = `m10-${run}-`;
  const password = randomBytes(20).toString("hex");
  const users = []; const tokens = [];
  try {
    await app.init();
    for (const job of app.get(SchedulerRegistry).getCronJobs().values()) job.stop();
    const server = app.getHttpServer(); const appDb = app.get(PrismaService);
    for (const name of ["a", "b", "c"]) {
      const user = await db.user.create({ data: { email: `${prefix}${name}@example.test`, handle: `m10.${name}.${run}`, nickname: `합성 ${name}`,
        passwordHash: await hash(password, 4), birthDate: new Date("1995-01-01T00:00:00Z"), emailVerifiedAt: new Date(), onboardingCompletedAt: new Date() } });
      users.push(user);
      const login = await request(server).post("/api/v1/auth/login").send({ email: user.email, password }).expect(201);
      tokens.push(login.body.accessToken);
    }
    const auth = (index) => ({ Authorization: `Bearer ${tokens[index]}` });
    async function fixture(visibility = "PUBLIC") {
      const todo = await db.todo.create({ data: { userId: users[0].id, title: "합성 응원 원본", dueDate: new Date(), completedAt: new Date(), visibility: "PRIVATE" } });
      return (await request(server).post("/api/v1/feed/posts").set(auth(0)).send({ todoId: todo.id, visibility }).expect(201)).body;
    }
    const route = (id) => `/api/v1/feed/posts/${id}/cheer`;
    const receiptRoute = (id) => `POST:${route(id)}`;
    const toggle = (post, key) => request(server).post(route(post.id)).set(auth(1)).set("Idempotency-Key", key).send({});
    const resolve = (post, key, index = 1) => request(server).post(`${route(post.id)}/result`).set(auth(index)).send({ requestKey: key });
    async function expired(post, key) {
      await db.idempotencyKey.create({ data: { userId: users[1].id, key, route: receiptRoute(post.id), requestHash: createHash("sha256").update("{}").digest("hex"), expiresAt: new Date(Date.now() - 1000) } });
    }
    await t.test("완료된 응원은 다시 반전하지 않고 현재 상태를 반환한다", async () => {
      const post = await fixture(); const key = `done-${run}`;
      await toggle(post,key).expect(201);
      const result = await resolve(post,key).expect(201);
      assert.deepEqual(result.body,{ status: "RECONCILED", postId: post.id, cheered: true, cheerCount: 1 });
      assert.equal((await toggle(post,key).expect(201)).body.cheered,true);
      await toggle(post,`next-${run}`).expect(201);
      assert.equal((await resolve(post,key).expect(201)).body.cheered,false);
      assert.equal(await db.cheer.count({ where: { postId: post.id } }),0);
      assert.equal(await db.notification.count({ where: { userId: users[0].id, targetId: post.id, type: "CHEER" } }),1);
    });
    await t.test("기록이 없거나 만료돼도 정리는 새 응원/보상을 만들지 않는다", async () => {
      for (const exists of [false,true]) {
        const post = await fixture(); const key = `${exists ? "expired" : "missing"}-${run}`;
        if(exists) await expired(post,key);
        assert.equal((await resolve(post,key).expect(201)).body.cheered,false);
        assert.equal((await resolve(post,key).expect(201)).body.cheerCount,0);
        const replay = await toggle(post,key);
        assert.equal(replay.status,exists ? 201 : 409);
        assert.equal(await db.cheer.count({ where: { postId: post.id } }),0);
        const receipt = await db.idempotencyKey.findUniqueOrThrow({ where: { userId_key_route: { userId: users[1].id,key,route: receiptRoute(post.id) } } });
        assert.ok(receipt.completedAt); assert.ok(receipt.expiresAt > new Date());
      }
    });
    await t.test("다른 계정/게시물의 키는 공유하지 않고 비공개·잘못된 입력은 거부한다", async () => {
      const post = await fixture(); const key = `owned-${run}`; await toggle(post,key).expect(201);
      const other = await resolve(post,key,2).expect(201);
      assert.equal(other.body.cheered,false); assert.equal(other.body.cheerCount,1);
      const hidden = await fixture("PRIVATE");
      await resolve(hidden,key).expect(404);
      await request(server).post(`${route(post.id)}/result`).send({ requestKey: key }).expect(401);
      await resolve(post," ").expect(400);
      await resolve(post,"x".repeat(101)).expect(400);
      assert.equal(await db.idempotencyKey.count({ where: { userId: users[1].id, route: receiptRoute(hidden.id) } }),0);
    });
    await t.test("트랜잭션 시작 전에 정리된 지연 요청은 다시 응원을 만들지 않는다", async () => {
      const post = await fixture(); const key = `queued-${run}`;
      const entered = latch(); const release = latch(); const transaction = appDb.$transaction.bind(appDb);
      let armed = true;
      appDb.$transaction = async (...args) => {
        if(armed && typeof args[0] === "function") { armed = false; entered.release(); await release.promise; }
        return transaction(...args);
      };
      const delayed = toggle(post,key).then((response) => response);
      try {
        await bounded(entered.promise);
        assert.equal((await resolve(post,key).expect(201)).body.cheered,false);
        release.release();
        assert.equal((await delayed).status,201);
        assert.equal(await db.cheer.count({ where: { postId: post.id } }),0);
      } finally { release.release(); await delayed; appDb.$transaction = transaction; }
    });
    await t.test("이전 snapshot의 지연 쓰기는 정리와 충돌하면 rollback된다", async () => {
      const post = await fixture(); const key = `snapshot-${run}`;
      const entered = latch(); const release = latch(); const transaction = appDb.$transaction.bind(appDb);
      let armed = true;
      appDb.$transaction = async (work,options) => {
        if(!armed || typeof work !== "function") return transaction(work,options);
        armed = false;
        return transaction(async (tx) => {
          const find = tx.idempotencyKey.findUnique.bind(tx.idempotencyKey);
          tx.idempotencyKey.findUnique = async (args) => { const row = await find(args); entered.release(); await release.promise; return row; };
          return work(tx);
        },options);
      };
      const delayed = toggle(post,key).then((response) => response);
      try {
        await bounded(entered.promise);
        await resolve(post,key).expect(201);
        release.release();
        const response = await delayed; assert.ok(response.status === 409 || response.status === 500);
        assert.equal(await db.cheer.count({ where: { postId: post.id } }),0);
        assert.equal((await resolve(post,key).expect(201)).body.cheered,false);
      } finally { release.release(); await delayed; appDb.$transaction = transaction; }
    });
    await t.test("만료 관측 뒤 정리된 새 완료 기록을 오래된 cleanup이 삭제하지 않는다", async () => {
      const post = await fixture(); const key = `expiry-race-${run}`; await expired(post,key);
      const remove = appDb.idempotencyKey.deleteMany.bind(appDb.idempotencyKey); let armed = true;
      appDb.idempotencyKey.deleteMany = async (args) => {
        if(armed && args.where.key === key) { armed = false; await resolve(post,key).expect(201); }
        return remove(args);
      };
      try {
        assert.equal((await toggle(post,key).expect(201)).body.cheered,false);
        assert.equal(armed,false); assert.equal(await db.cheer.count({ where: { postId: post.id } }),0);
      } finally { appDb.idempotencyKey.deleteMany = remove; }
    });
  } finally {
    await db.user.deleteMany({ where: { email: { startsWith: prefix } } });
    await app.close(); await db.$disconnect();
  }
});
