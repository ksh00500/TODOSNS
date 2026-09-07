require("reflect-metadata");
const test = require("node:test");
const assert = require("node:assert/strict");
const { createServer } = require("node:http");
const { once } = require("node:events");
const { ValidationPipe } = require("@nestjs/common");
const { Test } = require("@nestjs/testing");
const { JwtService } = require("@nestjs/jwt");
const request = require("supertest");
const { Server } = require("socket.io");
const { io: createClient } = require("socket.io-client");
const { of, lastValueFrom } = require("rxjs");
const { FeedQueryDto } = require("../dist/src/dtos.js");
const { AuthController, AuthService } = require("../dist/src/auth.js");
const { OptionalJwtAuthGuard } = require("../dist/src/auth.js");
const { PublicController } = require("../dist/src/controllers.js");
const { PrismaService } = require("../dist/src/prisma.service.js");
const { ChatEvents } = require("../dist/src/chat.events.js");
const { ChatGateway } = require("../dist/src/chat.gateway.js");
const { ChallengeChatService } = require("../dist/src/challenge-chat.service.js");
const { IdempotencyInterceptor } = require("../dist/src/idempotency.interceptor.js");
const { MungsilService } = require("../dist/src/mungsil.service.js");
const { MediaService } = require("../dist/src/media.service.js");
const { validateEnvironment } = require("../dist/src/config.js");
const { storageSettings } = require("../dist/src/storage.js");

test("실제 피드 URL의 mode/category/cursor를 검증하고 미지원 값은 거부한다", async () => {
  const pipe = new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true });
  const parsed = await pipe.transform({ limit: "10", mode: "mix", category: "건강", cursor: "next" }, { type: "query", metatype: FeedQueryDto });
  assert.equal(parsed.limit, 10);
  assert.equal(parsed.mode, "mix");
  assert.equal(parsed.category, "건강");
  await assert.rejects(() => pipe.transform({ limit: "10", mode: "popular", category: "전체" }, { type: "query", metatype: FeedQueryDto }), /Bad Request/);
});

test("프론트가 만드는 공개 피드 URL을 실제 HTTP 라우트가 받는다", async (t) => {
  const calls = [];
  const module = await Test.createTestingModule({ controllers: [PublicController], providers: [{ provide: MungsilService, useValue: { feed: async (userId, query) => { calls.push({ userId, query }); return { items: [], nextCursor: null }; } } }, { provide: OptionalJwtAuthGuard, useValue: { canActivate: () => true } }, { provide: JwtService, useValue: { verify: () => ({}) } }, { provide: PrismaService, useValue: { session: { count: async () => 0 } } }] }).compile();
  const app = module.createNestApplication();
  app.setGlobalPrefix("api/v1");
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }));
  await app.init();
  t.after(() => app.close());
  await request(app.getHttpServer()).get("/api/v1/public/feed?limit=10&mode=recent&category=%EC%A0%84%EC%B2%B4").expect(200);
  await request(app.getHttpServer()).get("/api/v1/public/feed?limit=10&mode=mix&category=%EA%B1%B4%EA%B0%95&cursor=next").expect(200);
  await request(app.getHttpServer()).get("/api/v1/public/feed?limit=10&mode=popular&category=%EC%A0%84%EC%B2%B4").expect(400);
  assert.equal(calls.length, 2);
  assert.equal(calls[1].query.category, "건강");
  assert.equal(calls[1].query.cursor, "next");
});

