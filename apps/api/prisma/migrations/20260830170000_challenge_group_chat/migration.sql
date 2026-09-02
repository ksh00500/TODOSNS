CREATE TYPE "ConversationKind" AS ENUM ('DIRECT', 'CHALLENGE');
CREATE TYPE "ChatNotificationLevel" AS ENUM ('ALL', 'REPLIES', 'NONE');
CREATE TYPE "MessageKind" AS ENUM ('USER', 'SYSTEM');
CREATE TYPE "ChatReactionType" AS ENUM ('LIKE', 'HELPFUL', 'CHEER', 'EMPATHY', 'SEEN');
CREATE TYPE "ChatModerationActionType" AS ENUM ('HIDE_MESSAGE', 'RESTORE_MESSAGE', 'MUTE_MEMBER', 'UNMUTE_MEMBER');

ALTER TABLE "Challenge" ADD COLUMN "endedAt" TIMESTAMP(3);

ALTER TABLE "Conversation"
  ADD COLUMN "kind" "ConversationKind" NOT NULL DEFAULT 'DIRECT',
  ADD COLUMN "challengeId" TEXT,
  ADD COLUMN "readOnlyAt" TIMESTAMP(3),
  ADD COLUMN "purgeAt" TIMESTAMP(3);

ALTER TABLE "ConversationMember"
  ADD COLUMN "lastReadMessageId" TEXT,
  ADD COLUMN "notificationLevel" "ChatNotificationLevel" NOT NULL DEFAULT 'ALL';

ALTER TABLE "Message"
  ALTER COLUMN "senderId" DROP NOT NULL,
  ALTER COLUMN "body" DROP NOT NULL,
  ADD COLUMN "replyToId" TEXT,
  ADD COLUMN "kind" "MessageKind" NOT NULL DEFAULT 'USER',
  ADD COLUMN "systemKey" TEXT,
  ADD COLUMN "editedAt" TIMESTAMP(3),
  ADD COLUMN "hiddenAt" TIMESTAMP(3),
  ADD COLUMN "hiddenById" TEXT,
  ADD COLUMN "hiddenReason" VARCHAR(300);

ALTER TABLE "Message" DROP CONSTRAINT "Message_senderId_fkey";
ALTER TABLE "Message" ADD CONSTRAINT "Message_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Notification"
  ADD COLUMN "chatConversationId" TEXT,
  ADD COLUMN "unreadCount" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE "Media"
  ADD COLUMN "messageId" TEXT,
  ADD COLUMN "messageOrder" INTEGER;

CREATE TABLE "MessageRevision" (
  "id" TEXT NOT NULL,
  "messageId" TEXT NOT NULL,
  "body" VARCHAR(2000),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MessageRevision_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MessageReaction" (
  "messageId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "type" "ChatReactionType" NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MessageReaction_pkey" PRIMARY KEY ("messageId", "userId", "type")
);

