ALTER TYPE "VerificationMode" ADD VALUE IF NOT EXISTS 'PEER_PHOTO';
ALTER TYPE "ReportTarget" ADD VALUE IF NOT EXISTS 'CHALLENGE_CHECK_IN';

CREATE TYPE "VerificationVoteVerdict" AS ENUM ('APPROVE', 'RETRY', 'UNSURE');

ALTER TABLE "Challenge"
  ADD COLUMN "verificationCriteria" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "minimumParticipants" INTEGER NOT NULL DEFAULT 8;

ALTER TABLE "ChallengeCheckIn"
  ADD COLUMN "attempt" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "reviewSize" INTEGER NOT NULL DEFAULT 5,
  ADD COLUMN "approvalTarget" INTEGER NOT NULL DEFAULT 4,
  ADD COLUMN "rejectionTarget" INTEGER NOT NULL DEFAULT 2,
  ADD COLUMN "reverifyUsed" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "retryUntil" TIMESTAMP(3),
  ADD COLUMN "hiddenAt" TIMESTAMP(3),
  ADD COLUMN "moderationNote" VARCHAR(300),
  ADD COLUMN "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE "Report" ADD COLUMN "checkInRefId" TEXT;
CREATE INDEX "Report_checkInRefId_idx" ON "Report"("checkInRefId");
ALTER TABLE "Report" ADD CONSTRAINT "Report_checkInRefId_fkey" FOREIGN KEY ("checkInRefId") REFERENCES "ChallengeCheckIn"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "ChallengeVerificationVote" (
  "id" TEXT NOT NULL,
  "checkInId" TEXT NOT NULL,
  "voterId" TEXT NOT NULL,
  "attempt" INTEGER NOT NULL,
  "verdict" "VerificationVoteVerdict" NOT NULL,
  "failedCriteria" INTEGER[] NOT NULL DEFAULT ARRAY[]::INTEGER[],
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ChallengeVerificationVote_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ChallengeVerificationVote_checkInId_voterId_attempt_key"
  ON "ChallengeVerificationVote"("checkInId", "voterId", "attempt");
CREATE INDEX "ChallengeVerificationVote_checkInId_attempt_verdict_idx"
  ON "ChallengeVerificationVote"("checkInId", "attempt", "verdict");
CREATE INDEX "ChallengeVerificationVote_voterId_createdAt_idx"
  ON "ChallengeVerificationVote"("voterId", "createdAt");

ALTER TABLE "ChallengeVerificationVote"
  ADD CONSTRAINT "ChallengeVerificationVote_checkInId_fkey" FOREIGN KEY ("checkInId") REFERENCES "ChallengeCheckIn"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "ChallengeVerificationVote_voterId_fkey" FOREIGN KEY ("voterId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