test("Google 로그인은 서버 기능 플래그로 닫히고 정지 계정에는 세션을 발급하지 않는다", async () => {
  const original = { enabled: process.env.GOOGLE_AUTH_ENABLED, client: process.env.GOOGLE_CLIENT_ID };
  const user = { id: "u1", email: "user@example.test", googleId: "google-1", role: "USER", nickname: "user", handle: "user", availablePoints: 0, lifetimePower: 0, recentVitality: 0, avatarUrl: null, emailVerifiedAt: new Date(), suspendedAt: new Date(), deletionRequestedAt: null };
  const prisma = { user: { findUnique: async () => user, count: async () => 0 } };
  const auth = new AuthService(prisma, {}, {}, new ChatEvents());
  auth.google = { verifyIdToken: async () => ({ getPayload: () => ({ email: user.email, sub: user.googleId, email_verified: true }) }) };
  try {
    process.env.GOOGLE_AUTH_ENABLED = "false";
    process.env.GOOGLE_CLIENT_ID = "client";
    await assert.rejects(() => auth.googleLogin({ idToken: "token" }, {}), /설정되지 않았어요/);
    process.env.GOOGLE_AUTH_ENABLED = "true";
    await assert.rejects(() => auth.googleLogin({ idToken: "token" }, {}), /로그인할 수 없어요/);
  } finally {
    if (original.enabled === undefined) delete process.env.GOOGLE_AUTH_ENABLED; else process.env.GOOGLE_AUTH_ENABLED = original.enabled;
    if (original.client === undefined) delete process.env.GOOGLE_CLIENT_ID; else process.env.GOOGLE_CLIENT_ID = original.client;
  }
});

test("공개 인증 설정은 초대 가입과 Google 서버 플래그를 그대로 노출한다", () => {
  const original = { invite: process.env.INVITE_REQUIRED, google: process.env.GOOGLE_AUTH_ENABLED, client: process.env.GOOGLE_CLIENT_ID };
  try {
    process.env.INVITE_REQUIRED = "false";
    process.env.GOOGLE_AUTH_ENABLED = "true";
    process.env.GOOGLE_CLIENT_ID = "client";
    assert.deepEqual(new AuthController({}).config(), { inviteRequired: false, googleAuthEnabled: true, googleClientId: "client" });
    process.env.INVITE_REQUIRED = "true";
    delete process.env.GOOGLE_CLIENT_ID;
    assert.deepEqual(new AuthController({}).config(), { inviteRequired: true, googleAuthEnabled: false, googleClientId: null });
  } finally {
    if (original.invite === undefined) delete process.env.INVITE_REQUIRED; else process.env.INVITE_REQUIRED = original.invite;
    if (original.google === undefined) delete process.env.GOOGLE_AUTH_ENABLED; else process.env.GOOGLE_AUTH_ENABLED = original.google;
    if (original.client === undefined) delete process.env.GOOGLE_CLIENT_ID; else process.env.GOOGLE_CLIENT_ID = original.client;
  }
});

test("Google 신규 가입은 검증된 계정에 추가 프로필을 요구하고 잘못된 토큰은 401로 거부한다", async () => {
  const original = { enabled: process.env.GOOGLE_AUTH_ENABLED, client: process.env.GOOGLE_CLIENT_ID };
  const prisma = { user: { findUnique: async () => null } };
  const auth = new AuthService(prisma, {}, {}, new ChatEvents());
  try {
    process.env.GOOGLE_AUTH_ENABLED = "true";
    process.env.GOOGLE_CLIENT_ID = "client";
    auth.google = { verifyIdToken: async () => ({ getPayload: () => ({ email: "new@example.test", sub: "google-new", email_verified: true }) }) };
    await assert.rejects(
      () => auth.googleLogin({ idToken: "valid-token" }, {}),
      (error) => error.getResponse().code === "GOOGLE_PROFILE_REQUIRED" && error.getStatus() === 400,
    );
    auth.google = { verifyIdToken: async () => { throw new Error("invalid signature"); } };
    await assert.rejects(
      () => auth.googleLogin({ idToken: "invalid-token" }, {}),
      (error) => error.getStatus() === 401 && /Google 계정/.test(error.message),
    );
  } finally {
    if (original.enabled === undefined) delete process.env.GOOGLE_AUTH_ENABLED; else process.env.GOOGLE_AUTH_ENABLED = original.enabled;
    if (original.client === undefined) delete process.env.GOOGLE_CLIENT_ID; else process.env.GOOGLE_CLIENT_ID = original.client;
  }
});