CREATE TABLE "ConversationMute" (
  "id" TEXT NOT NULL,
  "conversationId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "mutedById" TEXT NOT NULL,
  "reason" VARCHAR(300) NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "revokedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ConversationMute_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ChatModerationAction" (
  "id" TEXT NOT NULL,
  "conversationId" TEXT NOT NULL,
  "actorId" TEXT NOT NULL,
  "targetUserId" TEXT,
  "messageId" TEXT,
  "type" "ChatModerationActionType" NOT NULL,
  "reason" VARCHAR(300) NOT NULL,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ChatModerationAction_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Conversation_challengeId_key" ON "Conversation"("challengeId");
CREATE INDEX "Conversation_kind_updatedAt_idx" ON "Conversation"("kind", "updatedAt");
CREATE INDEX "Conversation_purgeAt_idx" ON "Conversation"("purgeAt");
CREATE INDEX "ConversationMember_userId_lastReadAt_idx" ON "ConversationMember"("userId", "lastReadAt");
CREATE UNIQUE INDEX "Message_conversationId_systemKey_key" ON "Message"("conversationId", "systemKey");
CREATE INDEX "Message_replyToId_idx" ON "Message"("replyToId");
CREATE INDEX "MessageRevision_messageId_createdAt_idx" ON "MessageRevision"("messageId", "createdAt");
CREATE INDEX "MessageReaction_userId_createdAt_idx" ON "MessageReaction"("userId", "createdAt");
CREATE INDEX "ConversationMute_conversationId_userId_expiresAt_idx" ON "ConversationMute"("conversationId", "userId", "expiresAt");
CREATE INDEX "ChatModerationAction_conversationId_createdAt_idx" ON "ChatModerationAction"("conversationId", "createdAt");
CREATE INDEX "ChatModerationAction_actorId_createdAt_idx" ON "ChatModerationAction"("actorId", "createdAt");
CREATE UNIQUE INDEX "Notification_userId_chatConversationId_key" ON "Notification"("userId", "chatConversationId");
CREATE INDEX "Media_messageId_messageOrder_idx" ON "Media"("messageId", "messageOrder");

ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_challengeId_fkey" FOREIGN KEY ("challengeId") REFERENCES "Challenge"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Message" ADD CONSTRAINT "Message_replyToId_fkey" FOREIGN KEY ("replyToId") REFERENCES "Message"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "MessageRevision" ADD CONSTRAINT "MessageRevision_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "Message"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MessageReaction" ADD CONSTRAINT "MessageReaction_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "Message"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MessageReaction" ADD CONSTRAINT "MessageReaction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ConversationMute" ADD CONSTRAINT "ConversationMute_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ChatModerationAction" ADD CONSTRAINT "ChatModerationAction_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_chatConversationId_fkey" FOREIGN KEY ("chatConversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Media" ADD CONSTRAINT "Media_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "Message"("id") ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "ChallengeParticipant" ("challengeId", "userId", "joinedAt", "rewardStatus")
SELECT "id", "creatorId", "createdAt", 'NOT_ELIGIBLE'::"RewardStatus"
FROM "Challenge"
WHERE "kind" = 'COMMUNITY'
ON CONFLICT ("challengeId", "userId") DO NOTHING;

INSERT INTO "Conversation" ("id", "kind", "challengeId", "readOnlyAt", "purgeAt", "createdAt", "updatedAt")
SELECT
  'chat_' || c."id",
  'CHALLENGE'::"ConversationKind",
  c."id",
  CASE WHEN COALESCE(c."endedAt", c."endsAt") <= CURRENT_TIMESTAMP THEN COALESCE(c."endedAt", c."endsAt") ELSE NULL END,
  COALESCE(c."endedAt", c."endsAt") + INTERVAL '90 days',
  c."createdAt",
  c."updatedAt"
FROM "Challenge" c
ON CONFLICT ("challengeId") DO NOTHING;

INSERT INTO "ConversationMember" ("conversationId", "userId", "joinedAt", "lastReadAt", "notificationLevel")
SELECT c."id", p."userId", p."joinedAt", CURRENT_TIMESTAMP, 'ALL'::"ChatNotificationLevel"
FROM "ChallengeParticipant" p
JOIN "Conversation" c ON c."challengeId" = p."challengeId"
ON CONFLICT ("conversationId", "userId") DO NOTHING;

INSERT INTO "Message" ("id", "conversationId", "kind", "systemKey", "body", "createdAt")
SELECT
  'system_start_' || ch."id",
  c."id",
  'SYSTEM'::"MessageKind",
  'CHALLENGE_STARTED',
  '챌린지가 시작됐어요. 서로에게 도움이 되는 팁과 경험을 나눠보세요.',
  ch."startsAt"
FROM "Challenge" ch
JOIN "Conversation" c ON c."challengeId" = ch."id"
WHERE ch."startsAt" <= CURRENT_TIMESTAMP
ON CONFLICT ("conversationId", "systemKey") DO NOTHING;
