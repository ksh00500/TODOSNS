CREATE TYPE "CheckInStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

ALTER TABLE "Challenge"
  ADD COLUMN "completionThreshold" INTEGER NOT NULL DEFAULT 80,
  ADD COLUMN "firstPlaceTitle" TEXT,
  ADD COLUMN "secondPlaceTitle" TEXT,
  ADD COLUMN "thirdPlaceTitle" TEXT;

ALTER TABLE "ChallengeParticipant"
  ADD COLUMN "finalRank" INTEGER,
  ADD COLUMN "titleAwarded" TEXT,
  ADD COLUMN "completedAt" TIMESTAMP(3);

ALTER TABLE "ChallengeCheckIn"
  ADD COLUMN "status" "CheckInStatus" NOT NULL DEFAULT 'APPROVED',
  ADD COLUMN "reviewNote" VARCHAR(300),
  ADD COLUMN "reviewedAt" TIMESTAMP(3);

CREATE INDEX "ChallengeCheckIn_challengeId_status_idx"
  ON "ChallengeCheckIn"("challengeId", "status");