test("만료 액세스 토큰 로그아웃도 서버 세션을 폐기하고 소켓 회수 이벤트를 낸다", async () => {
  const originalSecret = process.env.JWT_ACCESS_SECRET;
  process.env.JWT_ACCESS_SECRET = "test-access-secret";
  const revoked = [];
  const events = new ChatEvents();
  events.on("access-revoked", (event) => revoked.push(event));
  const updates = [];
  const auth = new AuthService({ session: { updateMany: async (query) => { updates.push(query); return { count: 1 }; } } }, { verify: () => ({ sid: "expired-session" }) }, {}, events);
  try {
    await auth.logoutToken("expired-access", undefined);
    assert.equal(updates[0].where.id, "expired-session");
    assert.deepEqual(revoked, [{ kind: "session", sessionId: "expired-session" }]);
  } finally {
    if (originalSecret === undefined) delete process.env.JWT_ACCESS_SECRET; else process.env.JWT_ACCESS_SECRET = originalSecret;
  }
});

test("실제 Socket.IO 연결은 권한 상실 뒤 원문을 보내지 않고 방에서 제거한다", async (t) => {
  let member = true;
  let session = true;
  const prisma = {
    session: { count: async () => session ? 1 : 0 },
    conversationMember: { count: async () => member ? 1 : 0 },
  };
  const events = new ChatEvents();
  const gateway = new ChatGateway({ verify: () => ({ sub: "user-a", sid: "session-a", exp: Math.floor(Date.now() / 1000) + 60 }) }, prisma, events);
  const http = createServer();
  const io = new Server(http);
  const namespace = io.of("/chat");
  gateway.server = namespace;
  namespace.on("connection", (socket) => {
    void gateway.handleConnection(socket);
    socket.on("join", async (room, reply) => reply(await gateway.join(socket, room)));
    socket.on("disconnect", () => gateway.handleDisconnect(socket));
  });
  http.listen(0, "127.0.0.1");
  await once(http, "listening");
  const port = http.address().port;
  const client = createClient(`http://127.0.0.1:${port}/chat`, { transports: ["websocket"], auth: { token: "valid" } });
  t.after(() => { client.close(); io.close(); http.close(); });
  await once(client, "connect");
  const joined = await new Promise((resolve) => client.emit("join", "room-a", resolve));
  assert.deepEqual(joined, { ok: true });
  const received = [];
  client.on("message.created", (payload) => received.push(payload));
  events.publish({ conversationId: "room-a", type: "message.created", payload: { id: "m1", body: "private", media: [{ url: "https://private" }] } });
  await new Promise((resolve) => setTimeout(resolve, 80));
  assert.deepEqual(received, [{ conversationId: "room-a", id: "m1" }]);
  member = false;
  events.publish({ conversationId: "room-a", type: "message.created", payload: { id: "m2", body: "must-not-leak" } });
  await new Promise((resolve) => setTimeout(resolve, 80));
  assert.equal(received.length, 1);
  session = false;
  const disconnected = once(client, "disconnect");
  events.revoke({ kind: "user", userId: "user-a" });
  await disconnected;
});

test("동일 멱등 키의 같은 본문은 재생하고 다른 본문은 거부한다", async () => {
  let row = null;
  const store = {
    findUnique: async () => row,
    create: async ({ data }) => { row = { ...data, completedAt: null, response: null }; return row; },
    update: async ({ data }) => { row = { ...row, ...data }; return row; },
    updateMany: async ({ data }) => { row = { ...row, ...data }; return { count: 1 }; },
    delete: async () => { row = null; }, deleteMany: async () => { row = null; return { count: 1 }; },
  };
  const interceptor = new IdempotencyInterceptor({ idempotencyKey: store });
  const request = (body) => ({ method: "POST", body, user: { sub: "u1" }, originalUrl: "/todos/x/complete", header: (name) => name === "idempotency-key" ? "action-1" : undefined });
  const context = (body) => ({ getType: () => "http", switchToHttp: () => ({ getRequest: () => request(body) }) });
  let calls = 0;
  assert.deepEqual(await lastValueFrom(await interceptor.intercept(context({ share: false }), { handle: () => { calls += 1; return of({ ok: true }); } })), { ok: true });
  assert.deepEqual(await lastValueFrom(await interceptor.intercept(context({ share: false }), { handle: () => { calls += 1; return of({ ok: false }); } })), { ok: true });
  assert.equal(calls, 1);
  await assert.rejects(() => interceptor.intercept(context({ share: true }), { handle: () => of({}) }), /다른 내용을 사용할 수 없어요/);
});

