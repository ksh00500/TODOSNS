const assert = require("node:assert/strict");
const test = require("node:test");
const { ForbiddenException, NotFoundException } = require("@nestjs/common");
const { ChatReactionType, MessageKind } = require("@prisma/client");
const { DirectChatService } = require("../dist/src/direct-chat.service.js");

const user = (id) => ({
  id,
  nickname: `사용자 ${id}`,
  handle: id,
  avatarUrl: null,
  avatarMedia: null,
  lifetimePower: 0,
});

function harness({ blocks = [], viewerId = "a" } = {}) {
  const now = new Date("2026-09-16T00:00:00.000Z");
  const state = {
    blocks,
    updates: 0,
    creates: 0,
    reactions: 0,
    memberUpdates: 0,
    notificationsRead: 0,
    events: [],
    messages: [
      {
        id: "message-a",
        conversationId: "direct-room",
        senderId: "a",
        sender: user("a"),
        kind: MessageKind.USER,
        body: "보존할 메시지",
        replyTo: null,
        media: [],
        reactions: [],
        createdAt: now,
        deletedAt: null,
        hiddenAt: null,
      },
      {
        id: "message-b",
        conversationId: "direct-room",
        senderId: "b",
        sender: user("b"),
        kind: MessageKind.USER,
        body: "상대 메시지",
        replyTo: null,
        media: [],
        reactions: [],
        createdAt: new Date(now.getTime() + 1_000),
        deletedAt: null,
        hiddenAt: null,
      },
    ],
  };
  const room = {
    id: "direct-room",
    kind: "DIRECT",
    members: [
      { userId: "a", user: user("a"), lastReadAt: null },
      { userId: "b", user: user("b"), lastReadAt: null },
    ],
  };
  const prisma = {
    conversation: {
      findFirst: async ({ where }) => room.members.some((member) => member.userId === where.members.some.userId) ? room : null,
      update: async () => ({}),
    },
    block: {
      findMany: async () => state.blocks,
      count: async () => state.blocks.length,
    },
    message: {
      findFirst: async ({ where }) => state.messages.find((message) =>
        message.id === where.id
        && message.conversationId === where.conversationId
        && (where.senderId === undefined || message.senderId === where.senderId)
        && (where.deletedAt === undefined || message.deletedAt === where.deletedAt)
        && (where.hiddenAt === undefined || message.hiddenAt === where.hiddenAt)),
      findMany: async () => [...state.messages].reverse(),
      findUniqueOrThrow: async ({ where }) => state.messages.find((message) => message.id === where.id),
      create: async () => { state.creates += 1; return state.messages[0]; },
      update: async ({ where, data }) => {
        state.updates += 1;
        const message = state.messages.find((item) => item.id === where.id);
        Object.assign(message, data);
        return message;
      },
      count: async () => 0,
    },
    messageReaction: {
      findUnique: async () => null,
      create: async () => { state.reactions += 1; return {}; },
      delete: async () => { state.reactions += 1; return {}; },
    },
    conversationMember: {
      update: async () => { state.memberUpdates += 1; return {}; },
    },
    notification: {
      updateMany: async () => { state.notificationsRead += 1; return { count: 1 }; },
    },
  };
  const media = {
    readyOwned: async () => ({}),
    attachToMessage: async () => undefined,
    viewUrl: async (key) => key,
  };
  const events = { publish: (event) => state.events.push(event) };
  return { service: new DirectChatService(prisma, media, events), state, viewerId };
}

function requestHarness({ blocked = false } = {}) {
  const state = { requestWrites: 0, conversationWrites: 0, conversationMembers: [] };
  const request = { id: "request-a-b", senderId: "a", receiverId: "b", status: "PENDING" };
  const prisma = {
    user: {
      findFirst: async ({ where }) => where.id === "b" ? { id: "b" } : null,
      findUniqueOrThrow: async () => ({ nickname: "사용자 A", handle: "a" }),
    },
    block: { count: async () => blocked ? 1 : 0 },
    conversation: {
      findMany: async () => [],
      create: async ({ data }) => {
        state.conversationWrites += 1;
        state.conversationMembers = data.members.create.map((member) => member.userId);
        return { id: "direct-room", ...data };
      },
    },
    messageRequest: {
      findUnique: async () => null,
      findFirst: async ({ where }) => where.id === request.id && where.receiverId === request.receiverId ? request : null,
      upsert: async () => { state.requestWrites += 1; return request; },
      update: async () => { state.requestWrites += 1; return { ...request, status: "ACCEPTED" }; },
    },
    follow: { count: async () => 0 },
    notification: { create: async () => ({}) },
  };
  const service = new DirectChatService(prisma, {}, {});
  return { service, state, request };
}

