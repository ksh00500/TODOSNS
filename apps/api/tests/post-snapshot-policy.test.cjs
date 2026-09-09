const test = require("node:test");
const assert = require("node:assert/strict");
const { readFile } = require("node:fs/promises");
const { join } = require("node:path");
const { Visibility } = require("@prisma/client");
const { MungsilService, isMoreRestrictiveVisibility, isReadablePostSnapshot } = require("../dist/src/mungsil.service.js");

test("합성 TODO 게시물은 생성 시점 값을 snapshot으로 고정한다", async () => {
  const source = {
    id: "todo-synthetic",
    userId: "user-synthetic",
    title: "아침 산책",
    notes: "강변 20분",
    category: "운동",
    dueDate: new Date("2026-09-08T22:00:00.000Z"),
    completedAt: new Date("2026-09-08T22:30:00.000Z"),
    repeatRule: null,
    seriesId: null,
  };
  let postData;
  const transaction = {
    todo: { findFirst: async () => source },
    post: { create: async ({ data }) => { postData = data; return { id: "post-synthetic" }; } },
  };
  const prisma = {
    $transaction: async (work) => work(transaction),
    post: { findUniqueOrThrow: async () => ({ id: "post-synthetic" }) },
  };
  const service = new MungsilService(prisma, {}, {}, {});
  service.reward = async () => true;
  service.serializePost = async (post) => post;
  await service.createPost("user-synthetic", { todoId: source.id, visibility: Visibility.PUBLIC });
  source.title = "나중에 수정한 제목";
  assert.equal(postData.snapshot.todo.title, "아침 산책");
  assert.equal(postData.snapshot.todo.completedAt, "2026-09-08T22:30:00.000Z");
  assert.deepEqual(postData.snapshotCategories, ["운동"]);
  assert.match(postData.snapshotSearchText, /아침 산책.*강변 20분.*운동/);
});

test("공개 범위 축소는 snapshot 신규 접근을 영구 차단한다", () => {
  assert.equal(isMoreRestrictiveVisibility(Visibility.PUBLIC, Visibility.FOLLOWERS), true);
  assert.equal(isMoreRestrictiveVisibility(Visibility.PUBLIC, Visibility.PRIVATE), true);
  assert.equal(isMoreRestrictiveVisibility(Visibility.FOLLOWERS, Visibility.PRIVATE), true);
  assert.equal(isMoreRestrictiveVisibility(Visibility.PRIVATE, Visibility.PUBLIC), false);
  assert.equal(isReadablePostSnapshot({ snapshot: { version: 1 }, sourceAccessRevokedAt: null, snapshotErasedAt: null }), true);
  assert.equal(isReadablePostSnapshot({ snapshot: { version: 1 }, sourceAccessRevokedAt: new Date(), snapshotErasedAt: null }), false);
  assert.equal(isReadablePostSnapshot({ snapshot: null, sourceAccessRevokedAt: null, snapshotErasedAt: new Date() }), false);
});

test("게시 snapshot은 표시·검색·이미지·가져오기에서 같은 접근 경계를 사용한다", async () => {
  const service = await readFile(join(__dirname, "../src/mungsil.service.ts"), "utf8");
  const media = await readFile(join(__dirname, "../src/media.service.ts"), "utf8");
  assert.match(service, /snapshot:\s+snapshot as unknown as Prisma\.InputJsonValue/);
  assert.match(service, /snapshotSearchText:\s+searchText/);
  assert.match(service, /snapshotCategories:\s+categories/);
  assert.match(service, /\.\.\.ACTIVE_POST_SNAPSHOT, id: postId/);
  assert.match(service, /postLinks: \{ some: \{ post: \{ \.\.\.ACTIVE_POST_SNAPSHOT/);
  assert.match(service, /snapshotSearchText: \{ contains: text/);
  assert.match(service, /sourceAccessRevokedAt: new Date\(\)/);
  assert.match(service, /caption: null,[\s\S]*snapshot: Prisma\.DbNull/);
  assert.match(service, /postTag\.deleteMany/);
  assert.match(media, /POST_SNAPSHOT_ERASURE/);
});

test("snapshot expand와 legacy backfill은 삭제·범위 축소를 fail-closed로 처리한다", async () => {
  const migration = await readFile(join(__dirname, "../prisma/migrations/20260908130000_post_snapshot_expand/migration.sql"), "utf8");
  const backfill = await readFile(join(__dirname, "../../../infra/database/backfill-post-snapshots.sql"), "utf8");
  assert.match(migration, /ADD COLUMN "snapshot" JSONB/);
  assert.match(migration, /Todo_post_snapshot_policy/);
  assert.match(migration, /new_rank < old_rank/);
  assert.match(migration, /"snapshot" = NULL/);
  assert.doesNotMatch(migration, /DROP TABLE|DROP COLUMN/i);
  assert.match(backfill, /historical publish-time snapshot does not exist/i);
  assert.match(backfill, /Fail closed for legacy rows/i);
});

test("탈퇴는 유예 없이 worker를 시작하고 월말 분석 작업을 기다리지 않는다", async () => {
  const auth = await readFile(join(__dirname, "../src/auth.ts"), "utf8");
  const maintenance = await readFile(join(__dirname, "../src/maintenance.service.ts"), "utf8");
  assert.match(auth, /registerErasure\(tx, userId, requestedAt, requestedAt\)/);
  assert.match(auth, /purgeDeletedAccount\(userId, requestedAt\)/);
  assert.match(auth, /purgeStarted: true/);
  assert.match(maintenance, /@Cron\("0 \* \* \* \* \*"/);
  assert.doesNotMatch(maintenance, /AggregationJob|MonthlyAggregate|analyticsCollectionEnabled/);
});
