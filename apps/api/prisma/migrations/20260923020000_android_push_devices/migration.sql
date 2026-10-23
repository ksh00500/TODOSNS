BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

CREATE TABLE "PushDevice" (
  "id" TEXT NOT NULL,
  "token" VARCHAR(4096) NOT NULL,
  "tokenHash" CHAR(64) NOT NULL,
  "sessionId" TEXT NOT NULL,
  "cursorAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "cursorId" TEXT NOT NULL DEFAULT '',
  "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "failures" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PushDevice_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PushDevice_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "PushDevice_tokenHash_key" ON "PushDevice"("tokenHash");
CREATE INDEX "PushDevice_nextAttemptAt_idx" ON "PushDevice"("nextAttemptAt");
CREATE INDEX "PushDevice_sessionId_idx" ON "PushDevice"("sessionId");
CREATE INDEX "Notification_userId_updatedAt_id_idx" ON "Notification"("userId", "updatedAt", "id");

-- Production runtime has no default DML grants on newly created tables.
-- Local single-role databases may not have the separated roles yet.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mungsil_runtime') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public."PushDevice" TO mungsil_runtime;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mungsil_backup') THEN
    GRANT SELECT ON TABLE public."PushDevice" TO mungsil_backup;
  END IF;
END $$;
COMMIT;
