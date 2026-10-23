const assert = require("node:assert/strict");
const test = require("node:test");
const { PushService, FcmSender } = require("../dist/src/push.service.js");

const now = new Date();
function fixture(result = "sent") {
  const calls = { updates: [], deletes: [], sends: [], queries: [] };
  const device = { id: "device", token: "synthetic-token", sessionId: "session", nextAttemptAt: now, cursorAt: new Date(now.getTime() - 1000), cursorId: "a", failures: 0 };
  const row = { id: "notification", userId: "user", updatedAt: now, readAt: null };
  const prisma = {
    pushDevice: {
      deleteMany: async (q) => { calls.deletes.push(q); return { count: 0 }; },
      findMany: async () => [device],
      findFirst: async () => device,
      updateMany: async (q) => { calls.updates.push(q); return { count: 1 }; },
    },
    session: { findFirst: async () => ({ userId: "user" }) },
    notification: { findMany: async (q) => { calls.queries.push(q); return [row]; }, findUnique: async () => row },
  };
  const service = new PushService(prisma, { send: async (data) => { calls.sends.push(data); return result; } });
  service.enabled = () => true;
  return { service, prisma, calls, device, row };
}

test("푸시는 읽음 변경 없이 ID만 보내고 성공 후 커서를 전진한다", async () => {
  const { service, calls } = fixture();
  await service.dispatch();
  assert.equal(calls.sends.length, 1);
  assert.deepEqual(Object.keys(calls.sends[0]).sort(), ["eventId", "notificationId", "token", "userId"]);
  assert.equal(calls.updates.find((q) => q.data.cursorId)?.data.cursorId, "notification");
  assert.deepEqual(calls.queries[0].orderBy, [{ updatedAt: "asc" }, { id: "asc" }]);
});

test("FCM 일시 실패는 커서를 유지하고 재시도 일정을 저장한다", async () => {
  const { service, calls } = fixture("retry");
  await service.dispatch();
  assert.equal(calls.updates.some((q) => q.data.cursorId), false);
  assert.equal(calls.updates.some((q) => q.data.failures?.increment === 1), true);
});

test("만료된 FCM 토큰만 해당 기기에서 제거한다", async () => {
  const { service, calls } = fixture("invalid");
  await service.dispatch();
  assert.equal(calls.deletes.at(-1).where.token, "synthetic-token");
  assert.equal(calls.deletes.at(-1).where.sessionId, "session");
});

test("로그아웃, 발송 직전 권한 변경, 다른 worker 선점은 발송하지 않는다", async () => {
  for (const state of ["revoked", "changed", "leased"]) {
    const { service, prisma, calls } = fixture();
    if (state === "revoked") prisma.session.findFirst = async () => null;
    if (state === "changed") prisma.pushDevice.findFirst = async () => null;
    if (state === "leased") prisma.pushDevice.updateMany = async () => ({ count: 0 });
    await service.dispatch();
    assert.equal(calls.sends.length, 0, state);
  }
});

test("이미 읽거나 삭제된 알림은 보내지 않는다", async () => {
  for (const value of [null, { readAt: now }]) {
    const { service, prisma, calls } = fixture();
    prisma.notification.findUnique = async () => value;
    await service.dispatch();
    assert.equal(calls.sends.length, 0);
  }
});

test("기기 제거는 현재 세션과 사용자로 한정한다", async () => {
  const { service, calls } = fixture();
  await service.remove({ sub: "owner", sid: "current" }, "device");
  assert.deepEqual(calls.deletes[0].where, { id: "device", sessionId: "current", session: { userId: "owner" } });
});

test("동일 세션의 토큰 회전은 커서를 유지하고 다른 계정은 새 경계로 시작한다", async () => {
  for (const sessionId of ["current", "old"]) {
    let saved;
    const tx = { pushDevice: {
      findUnique: async () => ({ sessionId }), deleteMany: async () => ({}),
      upsert: async (q) => { saved = q; },
    } };
    const service = new PushService({ $transaction: (fn) => fn(tx) }, {});
    service.enabled = () => true;
    await service.register({ sub: "owner", sid: "current" }, { installationId: "id", token: "new-token" });
    assert.equal(saved.update.token, "new-token");
    assert.match(saved.update.tokenHash, /^[a-f0-9]{64}$/);
    assert.equal(Boolean(saved.update.cursorAt), sessionId !== "current");
    assert.equal(saved.update.sessionId, "current");
  }
});

test("FCM 전송은 인증된 HTTP v1을 쓰고 UNREGISTERED만 만료로 처리한다", async () => {
  const previous = process.env.FIREBASE_PROJECT_ID;
  process.env.FIREBASE_PROJECT_ID = "synthetic-project";
  try {
    const sender = new FcmSender();
    let request;
    sender.auth.getClient = async () => ({ request: async (q) => { request = q; } });
    const payload = { token: "synthetic-token", userId: "user", notificationId: "id", eventId: "id:1" };
    assert.equal(await sender.send(payload), "sent");
    assert.equal(request.data.message.notification, undefined);
    assert.equal(request.data.message.android.priority, "HIGH");
    assert.equal(request.url, "https://fcm.googleapis.com/v1/projects/synthetic-project/messages:send");
    for (const [code, expected] of [["UNREGISTERED", "invalid"], ["INVALID_ARGUMENT", "retry"], ["SENDER_ID_MISMATCH", "retry"]]) {
      sender.auth.getClient = async () => ({ request: async () => { throw { response: { data: { error: { details: [{ errorCode: code }] } } } }; } });
      assert.equal(await sender.send(payload), expected);
    }
  } finally { if (previous === undefined) delete process.env.FIREBASE_PROJECT_ID; else process.env.FIREBASE_PROJECT_ID = previous; }
});