test("일일 포인트 상한 검사는 직렬화 트랜잭션 안에서 수행한다", async () => {
  let count = 4;
  let lock = Promise.resolve();
  const tx = { pointLedger: { count: async () => count, create: async () => { count += 1; } }, user: { update: async () => ({}) } };
  const prisma = { $transaction: async (callback, options) => { const previous = lock; let release; lock = new Promise((resolve) => { release = resolve; }); await previous; try { assert.equal(options.isolationLevel, "Serializable"); return await callback(tx); } finally { release(); } } };
  const service = new MungsilService(prisma, {}, {}, {});
  service.userDayWindow = async () => ({ start: new Date(0), end: new Date() });
  const result = await Promise.all([service.reward("u", 10, "TODO_COMPLETE", "a", 5), service.reward("u", 10, "TODO_COMPLETE", "b", 5)]);
  assert.deepEqual(result, [true, false]);
  assert.equal(count, 5);
});

test("미디어 객체 삭제 실패 시 추적 행을 보존하고 다음 정리에서 재시도한다", async () => {
  let failures = 1;
  let deletedRows = 0;
  let cleanupWhere;
  const item = { id: "media-1", objectKey: "full", thumbnailKey: "thumb" };
  const prisma = { media: { findMany: async ({ where }) => { cleanupWhere = where; return [item]; }, delete: async () => { deletedRows += 1; } } };
  const media = new MediaService(prisma);
  media.s3 = { send: async () => { if (failures-- > 0) throw new Error("storage unavailable"); } };
  await media.cleanupIncompleteUploads();
  assert.equal(deletedRows, 0);
  await media.cleanupIncompleteUploads();
  assert.equal(deletedRows, 1);
  assert.ok(cleanupWhere.status.in.includes("READY"));
  assert.deepEqual(cleanupWhere.avatarFor, { is: null });
});

test("미디어 저장량과 처리 동시성 상한을 실제 서비스 경로에서 거부한다", async () => {
  const original = { bytes: process.env.MEDIA_MAX_BYTES_PER_USER, concurrency: process.env.MEDIA_PROCESS_CONCURRENCY };
  process.env.MEDIA_MAX_BYTES_PER_USER = "10000000";
  process.env.MEDIA_PROCESS_CONCURRENCY = "1";
  const uploading = { id: "media-1", ownerId: "u1", objectKey: "upload", size: 100, status: "UPLOADING" };
  let rejectDownload;
  const prisma = {
    media: {
      aggregate: async () => ({ _sum: { size: 9_999_999 } }),
      findFirst: async () => uploading,
      update: async () => uploading,
    },
  };
  const media = new MediaService(prisma);
  media.s3 = { send: async () => new Promise((_, reject) => { rejectDownload = reject; }) };
  try {
    await assert.rejects(() => media.presign("u1", { filename: "x.jpg", mimeType: "image/jpeg", size: 2 }), /저장 공간/);
    const first = media.complete("u1", { mediaId: "media-1" });
    await new Promise((resolve) => setImmediate(resolve));
    await assert.rejects(() => media.complete("u1", { mediaId: "media-1" }), /처리 요청이 많아요/);
    rejectDownload(new Error("stop test request"));
    await assert.rejects(() => first, /처리하지 못했어요/);
  } finally {
    if (original.bytes === undefined) delete process.env.MEDIA_MAX_BYTES_PER_USER; else process.env.MEDIA_MAX_BYTES_PER_USER = original.bytes;
    if (original.concurrency === undefined) delete process.env.MEDIA_PROCESS_CONCURRENCY; else process.env.MEDIA_PROCESS_CONCURRENCY = original.concurrency;
  }
});

