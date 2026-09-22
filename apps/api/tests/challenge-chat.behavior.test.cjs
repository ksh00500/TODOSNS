const assert = require("node:assert/strict");
const test = require("node:test");
const { ConflictException, ForbiddenException } = require("@nestjs/common");
const { ChatReactionType, ChallengeKind, MessageKind, Role } = require("@prisma/client");
const { ChallengeChatService } = require("../dist/src/challenge-chat.service.js");

const activeContext = () => ({
  room: { id: "challenge-room", readOnlyAt: null },
  challenge: {
    id: "challenge",
    title: "합성 챌린지",
    kind: ChallengeKind.COMMUNITY,
    creatorId: "owner",
    endsAt: new Date(Date.now() + 86_400_000),
    endedAt: null,
  },
  member: { userId: "member", lastReadAt: null, notificationLevel: "ALL" },
});

function harness({ ended = false, muted = false, member = true } = {}) {
  const state = { messageWrites: 0, reactionWrites: 0 };
  const context = activeContext();
  if (ended) context.room.readOnlyAt = new Date();
  const row = {
    id: "message",
    conversationId: context.room.id,
    senderId: "member",
    sender: { id: "member", nickname: "참여자", handle: "member", avatarUrl: null, avatarMedia: null, lifetimePower: 0 },
    kind: MessageKind.USER,
    body: "기존 기록",
    replyTo: null,
    media: [],
    reactions: [],
    createdAt: new Date(),
    editedAt: null,
    deletedAt: null,
    hiddenAt: null,
  };
  const prisma = {
    conversationMute: {
      findFirst: async () => muted ? { expiresAt: new Date(Date.now() + 3_600_000) } : null,
    },
    message: {
      findUnique: async () => row,
      findFirst: async () => row,
      findUniqueOrThrow: async () => row,
      create: async () => { state.messageWrites += 1; return row; },
      update: async ({ data }) => { state.messageWrites += 1; Object.assign(row, data); return row; },
    },
    messageReaction: {
      findUnique: async () => null,
      create: async () => { state.reactionWrites += 1; return {}; },
      delete: async () => { state.reactionWrites += 1; return {}; },
    },
  };
  const service = new ChallengeChatService(prisma, {}, { publish: () => undefined });
  service.context = async () => {
    if (!member) throw new ForbiddenException("이 대화방은 챌린지 참여자만 볼 수 있어요.");
    return context;
  };
  service.contextByConversation = service.context;
  service.ownedMessage = async () => row;
  return { service, state, context, row };
}

const modifications = (service) => [
  () => service.send("member", Role.USER, "challenge", { body: "새 메시지" }),
  () => service.update("member", Role.USER, "message", "수정"),
  () => service.toggleReaction("member", Role.USER, "message", ChatReactionType.CHEER),
  () => service.remove("member", "message"),
];

test("활성 챌린지 참여자는 자신의 메시지를 삭제할 수 있다", async () => {
  const { service, state, row } = harness();
  await assert.doesNotReject(service.remove("member", "message"));
  assert.equal(state.messageWrites, 1);
  assert.ok(row.deletedAt instanceof Date);
});

test("종료된 챌린지는 전송·수정·반응·삭제를 모두 거부하고 기록을 보존한다", async () => {
  const { service, state, row } = harness({ ended: true });
  for (const modify of modifications(service)) await assert.rejects(modify, ConflictException);
  assert.equal(state.messageWrites, 0);
  assert.equal(state.reactionWrites, 0);
  assert.equal(row.deletedAt, null);
});

test("채팅 제한 중에는 전송·수정·반응·삭제를 모두 거부하고 기록을 보존한다", async () => {
  const { service, state, row } = harness({ muted: true });
  for (const modify of modifications(service)) await assert.rejects(modify, ForbiddenException);
  assert.equal(state.messageWrites, 0);
  assert.equal(state.reactionWrites, 0);
  assert.equal(row.deletedAt, null);
});

test("탈퇴 등으로 멤버십이 없어진 사용자는 모든 메시지 변경을 거부한다", async () => {
  const { service, state } = harness({ member: false });
  for (const modify of modifications(service)) await assert.rejects(modify, ForbiddenException);
  assert.equal(state.messageWrites, 0);
  assert.equal(state.reactionWrites, 0);
});

test("읽기 전용 응답은 내 메시지 정렬 정보는 유지하고 수정·삭제 권한만 제거한다", async () => {
  const { service, context, row } = harness({ ended: true });
  const serialized = await service.serialize(row, "member", Role.USER, context, new Set(), false);
  assert.equal(serialized.isMine, true);
  assert.equal(serialized.canEdit, false);
  assert.equal(serialized.canDelete, false);
  assert.equal(serialized.body, "기존 기록");
});