test("차단 전 자신의 1:1 메시지는 삭제되고 삭제 이벤트가 발행된다", async () => {
  const { service, state } = harness();
  await assert.doesNotReject(service.remove("a", "direct-room", "message-a"));
  assert.equal(state.updates, 1);
  assert.ok(state.messages[0].deletedAt instanceof Date);
  assert.deepEqual(state.events.map((event) => event.type), ["message.deleted"]);
});

for (const block of [
  { blockerId: "a", blockedId: "b" },
  { blockerId: "b", blockedId: "a" },
]) {
  test(`${block.blockerId}가 차단한 뒤에는 전송·답장·반응·삭제를 모두 거부하고 기록을 보존한다`, async () => {
    const { service, state } = harness({ blocks: [block] });
    const operations = [
      () => service.send("a", "direct-room", { body: "새 메시지" }),
      () => service.send("a", "direct-room", { body: "답장", replyToId: "message-b" }),
      () => service.toggleReaction("a", "direct-room", "message-b", ChatReactionType.CHEER),
      () => service.remove("a", "direct-room", "message-a"),
    ];
    for (const operation of operations) await assert.rejects(operation, ForbiddenException);
    assert.equal(state.creates, 0);
    assert.equal(state.reactions, 0);
    assert.equal(state.updates, 0);
    assert.equal(state.messages[0].deletedAt, null);
  });
}

test("대화 비멤버는 전송·답장·반응·삭제에 접근할 수 없다", async () => {
  const { service, state } = harness();
  const operations = [
    () => service.send("outsider", "direct-room", { body: "새 메시지" }),
    () => service.send("outsider", "direct-room", { body: "답장", replyToId: "message-b" }),
    () => service.toggleReaction("outsider", "direct-room", "message-b", ChatReactionType.CHEER),
    () => service.remove("outsider", "direct-room", "message-a"),
  ];
  for (const operation of operations) await assert.rejects(operation, NotFoundException);
  assert.equal(state.creates, 0);
  assert.equal(state.reactions, 0);
  assert.equal(state.updates, 0);
});

test("차단된 대화 응답은 소유권과 삭제 권한을 분리한다", async () => {
  const { service } = harness({ blocks: [{ blockerId: "b", blockedId: "a" }] });
  const page = await service.chat("a", "direct-room", { limit: 30 });
  const mine = page.items.find((message) => message.id === "message-a");
  const other = page.items.find((message) => message.id === "message-b");
  assert.equal(page.room.canSend, false);
  assert.equal(mine.isMine, true);
  assert.equal(mine.canDelete, false);
  assert.equal(other.isMine, false);
  assert.equal(other.blocked, true);
});

test("읽음 위치 갱신은 차단 뒤에도 허용해 기존 기록 열람을 보존한다", async () => {
  const { service, state } = harness({ blocks: [{ blockerId: "a", blockedId: "b" }] });
  await assert.doesNotReject(service.markRead("a", "direct-room", "message-b"));
  assert.equal(state.memberUpdates, 1);
  assert.equal(state.notificationsRead, 1);
  assert.equal(state.updates, 0);
});

test("메시지 요청과 수락은 차단 관계를 쓰기 직전에 다시 검사한다", async () => {
  const { service, state, request } = requestHarness({ blocked: true });
  await assert.rejects(() => service.start("a", "b"), ForbiddenException);
  await assert.rejects(() => service.accept("b", request.id), ForbiddenException);
  assert.equal(state.requestWrites, 0);
  assert.equal(state.conversationWrites, 0);
});

test("수락 권한은 수신자에게만 있고 정상 수락은 두 사용자를 모두 멤버로 만든다", async () => {
  const denied = requestHarness();
  await assert.rejects(() => denied.service.accept("outsider", denied.request.id), NotFoundException);
  assert.equal(denied.state.requestWrites, 0);
  assert.equal(denied.state.conversationWrites, 0);

  const accepted = requestHarness();
  const result = await accepted.service.accept("b", accepted.request.id);
  assert.equal(result.conversationId, "direct-room");
  assert.deepEqual(accepted.state.conversationMembers.sort(), ["a", "b"]);
});
