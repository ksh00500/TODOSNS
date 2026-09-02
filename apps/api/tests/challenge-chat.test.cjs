const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("모든 챌린지는 고유한 참여자 전용 대화방과 90일 수명을 갖는다", () => {
  const schema = read("prisma/schema.prisma");
  const migration = read("prisma/migrations/20260830170000_challenge_group_chat/migration.sql");
  assert.match(schema, /enum ConversationKind[\s\S]*DIRECT[\s\S]*CHALLENGE/);
  assert.match(schema, /challengeId\s+String\?\s+@unique/);
  assert.match(schema, /model ConversationMute/);
  assert.match(schema, /model MessageRevision/);
  assert.match(schema, /model MessageReaction/);
  assert.match(migration, /INSERT INTO "Conversation"[\s\S]*'CHALLENGE'/);
  assert.match(migration, /INSERT INTO "ConversationMember"[\s\S]*ChallengeParticipant/);
  assert.match(migration, /INTERVAL '90 days'/);
  assert.match(migration, /WHERE "kind" = 'COMMUNITY'[\s\S]*ON CONFLICT/);
});

test("챌린지 채팅 API는 메시지·반응·읽음·알림·방장 조치를 분리한다", () => {
  const controllers = read("src/controllers.ts");
  for (const route of ["read", "settings", "messages/:messageId/revisions", "messages/:messageId/reactions", "members/:userId/mute", "members/:userId/unmute"]) assert.match(controllers, new RegExp(`\\(\"${route.replaceAll("/", "\\/")}\"\\)`));
  assert.match(controllers, /reports\/:id\/message-context/);
  assert.match(controllers, /chat\/messages\/:messageId\/visibility/);
});

test("참여·종료·채팅 제한은 모든 변경 경로에서 다시 검사된다", () => {
  const service = read("src/challenge-chat.service.ts");
  assert.match(service, /private async context\([\s\S]*members: \{ where: \{ userId \}/);
  assert.match(service, /async send[\s\S]*assertWritable/);
  assert.match(service, /async update[\s\S]*assertWritable/);
  assert.match(service, /async toggleReaction[\s\S]*assertWritable/);
  assert.match(service, /effectiveEnd <= new Date\(\)/);
  assert.match(service, /conversationMute\.findFirst[\s\S]*expiresAt: \{ gt: new Date\(\) \}/);
  assert.match(service, /Date\.now\(\) - message\.createdAt\.getTime\(\) > 5 \* 60_000/);
});

test("사진·답장·복수 반응과 방별 단일 알림 계약을 지킨다", () => {
  const service = read("src/challenge-chat.service.ts");
  const media = read("src/media.service.ts");
  assert.match(service, /mediaIds\.length > 4/);
  assert.match(service, /replyToId[\s\S]*conversationId: context\.room\.id/);
  assert.match(schemaOf(), /@@id\(\[messageId, userId, type\]\)/);
  assert.match(media, /async attachToMessage[\s\S]*status: MediaStatus\.READY/);
  assert.match(media, /async purgeMessageMedia/);
  assert.match(service, /notification\.upsert[\s\S]*userId_chatConversationId/);
  assert.match(service, /ChatNotificationLevel\.REPLIES/);
  assert.match(service, /blocked\.has\(member\.userId\)/);
});

test("종료·삭제·신고 감사와 1대1 API 우회 차단이 고정된다", () => {
  const service = read("src/challenge-chat.service.ts");
  const mungsil = read("src/mungsil.service.ts");
  assert.match(service, /CHAT_PURGE_WARNING/);
  assert.match(service, /purgeMessageMedia[\s\S]*conversation\.delete/);
  assert.match(service, /take: 3[\s\S]*targetMessageId/);
  assert.match(service, /CHAT_MESSAGE_HIDDEN/);
  assert.match(mungsil, /async messages[\s\S]*kind: ConversationKind\.DIRECT/);
  assert.match(mungsil, /async sendMessage[\s\S]*kind: ConversationKind\.DIRECT/);
});

function schemaOf() {
  return read("prisma/schema.prisma");
}
