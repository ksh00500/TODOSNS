const test = require("node:test");
const assert = require("node:assert/strict");
const { readFile } = require("node:fs/promises");
const { join } = require("node:path");
const {
  DataGovernanceService,
  accountDeletionGraceDays,
  ageBandAtActivity,
  assertAnalyticsPayload,
  seoulMonthStart,
} = require("../dist/src/data-governance.service.js");

test("월 구간과 활동 당시 연령대를 Asia/Seoul 기준으로 일반화한다", () => {
  assert.equal(seoulMonthStart(new Date("2026-08-31T15:00:00.000Z")), "2026-09-01");
  assert.equal(ageBandAtActivity(new Date("1996-09-09T00:00:00.000Z"), new Date("2026-09-08T12:00:00.000Z")), "20s");
  assert.equal(ageBandAtActivity(null, new Date("2026-09-08T12:00:00.000Z")), "UNKNOWN");
});

test("분석 allowlist는 직접 식별자와 자유서술 필드를 거부하고 기본 수집·반출은 꺼져 있다", () => {
  assert.doesNotThrow(() => assertAnalyticsPayload({ eventType: "TODO_COMPLETED", occurredMonth: "2026-09-01", countValue: 1, broadCategory: "건강" }));
  assert.throws(() => assertAnalyticsPayload({ email: "person@example.test", notes: "private" }), /승인되지 않은 분석 필드/);
  const original = { collect: process.env.ANALYTICS_COLLECTION_ENABLED, export: process.env.ANALYTICS_EXPORT_ENABLED };
  delete process.env.ANALYTICS_COLLECTION_ENABLED;
  delete process.env.ANALYTICS_EXPORT_ENABLED;
  try {
    const service = new DataGovernanceService({});
    assert.equal(service.analyticsCollectionEnabled(), false);
    assert.equal(service.analyticsExportEnabled(), false);
  } finally {
    if (original.collect === undefined) delete process.env.ANALYTICS_COLLECTION_ENABLED; else process.env.ANALYTICS_COLLECTION_ENABLED = original.collect;
    if (original.export === undefined) delete process.env.ANALYTICS_EXPORT_ENABLED; else process.env.ANALYTICS_EXPORT_ENABLED = original.export;
  }
});

test("분석 수집이 승인돼도 탈퇴 요청 계정은 합성 intake에서 거부한다", async () => {
  const original = process.env.ANALYTICS_COLLECTION_ENABLED;
  process.env.ANALYTICS_COLLECTION_ENABLED = "true";
  try {
    const blocked = new DataGovernanceService({ user: { count: async () => 0 } });
    await assert.rejects(() => blocked.assertAnalyticsSubjectCollectable("deleted-synthetic"), /탈퇴·정지 계정/);
    const active = new DataGovernanceService({ user: { count: async () => 1 } });
    await assert.doesNotReject(() => active.assertAnalyticsSubjectCollectable("active-synthetic"));
  } finally {
    if (original === undefined) delete process.env.ANALYTICS_COLLECTION_ENABLED; else process.env.ANALYTICS_COLLECTION_ENABLED = original;
  }
});

test("탈퇴 요청은 동일 사용자의 열린 요청을 재사용하고 목적별 파기 작업을 만든다", async () => {
  const calls = [];
  const client = {
    $queryRawUnsafe: async (sql, ...values) => { calls.push({ sql, values }); return [{ id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }]; },
    $executeRawUnsafe: async (sql, ...values) => { calls.push({ sql, values }); return 1; },
  };
  const service = new DataGovernanceService(client);
  const id = await service.registerErasure(client, "user-synthetic", new Date("2026-09-08T00:00:00Z"), new Date("2026-09-08T00:00:00Z"));
  assert.equal(id, "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
  assert.equal(calls.filter((call) => call.sql.includes('"ErasureTask"')).length, 3);
  assert.deepEqual(calls.filter((call) => call.sql.includes('"ErasureTask"')).map((call) => call.values[2]), ["SERVICE_DATABASE", "OBJECT_STORAGE", "ANALYTICS_RESTRICTED"]);
  assert.equal(accountDeletionGraceDays({ ACCOUNT_DELETION_GRACE_DAYS: "7" }), 0);
  assert.equal(calls[0].values[2].getTime(), calls[0].values[3].getTime());
});

test("expand migration은 기존 테이블을 drop하지 않고 승인 없는 분석·보유를 활성화하지 않는다", async () => {
  const migration = await readFile(join(__dirname, "../prisma/migrations/20260908120000_data_governance_expand/migration.sql"), "utf8");
  const roles = await readFile(join(__dirname, "../../../infra/database/roles.sql"), "utf8");
  assert.match(migration, /CREATE SCHEMA IF NOT EXISTS analytics_release/);
  assert.match(migration, /collectionEnabled" BOOLEAN NOT NULL DEFAULT FALSE/);
  assert.match(migration, /ObjectDeletionTask_pending_object_key/);
  assert.doesNotMatch(migration, /DROP TABLE|DROP COLUMN|ALTER TABLE\s+public\."User"/i);
  assert.match(roles, /NOBYPASSRLS/);
  assert.match(roles, /REVOKE ALL ON SCHEMA identity/);
  assert.doesNotMatch(roles, /GRANT\s+.*identity\."AccountIdentity"\s+TO\s+mungsil_analytics_reader/i);
});
