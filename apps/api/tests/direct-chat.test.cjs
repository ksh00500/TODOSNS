const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("통합 대화함 API는 요청·읽음·메시지·반응을 분리한다", () => {
  const controllers = read("src/controllers.ts");
  for (const route of ["inbox", "unread-count", "requests", ":id/read", ":id/messages", ":id/messages/:messageId", ":id/messages/:messageId/reactions"]) {
    assert.match(controllers, new RegExp(`\\(\"${route.replaceAll("/", "\\/")}\"\\)`));
  }
  assert.match(controllers, /DirectChatService/);
});

test("통합 대화함은 1대1과 참여 중인 챌린지 방을 최신순으로 반환한다", () => {
  const service = read("src/direct-chat.service.ts");
  assert.match(service, /async inbox/);
  assert.match(service, /kind: ConversationKind\.CHALLENGE/);
  assert.match(service, /kind: "DIRECT" as const/);
  assert.match(service, /kind: "CHALLENGE" as const/);
  assert.match(service, /href: `\/challenges\/\$\{challenge\.id\}\/chat`/);
  assert.match(service, /sort\(\(a, b\)/);
});

test("1대1 메시지는 멤버십과 양방향 차단을 모든 쓰기에서 검사한다", () => {
  const service = read("src/direct-chat.service.ts");
  assert.match(service, /kind: ConversationKind\.DIRECT/);
  assert.match(service, /members: \{ some: \{ userId \} \}/);
  assert.match(service, /private async assertNotBlocked/);
  assert.match(service, /async send[\s\S]*context\.blocked/);
  assert.match(service, /async toggleReaction[\s\S]*context\.blocked/);
  assert.match(service, /blockerId: a, blockedId: b[\s\S]*blockerId: b, blockedId: a/);
});

test("1대1 메시지는 사진·답장·삭제·안 읽은 수와 단일 알림을 제공한다", () => {
  const service = read("src/direct-chat.service.ts");
  assert.match(service, /mediaIds\.length > 4/);
  assert.match(service, /replyToId[\s\S]*conversationId/);
  assert.match(service, /async remove[\s\S]*deletedAt: new Date\(\)/);
  assert.match(service, /async markRead[\s\S]*lastReadMessageId/);
  assert.match(service, /notification\.upsert[\s\S]*userId_chatConversationId/);
  assert.match(service, /targetType: "DIRECT_MESSAGE"/);
});

test("운영자는 신고된 1대1 메시지만 기존 감사 경로로 숨김·복구할 수 있다", () => {
  const service = read("src/challenge-chat.service.ts");
  assert.match(service, /conversation\.kind !== ConversationKind\.DIRECT \|\| !isPrivileged\(role\)/);
  assert.match(service, /message\.conversation\.challenge \? "CHALLENGE_CHAT" : "DIRECT_MESSAGE"/);
  assert.match(service, /CHAT_MESSAGE_HIDDEN/);
});