test("챌린지 참여자 목록은 limit 다음의 커서를 반환하고 다음 요청에 적용한다", async () => {
  const seen = [];
  const joinedAt = new Date("2026-09-01T00:00:00.000Z");
  const rows = ["u1", "u2", "u3"].map((id) => ({ userId: id, joinedAt, user: { id, nickname: id, handle: id, avatarUrl: null, avatarMedia: null, lifetimePower: 0 } }));
  const service = new ChallengeChatService({
    conversationMember: { findMany: async (query) => { seen.push(query); return rows; } },
    conversationMute: { findMany: async () => [] },
  }, {}, {});
  service.context = async () => ({ room: { id: "room" }, challenge: { kind: "COMMUNITY", creatorId: "owner" } });
  const first = await service.members("owner", "challenge", { limit: 2 });
  assert.equal(first.items.length, 2);
  assert.ok(first.nextCursor);
  await service.members("owner", "challenge", { limit: 2, cursor: first.nextCursor });
  assert.equal(seen[0].take, 3);
  assert.equal(seen[1].where.OR[1].userId.gt, "u2");
});

test("운영 환경은 예시 비밀값과 동일한 JWT 비밀을 거부한다", () => {
  const base = {
    NODE_ENV: "production", DATABASE_URL: "postgresql://u:p@db/app", REDIS_URL: "redis://redis:6379",
    JWT_ACCESS_SECRET: "a".repeat(32), JWT_REFRESH_SECRET: "b".repeat(32), WEB_ORIGIN: "https://app.example.test",
    STORAGE_BUCKET: "media", STORAGE_REGION: "ap-southeast-2",
    SMTP_HOST: "smtp.example.test", SITE_ORIGIN: "https://app.example.test",
  };
  assert.throws(() => validateEnvironment({ ...base, JWT_ACCESS_SECRET: "replace-with-at-least-32-random-characters" }), /must not use an example/);
  assert.throws(() => validateEnvironment({ ...base, JWT_REFRESH_SECRET: base.JWT_ACCESS_SECRET }), /must be different/);
  assert.equal(validateEnvironment(base).NODE_ENV, "production");
  assert.throws(() => validateEnvironment({ ...base, STORAGE_BUCKET: "" }), /STORAGE_BUCKET or MINIO_BUCKET/);
  assert.throws(() => validateEnvironment({ ...base, STORAGE_ENDPOINT: "https://storage.example.test" }), /explicit access and secret keys/);
});

test("운영 S3는 IAM 자격 증명 체인을 사용하고 로컬 MinIO 호환성을 유지한다", () => {
  const aws = storageSettings({
    NODE_ENV: "production",
    STORAGE_BUCKET: "mungsil-media",
    STORAGE_REGION: "ap-southeast-2",
  });
  assert.equal(aws.bucket, "mungsil-media");
  assert.equal(aws.region, "ap-southeast-2");
  assert.equal(aws.endpoint, undefined);
  assert.equal(aws.forcePathStyle, false);
  assert.equal(aws.credentials, undefined);

  const minio = storageSettings({
    NODE_ENV: "development",
    MINIO_ENDPOINT: "http://minio:9000",
    MINIO_PUBLIC_ENDPOINT: "http://localhost:9000",
    MINIO_ACCESS_KEY: "local-access",
    MINIO_SECRET_KEY: "local-secret",
    MINIO_BUCKET: "local-media",
  });
  assert.equal(minio.bucket, "local-media");
  assert.equal(minio.endpoint, "http://minio:9000");
  assert.equal(minio.publicEndpoint, "http://localhost:9000");
  assert.equal(minio.forcePathStyle, true);
  assert.deepEqual(minio.credentials, { accessKeyId: "local-access", secretAccessKey: "local-secret" });
});
