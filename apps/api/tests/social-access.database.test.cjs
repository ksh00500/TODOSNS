const test = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const cookieParser = require("cookie-parser");
const { randomBytes } = require("node:crypto");
const { hash } = require("bcryptjs");
const { ValidationPipe } = require("@nestjs/common");
const { NestFactory } = require("@nestjs/core");
const { SchedulerRegistry } = require("@nestjs/schedule");
const { PrismaClient } = require("@prisma/client");
const { PutObjectCommand, DeleteObjectCommand, ListObjectVersionsCommand } = require("@aws-sdk/client-s3");
const { createStorageClients } = require("../dist/src/storage.js");
const { MediaService } = require("../dist/src/media.service.js");
const { MaintenanceService } = require("../dist/src/maintenance.service.js");
const { AppModule } = require("../dist/src/app.module.js");
const { PrismaService } = require("../dist/src/prisma.service.js");

const enabled = process.env.RUN_DATABASE_E2E === "1";

test("소셜 원본의 접근 철회·삭제를 실제 HTTP/DB 쓰기 경계에서 검증한다", { skip: !enabled }, async (t) => {
  // Independent client commits the owner's change before the service transaction starts.
  const db = new PrismaClient();
  const run = randomBytes(5).toString("hex");
  const prefix = `m09-${run}-`;
  const password = randomBytes(20).toString("hex");
  const app = await NestFactory.create(AppModule, { logger: false });
  const storage = createStorageClients();
  const objectKeys = new Set();
  app.setGlobalPrefix("api/v1");
  app.use(cookieParser());
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }));
  let pending = null;
  let fired = false;
  const appDb = app.get(PrismaService);
  const transaction = appDb.$transaction.bind(appDb);
  const findPost = appDb.post.findFirst.bind(appDb.post);
  async function boundary() {
    if (!pending) return;
    const change = pending.change;
    pending = null; fired = true;
    await change();
  }
  function arm(change, postId = null) { assert.equal(pending, null); fired = false; pending = { change, postId }; }
  appDb.$transaction = async (...args) => {
    if (typeof args[0] === "function") await boundary();
    return transaction(...args);
  };
  appDb.post.findFirst = async (args) => {
    const result = await findPost(args);
    // The legacy interaction path authorizes outside a transaction. Pause after
    // its source read; the fixed path instead reaches the transaction gate first.
    if (pending?.postId === args.where.id) await boundary();
    return result;
  };
  try {
    await app.init();
    for (const job of app.get(SchedulerRegistry).getCronJobs().values()) job.stop();
    const server = app.getHttpServer();
    const users = [];
    const tokens = [];
    const cookies = [];
    for (const name of ["a", "b", "c"]) {
      const user = await db.user.create({ data: {
        email: `${prefix}${name}@example.test`, handle: `m09.${name}.${run}`, nickname: `합성 ${name}`,
        passwordHash: await hash(password, 4), birthDate: new Date("1995-01-01T00:00:00Z"),
        emailVerifiedAt: new Date(), onboardingCompletedAt: new Date(), timezone: "Asia/Seoul",
      } });
      users.push(user);
      const login = await request(server).post("/api/v1/auth/login").send({ email: user.email, password }).expect(201);
      tokens.push(login.body.accessToken);
      cookies.push(login.headers["set-cookie"][0].split(";")[0]);
    }
    const [a, b, c] = users;
    const auth = (index) => ({ Authorization: `Bearer ${tokens[index]}` });
    async function todo(data = {}) {
      return db.todo.create({ data: { userId: a.id, title: "합성 원본 실천", notes: "합성 원본 메모", category: "생활",
        dueDate: new Date("2026-10-24T01:00:00Z"), completedAt: new Date(), visibility: "PUBLIC", ...data } });
    }
    async function group() {
      const source = await todo({ visibility: "PRIVATE" });
      return db.todoList.create({ data: { userId: a.id, title: "합성 원본 루틴", visibility: "PUBLIC", items: { create: { todoId: source.id, order: 0 } } } });
    }
    async function post() {
      const source = await todo({ visibility: "PRIVATE" });
      const result = await request(server).post("/api/v1/feed/posts").set(auth(0))
        .send({ todoId: source.id, caption: `합성검색${run}`, hashtags: [`m09_${run}`], visibility: "PUBLIC" }).expect(201);
      return { source, post: result.body };
    }
    async function noCopy() {
      assert.equal(await db.todo.count({ where: { userId: b.id } }), 0);
      assert.equal(await db.todoList.count({ where: { userId: b.id } }), 0);
      assert.equal(await db.todoSeries.count({ where: { userId: b.id } }), 0);
    }

    await t.test("루틴 공개 범위 철회가 트랜잭션 시작 전에 완료되면 복제하지 않는다", async () => {
      const source = await group();
      arm(() => db.todoList.update({ where: { id: source.id }, data: { visibility: "PRIVATE" } }));
      await request(server).post(`/api/v1/todo-lists/${source.id}/clone`).set(auth(1)).send({ repeatMode: "KEEP" }).expect(404);
      assert.equal(fired, true); await noCopy();
    });
    await t.test("루틴 차단이 트랜잭션 시작 전에 완료되면 복제·알림을 만들지 않는다", async () => {
      const source = await group();
      const notices = await db.notification.count({ where: { userId: a.id } });
      arm(() => db.block.create({ data: { blockerId: a.id, blockedId: b.id } }));
      try {
        await request(server).post(`/api/v1/todo-lists/${source.id}/clone`).set(auth(1)).send({ repeatMode: "KEEP" }).expect(404);
        assert.equal(fired, true); await noCopy();
        assert.equal(await db.notification.count({ where: { userId: a.id } }), notices);
      } finally { await db.block.deleteMany({ where: { blockerId: a.id, blockedId: b.id } }); }
    });
    await t.test("루틴 원본 삭제는 404로 거부하고 남은 복제본이 없다", async () => {
      const source = await group();
      arm(() => db.todoList.delete({ where: { id: source.id } }));
      await request(server).post(`/api/v1/todo-lists/${source.id}/clone`).set(auth(1)).send({}).expect(404);
      assert.equal(fired, true); await noCopy();
    });
    await t.test("반복 TODO 공개 범위 철회 후 과거 읽기 결과로 시리즈를 복제하지 않는다", async () => {
      const source = await todo({ repeatRule: "DAILY" });
      arm(() => db.todo.update({ where: { id: source.id }, data: { visibility: "PRIVATE" } }));
      await request(server).post(`/api/v1/todos/${source.id}/clone`).set(auth(1)).send({ keepRepeat: true }).expect(404);
      assert.equal(fired, true); await noCopy();
    });
    for (const action of ["cheer", "comments"]) {
      await t.test(`게시물 숨김이 쓰기 경계 전에 완료되면 ${action}·보상·알림을 만들지 않는다`, async () => {
        const fixture = await post();
        const notices = await db.notification.count({ where: { userId: a.id } });
        const rewards = await db.pointLedger.count({ where: { userId: b.id } });
        arm(() => db.post.update({ where: { id: fixture.post.id }, data: { hiddenAt: new Date() } }), fixture.post.id);
        await request(server).post(`/api/v1/feed/posts/${fixture.post.id}/${action}`).set(auth(1))
          .send(action === "comments" ? { body: "합성 응원 댓글" } : {}).expect(404);
        assert.equal(fired, true);
        assert.equal(await db.cheer.count({ where: { postId: fixture.post.id } }), 0);
        assert.equal(await db.comment.count({ where: { postId: fixture.post.id } }), 0);
        assert.equal(await db.pointLedger.count({ where: { userId: b.id } }), rewards);
        assert.equal(await db.notification.count({ where: { userId: a.id } }), notices);
      });
    }
    await t.test("허용된 단일 가져오기는 내 그룹/분류·정밀 일정·출처와 멱등 재완료를 유지한다", async () => {
      const fixture = await post();
      const destination = await db.todoList.create({ data: { userId: b.id, title: "내 그룹" } });
      const category = await db.todoCategory.create({ data: { userId: b.id, name: "내 분류", baseCategory: "생활", icon: "home", color: "aqua", position: 0 } });
      const payload = { title: "내가 가져온 실천", dueDate: "2026-10-25T01:05:30.123Z", todoListId: destination.id, categoryId: category.id };
      const key = `m09-${run}-copy`;
      const first = await request(server).post(`/api/v1/todos/${fixture.source.id}/clone`).set(auth(1)).set("Idempotency-Key", key).send(payload).expect(201);
      const replay = await request(server).post(`/api/v1/todos/${fixture.source.id}/clone`).set(auth(1)).set("Idempotency-Key", key).send(payload).expect(201);
      assert.equal(first.body.id, replay.body.id); assert.notEqual(first.body.id, fixture.source.id);
      assert.equal(first.body.userId, b.id); assert.equal(first.body.visibility, "PRIVATE");
      assert.equal(first.body.sourceTodoId, fixture.source.id); assert.equal(first.body.dueDate, payload.dueDate);
      assert.equal(first.body.categoryId, category.id);
      assert.equal(await db.todoListItem.count({ where: { listId: destination.id, todoId: first.body.id } }), 1);
      assert.equal(await db.todo.count({ where: { userId: b.id, sourceTodoId: fixture.source.id } }), 1);
      const completed = await request(server).post(`/api/v1/todos/${first.body.id}/complete`).set(auth(1)).send({ share: false }).expect(201);
      assert.equal(completed.body.todo.id, first.body.id); assert.ok(completed.body.todo.completedAt);
      assert.equal(completed.body.post, null);
      assert.equal((await db.todo.findUniqueOrThrow({ where: { id: fixture.source.id } })).title, fixture.source.title);
      await request(server).post(`/api/v1/todos/${fixture.source.id}/uncomplete`).set(auth(0)).send({}).expect(400);
    });
    await t.test("실제 루틴 KEEP/NONE/CUSTOM은 내 비공개 그룹·간격·반복·같은 키 복원을 유지한다", async () => {
      const one = await todo({ dueDate: new Date("2026-10-25T01:00:30.123Z"), repeatRule: "DAILY" });
      const two = await todo({ dueDate: new Date("2026-10-26T03:00:30.123Z") });
      const source = await db.todoList.create({ data: { userId: a.id, title: "간격 검증 루틴", visibility: "PUBLIC",
        items: { create: [{ todoId: one.id, order: 0 }, { todoId: two.id, order: 1 }] } } });
      for (const mode of ["KEEP", "NONE", "CUSTOM"]) {
        const payload = { title: `내 ${mode} 루틴`, repeatMode: mode, dueDate: "2026-10-28T01:00:30.123Z" };
        if (mode === "CUSTOM") payload.items = [
          { sourceTodoId: one.id, title: "수정한 내 실천", dueDate: "2026-11-01T01:30:30.123Z", repeatRule: null },
          { sourceTodoId: two.id, dueDate: "2026-11-03T03:30:30.123Z", repeatRule: null },
        ];
        const route = `/api/v1/todo-lists/${source.id}/clone`;
        const first = await request(server).post(route).set(auth(2)).set("Idempotency-Key", `${run}-${mode}`).send(payload).expect(201);
        const replay = await request(server).post(route).set(auth(2)).set("Idempotency-Key", `${run}-${mode}`).send(payload).expect(201);
        assert.equal(first.body.id, replay.body.id); assert.notEqual(first.body.id, source.id);
        assert.equal(first.body.userId, c.id); assert.equal(first.body.visibility, "PRIVATE");
        assert.equal(first.body.sourceTodoListId, source.id); assert.equal(first.body.items.length, 2);
        const copied = first.body.items.map((item) => item.todo);
        assert.equal(copied.every((item) => item.userId === c.id && item.visibility === "PRIVATE"), true);
        if (mode === "CUSTOM") {
          assert.equal(copied[0].title, "수정한 내 실천"); assert.equal(copied[0].dueDate, payload.items[0].dueDate);
        } else {
          assert.equal(new Date(copied[1].dueDate) - new Date(copied[0].dueDate), 26 * 3600_000);
          assert.equal(copied[0].dueDate, payload.dueDate);
        }
        assert.equal(Boolean(copied[0].repeatRule), mode === "KEEP");
      }
      assert.equal(await db.todoList.count({ where: { userId: c.id, sourceTodoListId: source.id } }), 3);
    });
    await t.test("양방향 차단은 피드·검색·상세·응원·댓글·가져오기·신고에서 같은 경계를 사용한다", async () => {
      const fixture = await post();
      await db.follow.createMany({ data: [{ followerId: b.id, followingId: a.id }, { followerId: a.id, followingId: b.id }] });
      for (const blocker of [0, 1]) {
        const target = blocker === 0 ? b.id : a.id;
        await request(server).post("/api/v1/social/block").set(auth(blocker)).send({ userId: target }).expect(201);
        try {
          const feed = await request(server).get("/api/v1/public/feed").set(auth(1)).expect(200);
          assert.equal(feed.body.items.some((item) => item.id === fixture.post.id), false);
          const search = await request(server).get("/api/v1/public/search").query({ query: `합성검색${run}` }).set(auth(1)).expect(200);
          assert.equal(search.body.posts.some((item) => item.id === fixture.post.id), false);
          await request(server).get(`/api/v1/public/posts/${fixture.post.id}`).set(auth(1)).expect(404);
          await request(server).post(`/api/v1/feed/posts/${fixture.post.id}/cheer`).set(auth(1)).send({}).expect(404);
          await request(server).post(`/api/v1/feed/posts/${fixture.post.id}/comments`).set(auth(1)).send({ body: "거부할 합성 댓글" }).expect(404);
          await request(server).post(`/api/v1/todos/${fixture.source.id}/clone`).set(auth(1)).send({}).expect(404);
          await request(server).post("/api/v1/social/report").set(auth(1)).send({ targetType: "POST", targetId: fixture.post.id, reason: "접근할 수 없는 원본" }).expect(404);
        } finally {
          await request(server).delete(`/api/v1/social/blocks/${target}`).set(auth(blocker)).expect(200);
        }
        await request(server).get(`/api/v1/public/posts/${fixture.post.id}`).set(auth(1)).expect(200);
      }
      assert.equal(await db.follow.count({ where: { OR: [{ followerId: b.id, followingId: a.id }, { followerId: a.id, followingId: b.id }] } }), 0);
      assert.equal(await db.cheer.count({ where: { postId: fixture.post.id } }), 0);
      assert.equal(await db.comment.count({ where: { postId: fixture.post.id } }), 0);
      assert.equal(await db.report.count({ where: { reporterId: b.id, targetId: fixture.post.id } }), 0);
    });
    await t.test("신고는 읽을 수 있는 원본에만 접수하고 다른 사용자의 삭제를 거부한다", async () => {
      const fixture = await post();
      const payload = { targetType: "POST", targetId: fixture.post.id, reason: "검토할 합성 기록" };
      await request(server).post("/api/v1/social/report").set(auth(1)).send(payload).expect(201);
      await request(server).post("/api/v1/social/report").set(auth(1)).send(payload).expect(409);
      await request(server).delete(`/api/v1/feed/posts/${fixture.post.id}`).set(auth(1)).expect(404);
      await request(server).delete(`/api/v1/todos/${fixture.source.id}`).set(auth(1)).expect(404);
      assert.equal(await db.report.count({ where: { reporterId: b.id, targetId: fixture.post.id } }), 1);
      await request(server).get(`/api/v1/public/posts/${fixture.post.id}`).expect(200);
    });
    await t.test("팔로워 전용 게시물은 관계를 해제하면 신규 읽기와 원본 가져오기를 거부한다", async () => {
      const source = await todo({ visibility: "PRIVATE" });
      const published = await request(server).post("/api/v1/feed/posts").set(auth(0))
        .send({ todoId: source.id, visibility: "FOLLOWERS" }).expect(201);
      await request(server).get(`/api/v1/public/posts/${published.body.id}`).expect(404);
      await request(server).get(`/api/v1/public/posts/${published.body.id}`).set(auth(1)).expect(404);
      await request(server).post("/api/v1/social/follow").set(auth(1)).send({ userId: a.id }).expect(201);
      await request(server).get(`/api/v1/public/posts/${published.body.id}`).set(auth(1)).expect(200);
      await request(server).get(`/api/v1/public/posts/${published.body.id}`).set(auth(2)).expect(404);
      const copied = await request(server).post(`/api/v1/todos/${source.id}/clone`).set(auth(1)).send({}).expect(201);
      await request(server).post("/api/v1/social/follow").set(auth(1)).send({ userId: a.id }).expect(201);
      await request(server).get(`/api/v1/public/posts/${published.body.id}`).set(auth(1)).expect(404);
      await request(server).post(`/api/v1/todos/${source.id}/clone`).set(auth(1)).send({}).expect(404);
      assert.equal((await db.todo.findUniqueOrThrow({ where: { id: copied.body.id } })).userId, b.id);
    });
    await t.test("범위 축소로 철회된 snapshot은 다시 공개해도 검색/상세/가져오기에 복원되지 않는다", async () => {
      const source = await todo();
      const published = await request(server).post("/api/v1/feed/posts").set(auth(0))
        .send({ todoId: source.id, caption: `철회검색${run}`, hashtags: [`revoke_${run}`], visibility: "PUBLIC" }).expect(201);
      await request(server).patch(`/api/v1/todos/${source.id}`).set(auth(0)).send({ visibility: "PRIVATE" }).expect(200);
      await request(server).get(`/api/v1/public/posts/${published.body.id}`).expect(404);
      await request(server).post(`/api/v1/todos/${source.id}/clone`).set(auth(1)).send({}).expect(404);
      const search = await request(server).get("/api/v1/public/search").query({ query: `철회검색${run}` }).expect(200);
      assert.equal(search.body.posts.some((item) => item.id === published.body.id), false);
      await request(server).patch(`/api/v1/todos/${source.id}`).set(auth(0)).send({ visibility: "PUBLIC" }).expect(200);
      await request(server).get(`/api/v1/public/posts/${published.body.id}`).expect(404);
      assert.ok((await db.post.findUniqueOrThrow({ where: { id: published.body.id } })).sourceAccessRevokedAt);
    });
    await t.test("원본 삭제는 DB snapshot·태그와 실제 저장소의 모든 사진 버전을 파기한다", { skip: process.env.RUN_OBJECT_STORAGE_E2E !== "1" || process.env.OBJECT_STORAGE_VERSIONED !== "1" }, async () => {
      const original = `m09/${run}/original.webp`; const thumbnail = `m09/${run}/thumbnail.webp`; const neighbor = `${original}-neighbor`;
      for (const key of [original, thumbnail, neighbor]) {
        objectKeys.add(key);
        for (const value of ["synthetic-v1", "synthetic-v2"]) await storage.internal.send(new PutObjectCommand({ Bucket: storage.bucket, Key: key, Body: value, ContentType: "image/webp" }));
        if (key !== neighbor) {
          await storage.internal.send(new DeleteObjectCommand({ Bucket: storage.bucket, Key: key }));
          await storage.internal.send(new PutObjectCommand({ Bucket: storage.bucket, Key: key, Body: "synthetic-current", ContentType: "image/webp" }));
        }
      }
      const source = await todo();
      const media = await db.media.create({ data: { ownerId: a.id, objectKey: original, thumbnailKey: thumbnail, mimeType: "image/webp", size: 17, status: "READY" } });
      // The valid request uses the owned READY fixture; this bypasses photo processing only.
      const created = await request(server).post("/api/v1/feed/posts").set(auth(0))
        .send({ todoId: source.id, caption: `삭제검색${run}`, hashtags: [`delete_${run}`], visibility: "PUBLIC", mediaId: media.id }).expect(201);
      const url = created.body.mediaUrl;
      const before = await fetch(url); assert.equal(before.status, 200); await before.arrayBuffer();
      await request(server).delete(`/api/v1/todos/${source.id}`).set(auth(0)).expect(200);
      const erased = await db.post.findUniqueOrThrow({ where: { id: created.body.id } });
      assert.equal(erased.snapshot, null); assert.equal(erased.caption, null); assert.equal(erased.snapshotSearchText, null);
      assert.deepEqual(erased.snapshotCategories, []); assert.ok(erased.snapshotErasedAt);
      assert.equal(await db.postTag.count({ where: { postId: created.body.id } }), 0);
      assert.equal(await db.media.count({ where: { id: media.id } }), 0);
      for (const key of [original, thumbnail]) {
        const versions = await storage.internal.send(new ListObjectVersionsCommand({ Bucket: storage.bucket, Prefix: key }));
        assert.equal([...(versions.Versions ?? []), ...(versions.DeleteMarkers ?? [])].some((item) => item.Key === key), false);
      }
      const neighbors = await storage.internal.send(new ListObjectVersionsCommand({ Bucket: storage.bucket, Prefix: neighbor }));
      assert.equal(neighbors.Versions.filter((item) => item.Key === neighbor).length, 2);
      const after = await fetch(url); assert.equal(after.status, 404); await after.arrayBuffer();
      await request(server).get(`/api/v1/public/posts/${created.body.id}`).expect(404);
      const search = await request(server).get("/api/v1/public/search").query({ query: `삭제검색${run}` }).expect(200);
      assert.equal(search.body.posts.some((item) => item.id === created.body.id), false);
      await request(server).post(`/api/v1/todos/${source.id}/clone`).set(auth(1)).send({}).expect(404);
      await request(server).post(`/api/v1/todos/${source.id}/restore`).set(auth(0)).send({}).expect(201);
      await request(server).get(`/api/v1/public/posts/${created.body.id}`).expect(404);
      const tasks = await db.$queryRaw`SELECT "completedAt" FROM governance."ObjectDeletionTask" WHERE "mediaId" = ${media.id}`;
      assert.equal(tasks.length, 2); assert.equal(tasks.every((task) => task.completedAt !== null), true);
    });
    await t.test("탈퇴 API는 기존 세션을 즉시 막고 실제 DB·저장소 파기 작업을 완료한다", { skip: process.env.RUN_OBJECT_STORAGE_E2E !== "1" }, async () => {
      const fixture = await post();
      const key = `m09/${run}/account.webp`; objectKeys.add(key);
      await storage.internal.send(new PutObjectCommand({ Bucket: storage.bucket, Key: key, Body: "synthetic-account-image", ContentType: "image/webp" }));
      await db.media.create({ data: { ownerId: a.id, objectKey: key, mimeType: "image/webp", size: 23, status: "READY" } });
      const copies = await db.todo.count({ where: { userId: b.id } });
      assert.ok(copies > 0);
      const worker = app.get(MaintenanceService);
      const realPurge = worker.purgeDeletedAccount.bind(worker);
      let completion;
      let requestId;
      worker.purgeDeletedAccount = (...args) => {
        completion = (async () => {
          const rows = await db.$queryRaw`SELECT "id" FROM governance."ErasureRequest" WHERE "subjectUserId" = ${a.id}`;
          assert.equal(rows.length, 1); requestId = rows[0].id;
          return realPurge(...args);
        })();
        return completion;
      };
      try {
        const deletion = await request(server).post("/api/v1/auth/delete-account").set(auth(0)).send({}).expect(201);
        assert.equal(deletion.body.purgeStarted, true); assert.ok(completion);
        await request(server).get("/api/v1/me").set(auth(0)).expect(401);
        await request(server).post("/api/v1/auth/refresh").set("Cookie", cookies[0]).send({}).expect(401);
        await request(server).get(`/api/v1/public/posts/${fixture.post.id}`).expect(404);
        assert.equal(await completion, true);
        assert.equal(await db.user.count({ where: { id: a.id } }), 0);
        assert.equal(await db.todo.count({ where: { userId: a.id } }), 0);
        assert.equal(await db.post.count({ where: { authorId: a.id } }), 0);
        assert.equal(await db.session.count({ where: { userId: a.id } }), 0);
        assert.equal(await db.media.count({ where: { ownerId: a.id } }), 0);
        const requests = await db.$queryRaw`SELECT "status", "subjectUserId", "completedAt" FROM governance."ErasureRequest" WHERE "id" = ${requestId}`;
        assert.equal(requests[0].status, "COMPLETED"); assert.equal(requests[0].subjectUserId, null); assert.ok(requests[0].completedAt);
        const tasks = await db.$queryRaw`SELECT "status" FROM governance."ErasureTask" WHERE "requestId" = ${requestId}`;
        assert.equal(tasks.length, 3); assert.equal(tasks.every((task) => task.status === "COMPLETED"), true);
        const versions = await storage.internal.send(new ListObjectVersionsCommand({ Bucket: storage.bucket, Prefix: key }));
        assert.equal([...(versions.Versions ?? []), ...(versions.DeleteMarkers ?? [])].some((item) => item.Key === key), false);
        assert.equal(await db.todo.count({ where: { userId: b.id } }), copies);
        await request(server).get("/api/v1/me").set(auth(1)).expect(200);
      } finally {
        if (completion) await completion;
        worker.purgeDeletedAccount = realPurge;
      }
    });
  } finally {
    pending = null;
    appDb.$transaction = transaction;
    appDb.post.findFirst = findPost;
    for (const key of objectKeys) await app.get(MediaService).deleteObjectCompletely(key);
    storage.internal.destroy(); storage.public.destroy();
    await db.user.deleteMany({ where: { email: { startsWith: prefix } } });
    await app.close();
    await db.$disconnect();
  }
});
