-- Expand-only data governance foundation.
-- This migration creates new boundaries and registries but does not move, drop,
-- or rewrite existing service tables. Contract/move phases require a separately
-- reviewed operational migration and isolated restore test.

CREATE SCHEMA IF NOT EXISTS identity;
CREATE SCHEMA IF NOT EXISTS service;
CREATE SCHEMA IF NOT EXISTS governance;
CREATE SCHEMA IF NOT EXISTS security_audit;
CREATE SCHEMA IF NOT EXISTS analytics_restricted;
CREATE SCHEMA IF NOT EXISTS analytics_release;

CREATE TABLE identity."AccountIdentity" (
  "userId" TEXT PRIMARY KEY,
  "email" TEXT NOT NULL UNIQUE,
  "passwordHash" TEXT,
  "googleId" TEXT UNIQUE,
  "birthDate" TIMESTAMP(3) NOT NULL,
  "emailVerifiedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AccountIdentity_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES public."User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE service."ServiceProfile" (
  "userId" TEXT PRIMARY KEY,
  "nickname" TEXT NOT NULL,
  "handle" TEXT NOT NULL UNIQUE,
  "bio" VARCHAR(160),
  "timezone" TEXT NOT NULL DEFAULT 'Asia/Seoul',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ServiceProfile_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES public."User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE governance."PolicyVersion" (
  "id" TEXT PRIMARY KEY,
  "policyType" VARCHAR(80) NOT NULL,
  "version" VARCHAR(40) NOT NULL,
  "documentHash" VARCHAR(64) NOT NULL,
  "status" VARCHAR(20) NOT NULL DEFAULT 'DRAFT',
  "approvedBy" TEXT,
  "approvedAt" TIMESTAMP(3),
  "effectiveAt" TIMESTAMP(3),
  "retiredAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PolicyVersion_status_check" CHECK ("status" IN ('DRAFT', 'APPROVED', 'RETIRED')),
  CONSTRAINT "PolicyVersion_approval_check" CHECK (
    ("status" = 'DRAFT' AND "approvedAt" IS NULL) OR
    ("status" IN ('APPROVED', 'RETIRED') AND "approvedAt" IS NOT NULL AND "approvedBy" IS NOT NULL)
  ),
  UNIQUE ("policyType", "version")
);

CREATE TABLE governance."ProcessingPurpose" (
  "id" TEXT PRIMARY KEY,
  "code" VARCHAR(80) NOT NULL UNIQUE,
  "description" VARCHAR(500) NOT NULL,
  "legalBasisCandidate" VARCHAR(300),
  "reviewStatus" VARCHAR(24) NOT NULL DEFAULT 'PENDING_REVIEW',
  "allowedFields" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "policyVersionId" TEXT,
  "collectionEnabled" BOOLEAN NOT NULL DEFAULT FALSE,
  "approvedBy" TEXT,
  "approvedAt" TIMESTAMP(3),
  "endedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProcessingPurpose_reviewStatus_check" CHECK ("reviewStatus" IN ('PENDING_REVIEW', 'APPROVED', 'REJECTED', 'ENDED')),
  CONSTRAINT "ProcessingPurpose_enablement_check" CHECK (
    "collectionEnabled" = FALSE OR
    ("reviewStatus" = 'APPROVED' AND "approvedAt" IS NOT NULL AND "approvedBy" IS NOT NULL AND "policyVersionId" IS NOT NULL AND "endedAt" IS NULL)
  ),
  CONSTRAINT "ProcessingPurpose_policyVersionId_fkey"
    FOREIGN KEY ("policyVersionId") REFERENCES governance."PolicyVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE governance."ConsentRecord" (
  "id" TEXT PRIMARY KEY,
  "userId" TEXT NOT NULL,
  "purposeId" TEXT NOT NULL,
  "policyVersionId" TEXT NOT NULL,
  "selected" BOOLEAN NOT NULL,
  "recordedAt" TIMESTAMP(3) NOT NULL,
  "withdrawnAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ConsentRecord_userId_fkey" FOREIGN KEY ("userId") REFERENCES public."User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ConsentRecord_purposeId_fkey" FOREIGN KEY ("purposeId") REFERENCES governance."ProcessingPurpose"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ConsentRecord_policyVersionId_fkey" FOREIGN KEY ("policyVersionId") REFERENCES governance."PolicyVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ConsentRecord_withdrawal_check" CHECK ("withdrawnAt" IS NULL OR "withdrawnAt" >= "recordedAt")
);
CREATE INDEX "ConsentRecord_user_purpose_idx" ON governance."ConsentRecord"("userId", "purposeId", "recordedAt" DESC);

CREATE TABLE governance."RetentionPolicy" (
  "id" TEXT PRIMARY KEY,
  "dataClass" VARCHAR(100) NOT NULL,
  "purposeId" TEXT,
  "startEvent" VARCHAR(100) NOT NULL,
  "durationIso" VARCHAR(40),
  "expiryAction" VARCHAR(40) NOT NULL,
  "legalBasisCandidate" VARCHAR(300),
  "reviewStatus" VARCHAR(24) NOT NULL DEFAULT 'PENDING_REVIEW',
  "approvedBy" TEXT,
  "approvedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RetentionPolicy_reviewStatus_check" CHECK ("reviewStatus" IN ('PENDING_REVIEW', 'APPROVED', 'REJECTED', 'RETIRED')),
  CONSTRAINT "RetentionPolicy_approval_check" CHECK (
    "reviewStatus" <> 'APPROVED' OR ("durationIso" IS NOT NULL AND "approvedBy" IS NOT NULL AND "approvedAt" IS NOT NULL)
  ),
  CONSTRAINT "RetentionPolicy_purposeId_fkey" FOREIGN KEY ("purposeId") REFERENCES governance."ProcessingPurpose"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "RetentionPolicy_active_class_purpose_key"
  ON governance."RetentionPolicy"("dataClass", COALESCE("purposeId", ''))
  WHERE "reviewStatus" = 'APPROVED';

CREATE TABLE governance."ErasureRequest" (
  "id" TEXT PRIMARY KEY,
  "subjectUserId" TEXT,
  "policyVersionId" TEXT,
  "requestedAt" TIMESTAMP(3) NOT NULL,
  "executeAfter" TIMESTAMP(3) NOT NULL,
  "status" VARCHAR(20) NOT NULL DEFAULT 'PENDING',
  "startedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "lastErrorCode" VARCHAR(80),
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ErasureRequest_status_check" CHECK ("status" IN ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'CANCELLED')),
  CONSTRAINT "ErasureRequest_subjectUserId_fkey" FOREIGN KEY ("subjectUserId") REFERENCES public."User"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "ErasureRequest_policyVersionId_fkey" FOREIGN KEY ("policyVersionId") REFERENCES governance."PolicyVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ErasureRequest_completion_check" CHECK (("status" = 'COMPLETED') = ("completedAt" IS NOT NULL))
);
CREATE UNIQUE INDEX "ErasureRequest_open_subject_key" ON governance."ErasureRequest"("subjectUserId")
  WHERE "subjectUserId" IS NOT NULL AND "status" IN ('PENDING', 'PROCESSING', 'FAILED');
CREATE INDEX "ErasureRequest_ready_idx" ON governance."ErasureRequest"("status", "executeAfter");

CREATE TABLE governance."ErasureTask" (
  "id" TEXT PRIMARY KEY,
  "requestId" TEXT NOT NULL,
  "scope" VARCHAR(80) NOT NULL,
  "status" VARCHAR(20) NOT NULL DEFAULT 'PENDING',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "lastErrorCode" VARCHAR(80),
  "startedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "evidence" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ErasureTask_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES governance."ErasureRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ErasureTask_status_check" CHECK ("status" IN ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'EXEMPT')),
  CONSTRAINT "ErasureTask_completion_check" CHECK (("status" = 'COMPLETED') = ("completedAt" IS NOT NULL)),
  UNIQUE ("requestId", "scope")
);

CREATE TABLE governance."ObjectDeletionTask" (
  "id" TEXT PRIMARY KEY,
  "mediaId" TEXT,
  "subjectUserId" TEXT,
  "bucket" TEXT NOT NULL,
  "objectKey" TEXT NOT NULL,
  "reason" VARCHAR(80) NOT NULL,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastAttemptAt" TIMESTAMP(3),
  "lastErrorCode" VARCHAR(80),
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ObjectDeletionTask_subjectUserId_fkey" FOREIGN KEY ("subjectUserId") REFERENCES public."User"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ObjectDeletionTask_pending_object_key" ON governance."ObjectDeletionTask"("bucket", "objectKey") WHERE "completedAt" IS NULL;
CREATE INDEX "ObjectDeletionTask_retry_idx" ON governance."ObjectDeletionTask"("nextAttemptAt") WHERE "completedAt" IS NULL;

CREATE TABLE identity."PurposeSubjectMap" (
  "id" TEXT PRIMARY KEY,
  "purposeId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "subjectKey" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PurposeSubjectMap_purposeId_fkey" FOREIGN KEY ("purposeId") REFERENCES governance."ProcessingPurpose"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "PurposeSubjectMap_userId_fkey" FOREIGN KEY ("userId") REFERENCES public."User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  UNIQUE ("purposeId", "userId"),
  UNIQUE ("purposeId", "subjectKey")
);
CREATE INDEX "PurposeSubjectMap_expiry_idx" ON identity."PurposeSubjectMap"("expiresAt");

CREATE TABLE analytics_restricted."AnalyticsEvent" (
  "id" TEXT PRIMARY KEY,
  "purposeId" TEXT NOT NULL,
  "subjectMapId" TEXT NOT NULL,
  "schemaVersion" INTEGER NOT NULL,
  "eventType" VARCHAR(80) NOT NULL,
  "occurredMonth" DATE NOT NULL,
  "broadCategory" VARCHAR(40),
  "countValue" INTEGER NOT NULL DEFAULT 1,
  "completedValue" INTEGER,
  "eligibleValue" INTEGER,
  "ageBand" VARCHAR(20),
  "idempotencyKey" VARCHAR(120) NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AnalyticsEvent_purposeId_fkey" FOREIGN KEY ("purposeId") REFERENCES governance."ProcessingPurpose"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "AnalyticsEvent_subjectMapId_fkey" FOREIGN KEY ("subjectMapId") REFERENCES identity."PurposeSubjectMap"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "AnalyticsEvent_month_check" CHECK (EXTRACT(DAY FROM "occurredMonth") = 1),
  CONSTRAINT "AnalyticsEvent_value_check" CHECK ("countValue" >= 0 AND COALESCE("completedValue", 0) >= 0 AND COALESCE("eligibleValue", 0) >= 0),
  UNIQUE ("purposeId", "idempotencyKey")
);
CREATE INDEX "AnalyticsEvent_expiry_idx" ON analytics_restricted."AnalyticsEvent"("expiresAt");
CREATE INDEX "AnalyticsEvent_month_idx" ON analytics_restricted."AnalyticsEvent"("purposeId", "occurredMonth", "eventType");

CREATE TABLE analytics_restricted."AggregationJob" (
  "id" TEXT PRIMARY KEY,
  "purposeId" TEXT NOT NULL,
  "periodStart" DATE NOT NULL,
  "metric" VARCHAR(80) NOT NULL,
  "processingVersion" INTEGER NOT NULL,
  "status" VARCHAR(20) NOT NULL DEFAULT 'PENDING',
  "startedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "lastErrorCode" VARCHAR(80),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AggregationJob_purposeId_fkey" FOREIGN KEY ("purposeId") REFERENCES governance."ProcessingPurpose"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "AggregationJob_status_check" CHECK ("status" IN ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED')),
  UNIQUE ("purposeId", "periodStart", "metric", "processingVersion")
);

CREATE TABLE analytics_restricted."MonthlyAggregate" (
  "id" TEXT PRIMARY KEY,
  "purposeId" TEXT NOT NULL,
  "periodStart" DATE NOT NULL,
  "metric" VARCHAR(80) NOT NULL,
  "broadCategory" VARCHAR(40),
  "ageBand" VARCHAR(20),
  "numerator" BIGINT NOT NULL,
  "denominator" BIGINT,
  "uniqueSubjects" INTEGER NOT NULL,
  "contributionCap" INTEGER NOT NULL,
  "processingVersion" INTEGER NOT NULL,
  "reviewStatus" VARCHAR(20) NOT NULL DEFAULT 'UNREVIEWED',
  "qualityStatus" VARCHAR(30) NOT NULL DEFAULT 'PROVISIONAL',
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MonthlyAggregate_purposeId_fkey" FOREIGN KEY ("purposeId") REFERENCES governance."ProcessingPurpose"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "MonthlyAggregate_reviewStatus_check" CHECK ("reviewStatus" IN ('UNREVIEWED', 'SUPPRESSED', 'APPROVED', 'REJECTED')),
  CONSTRAINT "MonthlyAggregate_counts_check" CHECK ("numerator" >= 0 AND COALESCE("denominator", 0) >= 0 AND "uniqueSubjects" >= 0 AND "contributionCap" > 0),
  UNIQUE NULLS NOT DISTINCT ("purposeId", "periodStart", "metric", "broadCategory", "ageBand", "processingVersion")
);

CREATE TABLE analytics_restricted."AggregateReview" (
  "id" TEXT PRIMARY KEY,
  "monthlyAggregateId" TEXT NOT NULL,
  "reviewerId" TEXT NOT NULL,
  "decision" VARCHAR(20) NOT NULL,
  "riskNotes" VARCHAR(1000) NOT NULL,
  "reviewedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AggregateReview_monthlyAggregateId_fkey" FOREIGN KEY ("monthlyAggregateId") REFERENCES analytics_restricted."MonthlyAggregate"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "AggregateReview_decision_check" CHECK ("decision" IN ('APPROVE', 'SUPPRESS', 'REJECT'))
);

CREATE TABLE analytics_release."DatasetRelease" (
  "id" TEXT PRIMARY KEY,
  "purposeId" TEXT NOT NULL,
  "version" VARCHAR(40) NOT NULL,
  "recipient" VARCHAR(200),
  "status" VARCHAR(20) NOT NULL DEFAULT 'DRAFT',
  "approvedBy" TEXT,
  "approvedAt" TIMESTAMP(3),
  "releasedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DatasetRelease_purposeId_fkey" FOREIGN KEY ("purposeId") REFERENCES governance."ProcessingPurpose"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "DatasetRelease_status_check" CHECK ("status" IN ('DRAFT', 'REVIEWING', 'APPROVED', 'RELEASED', 'REJECTED', 'REVOKED')),
  CONSTRAINT "DatasetRelease_approval_check" CHECK ("status" NOT IN ('APPROVED', 'RELEASED') OR ("approvedBy" IS NOT NULL AND "approvedAt" IS NOT NULL)),
  CONSTRAINT "DatasetRelease_release_check" CHECK (("status" = 'RELEASED') = ("releasedAt" IS NOT NULL)),
  UNIQUE ("purposeId", "version")
);

CREATE TABLE analytics_release."AggregateMetric" (
  "id" TEXT PRIMARY KEY,
  "datasetReleaseId" TEXT NOT NULL,
  "periodStart" DATE NOT NULL,
  "metric" VARCHAR(80) NOT NULL,
  "broadCategory" VARCHAR(40),
  "ageBand" VARCHAR(20),
  "numerator" BIGINT NOT NULL,
  "denominator" BIGINT,
  "processingVersion" INTEGER NOT NULL,
  CONSTRAINT "AggregateMetric_datasetReleaseId_fkey" FOREIGN KEY ("datasetReleaseId") REFERENCES analytics_release."DatasetRelease"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "AggregateMetric_counts_check" CHECK ("numerator" >= 0 AND COALESCE("denominator", 0) >= 0),
  UNIQUE NULLS NOT DISTINCT ("datasetReleaseId", "periodStart", "metric", "broadCategory", "ageBand", "processingVersion")
);

CREATE TABLE governance."ReleaseReview" (
  "id" TEXT PRIMARY KEY,
  "datasetReleaseId" TEXT NOT NULL,
  "reviewType" VARCHAR(40) NOT NULL,
  "reviewerId" TEXT NOT NULL,
  "decision" VARCHAR(20) NOT NULL,
  "notes" VARCHAR(1000) NOT NULL,
  "reviewedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ReleaseReview_datasetReleaseId_fkey" FOREIGN KEY ("datasetReleaseId") REFERENCES analytics_release."DatasetRelease"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ReleaseReview_decision_check" CHECK ("decision" IN ('APPROVE', 'REJECT'))
);

CREATE TABLE governance."ExportAudit" (
  "id" TEXT PRIMARY KEY,
  "datasetReleaseId" TEXT NOT NULL,
  "actorId" TEXT NOT NULL,
  "recipient" VARCHAR(200) NOT NULL,
  "purpose" VARCHAR(300) NOT NULL,
  "exportedAt" TIMESTAMP(3) NOT NULL,
  "rowCount" INTEGER NOT NULL,
  "checksum" VARCHAR(64) NOT NULL,
  CONSTRAINT "ExportAudit_datasetReleaseId_fkey" FOREIGN KEY ("datasetReleaseId") REFERENCES analytics_release."DatasetRelease"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ExportAudit_rowCount_check" CHECK ("rowCount" >= 0)
);

CREATE TABLE security_audit."SecurityAuditEvent" (
  "id" TEXT PRIMARY KEY,
  "actorId" TEXT,
  "action" VARCHAR(80) NOT NULL,
  "targetType" VARCHAR(60) NOT NULL,
  "targetId" TEXT,
  "reasonCode" VARCHAR(80),
  "requestId" VARCHAR(120),
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "SecurityAuditEvent_createdAt_idx" ON security_audit."SecurityAuditEvent"("createdAt");
CREATE INDEX "SecurityAuditEvent_actor_idx" ON security_audit."SecurityAuditEvent"("actorId", "createdAt");

-- Expand shadow copies. Existing public.User remains authoritative until a later,
-- separately approved cutover. No consent, purpose approval, or retention approval
-- is fabricated by this migration.
INSERT INTO identity."AccountIdentity"
  ("userId", "email", "passwordHash", "googleId", "birthDate", "emailVerifiedAt", "createdAt", "updatedAt")
SELECT "id", "email", "passwordHash", "googleId", "birthDate", "emailVerifiedAt", "createdAt", "updatedAt"
FROM public."User"
ON CONFLICT ("userId") DO NOTHING;

INSERT INTO service."ServiceProfile"
  ("userId", "nickname", "handle", "bio", "timezone", "createdAt", "updatedAt")
SELECT "id", "nickname", "handle", "bio", "timezone", "createdAt", "updatedAt"
FROM public."User"
ON CONFLICT ("userId") DO NOTHING;

CREATE OR REPLACE FUNCTION identity.sync_account_identity_shadow() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog AS $$
BEGIN
  INSERT INTO identity."AccountIdentity"
    ("userId", "email", "passwordHash", "googleId", "birthDate", "emailVerifiedAt", "createdAt", "updatedAt")
  VALUES (NEW."id", NEW."email", NEW."passwordHash", NEW."googleId", NEW."birthDate", NEW."emailVerifiedAt", NEW."createdAt", NEW."updatedAt")
  ON CONFLICT ("userId") DO UPDATE SET
    "email" = EXCLUDED."email", "passwordHash" = EXCLUDED."passwordHash", "googleId" = EXCLUDED."googleId",
    "birthDate" = EXCLUDED."birthDate", "emailVerifiedAt" = EXCLUDED."emailVerifiedAt", "updatedAt" = EXCLUDED."updatedAt";
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION service.sync_service_profile_shadow() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog AS $$
BEGIN
  INSERT INTO service."ServiceProfile"
    ("userId", "nickname", "handle", "bio", "timezone", "createdAt", "updatedAt")
  VALUES (NEW."id", NEW."nickname", NEW."handle", NEW."bio", NEW."timezone", NEW."createdAt", NEW."updatedAt")
  ON CONFLICT ("userId") DO UPDATE SET
    "nickname" = EXCLUDED."nickname", "handle" = EXCLUDED."handle", "bio" = EXCLUDED."bio",
    "timezone" = EXCLUDED."timezone", "updatedAt" = EXCLUDED."updatedAt";
  RETURN NEW;
END $$;

CREATE TRIGGER "User_identity_shadow_trigger"
AFTER INSERT OR UPDATE OF "email", "passwordHash", "googleId", "birthDate", "emailVerifiedAt", "updatedAt"
ON public."User" FOR EACH ROW EXECUTE FUNCTION identity.sync_account_identity_shadow();

CREATE TRIGGER "User_profile_shadow_trigger"
AFTER INSERT OR UPDATE OF "nickname", "handle", "bio", "timezone", "updatedAt"
ON public."User" FOR EACH ROW EXECUTE FUNCTION service.sync_service_profile_shadow();

REVOKE CREATE ON SCHEMA public FROM PUBLIC;
REVOKE ALL ON SCHEMA identity, service, governance, security_audit, analytics_restricted, analytics_release FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA identity, service, governance, security_audit, analytics_restricted, analytics_release FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA identity, service FROM PUBLIC;
