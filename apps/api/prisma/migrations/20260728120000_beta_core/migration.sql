-- Authentication and invite-only beta
CREATE TYPE "VerificationTokenType" AS ENUM ('EMAIL_VERIFY', 'PASSWORD_RESET');
CREATE TYPE "MediaStatus" AS ENUM ('UPLOADING', 'READY', 'FAILED');

ALTER TABLE "User" DROP COLUMN "refreshTokenHash";

ALTER TABLE "User"
  ADD COLUMN "timezone" TEXT NOT NULL DEFAULT 'Asia/Seoul',
  ADD COLUMN "onboardingCompletedAt" TIMESTAMP(3),
  ADD COLUMN "avatarMediaId" TEXT;

ALTER TABLE "Media"
  ADD COLUMN "status" "MediaStatus" NOT NULL DEFAULT 'UPLOADING',
  ADD COLUMN "originalName" VARCHAR(120),
  ADD COLUMN "width" INTEGER,
  ADD COLUMN "height" INTEGER,
  ADD COLUMN "completedAt" TIMESTAMP(3);

UPDATE "Media"
SET "status" = 'READY', "completedAt" = "createdAt";

CREATE UNIQUE INDEX "User_avatarMediaId_key" ON "User"("avatarMediaId");
ALTER TABLE "User" ADD CONSTRAINT "User_avatarMediaId_fkey" FOREIGN KEY ("avatarMediaId") REFERENCES "Media"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Notification"
  ADD COLUMN "targetType" TEXT,
  ADD COLUMN "targetId" TEXT;

UPDATE "Notification"
SET
  "targetType" = CASE
    WHEN "type" IN ('CHEER', 'COMMENT', 'COPY') THEN 'POST'
    WHEN "type" = 'FOLLOW' THEN 'USER'
    WHEN "type" = 'CHALLENGE' THEN 'CHALLENGE'
    ELSE NULL
  END,
  "targetId" = "referenceId";

CREATE TABLE "Session" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "familyId" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "userAgent" VARCHAR(300),
  "ipHash" TEXT,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "lastUsedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "revokedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "VerificationToken" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "type" "VerificationTokenType" NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "usedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "VerificationToken_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "InviteCode" (
  "id" TEXT NOT NULL,
  "codeHash" TEXT NOT NULL,
  "label" VARCHAR(100),
  "maxUses" INTEGER NOT NULL DEFAULT 1,
  "uses" INTEGER NOT NULL DEFAULT 0,
  "expiresAt" TIMESTAMP(3),
  "disabledAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "InviteCode_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Session_userId_revokedAt_idx" ON "Session"("userId", "revokedAt");
CREATE INDEX "Session_familyId_idx" ON "Session"("familyId");
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");
CREATE UNIQUE INDEX "VerificationToken_tokenHash_key" ON "VerificationToken"("tokenHash");
CREATE INDEX "VerificationToken_userId_type_expiresAt_idx" ON "VerificationToken"("userId", "type", "expiresAt");
CREATE UNIQUE INDEX "InviteCode_codeHash_key" ON "InviteCode"("codeHash");
CREATE INDEX "InviteCode_expiresAt_disabledAt_idx" ON "InviteCode"("expiresAt", "disabledAt");
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "VerificationToken" ADD CONSTRAINT "VerificationToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "IdempotencyKey" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "key" VARCHAR(100) NOT NULL,
  "route" VARCHAR(300) NOT NULL,
  "response" JSONB,
  "completedAt" TIMESTAMP(3),
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "IdempotencyKey_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "IdempotencyKey_userId_key_route_key" ON "IdempotencyKey"("userId", "key", "route");
CREATE INDEX "IdempotencyKey_expiresAt_idx" ON "IdempotencyKey"("expiresAt");
ALTER TABLE "IdempotencyKey" ADD CONSTRAINT "IdempotencyKey_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Recurring TODO templates and materialized occurrences
CREATE TABLE "TodoSeries" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "title" VARCHAR(120) NOT NULL,
  "notes" VARCHAR(500),
  "category" TEXT NOT NULL DEFAULT '생활',
  "visibility" "Visibility" NOT NULL DEFAULT 'PRIVATE',
  "repeatRule" TEXT NOT NULL,
  "timezone" TEXT NOT NULL DEFAULT 'Asia/Seoul',
  "startAt" TIMESTAMP(3) NOT NULL,
  "endsAt" TIMESTAMP(3),
  "generatedThrough" TIMESTAMP(3),
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TodoSeries_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "Todo"
  ADD COLUMN "seriesId" TEXT,
  ADD COLUMN "occurrenceKey" TEXT;

CREATE UNIQUE INDEX "Todo_occurrenceKey_key" ON "Todo"("occurrenceKey");
CREATE INDEX "Todo_seriesId_dueDate_idx" ON "Todo"("seriesId", "dueDate");
CREATE INDEX "TodoSeries_userId_active_idx" ON "TodoSeries"("userId", "active");
CREATE INDEX "TodoSeries_generatedThrough_idx" ON "TodoSeries"("generatedThrough");
ALTER TABLE "TodoSeries" ADD CONSTRAINT "TodoSeries_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Todo" ADD CONSTRAINT "Todo_seriesId_fkey" FOREIGN KEY ("seriesId") REFERENCES "TodoSeries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

INSERT INTO "TodoSeries" (
  "id", "userId", "title", "notes", "category", "visibility", "repeatRule",
  "timezone", "startAt", "generatedThrough", "active", "createdAt", "updatedAt"
)
SELECT
  'series_' || "Todo"."id",
  "Todo"."userId",
  "Todo"."title",
  "Todo"."notes",
  "Todo"."category",
  "Todo"."visibility",
  CASE
    WHEN "Todo"."repeatRule" = 'DAILY' THEN 'FREQ=DAILY'
    WHEN "Todo"."repeatRule" = 'WEEKDAYS' THEN 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR'
    WHEN "Todo"."repeatRule" = 'WEEKLY' THEN 'FREQ=WEEKLY'
    ELSE "Todo"."repeatRule"
  END,
  COALESCE("User"."timezone", 'Asia/Seoul'),
  "Todo"."dueDate",
  "Todo"."dueDate",
  true,
  "Todo"."createdAt",
  "Todo"."updatedAt"
FROM "Todo"
JOIN "User" ON "User"."id" = "Todo"."userId"
WHERE "Todo"."repeatRule" IS NOT NULL;

UPDATE "Todo"
SET
  "seriesId" = 'series_' || "id",
  "occurrenceKey" = 'series_' || "id" || ':' || "dueDate"::text,
  "repeatRule" = CASE
    WHEN "repeatRule" = 'DAILY' THEN 'FREQ=DAILY'
    WHEN "repeatRule" = 'WEEKDAYS' THEN 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR'
    WHEN "repeatRule" = 'WEEKLY' THEN 'FREQ=WEEKLY'
    ELSE "repeatRule"
  END
WHERE "repeatRule" IS NOT NULL;

-- Make point rewards idempotent before adding the unique key.
DELETE FROM "PointLedger"
WHERE "id" IN (
  SELECT "id" FROM (
    SELECT
      "id",
      ROW_NUMBER() OVER (
        PARTITION BY "userId", "reason", "referenceId"
        ORDER BY "createdAt", "id"
      ) AS row_number
    FROM "PointLedger"
    WHERE "referenceId" IS NOT NULL
  ) duplicates
  WHERE duplicates.row_number > 1
);

CREATE UNIQUE INDEX "PointLedger_userId_reason_referenceId_key"
ON "PointLedger"("userId", "reason", "referenceId");
