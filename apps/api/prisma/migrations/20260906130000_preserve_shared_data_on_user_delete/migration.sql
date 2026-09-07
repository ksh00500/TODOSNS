ALTER TABLE "Challenge" DROP CONSTRAINT "Challenge_creatorId_fkey";
ALTER TABLE "Challenge" ALTER COLUMN "creatorId" DROP NOT NULL;
ALTER TABLE "Challenge"
ADD CONSTRAINT "Challenge_creatorId_fkey"
FOREIGN KEY ("creatorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "AdminAuditLog" DROP CONSTRAINT "AdminAuditLog_adminId_fkey";
ALTER TABLE "AdminAuditLog" ALTER COLUMN "adminId" DROP NOT NULL;
ALTER TABLE "AdminAuditLog"
ADD CONSTRAINT "AdminAuditLog_adminId_fkey"
FOREIGN KEY ("adminId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
