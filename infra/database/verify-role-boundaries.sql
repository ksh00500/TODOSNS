\set ON_ERROR_STOP on

-- Run against an isolated synthetic database after migrations and roles.sql.
-- Each block performs an allowed query and proves representative forbidden
-- queries fail with insufficient_privilege.

SET ROLE mungsil_auth;
SELECT COUNT(*) FROM identity."AccountIdentity";
DO $$ BEGIN
  BEGIN
    PERFORM 1 FROM analytics_restricted."AnalyticsEvent" LIMIT 1;
    RAISE EXCEPTION 'mungsil_auth unexpectedly read analytics events';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
RESET ROLE;

SET ROLE mungsil_service;
SELECT COUNT(*) FROM service."ServiceProfile";
DO $$ BEGIN
  BEGIN
    PERFORM 1 FROM identity."AccountIdentity" LIMIT 1;
    RAISE EXCEPTION 'mungsil_service unexpectedly read account identities';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
RESET ROLE;

SET ROLE mungsil_analytics_reader;
SELECT COUNT(*) FROM analytics_restricted."MonthlyAggregate";
DO $$ BEGIN
  BEGIN
    PERFORM 1 FROM identity."PurposeSubjectMap" LIMIT 1;
    RAISE EXCEPTION 'analytics reader unexpectedly read subject mappings';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM 1 FROM analytics_restricted."AnalyticsEvent" LIMIT 1;
    RAISE EXCEPTION 'analytics reader unexpectedly read row-level events';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
RESET ROLE;

SET ROLE mungsil_release_reader;
SELECT COUNT(*) FROM analytics_release."AggregateMetric";
DO $$ BEGIN
  BEGIN
    PERFORM 1 FROM public."User" LIMIT 1;
    RAISE EXCEPTION 'release reader unexpectedly read users';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM 1 FROM analytics_restricted."MonthlyAggregate" LIMIT 1;
    RAISE EXCEPTION 'release reader unexpectedly read restricted aggregates';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
RESET ROLE;

BEGIN;
SET LOCAL ROLE mungsil_audit_writer;
INSERT INTO security_audit."SecurityAuditEvent"
  ("id", "action", "targetType", "reasonCode")
VALUES ('synthetic-role-check', 'ROLE_CHECK', 'SYNTHETIC', 'TEST_ONLY');
DO $$ BEGIN
  BEGIN
    PERFORM 1 FROM security_audit."SecurityAuditEvent" LIMIT 1;
    RAISE EXCEPTION 'audit writer unexpectedly read audit events';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
ROLLBACK;

DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_roles
    WHERE rolname LIKE 'mungsil_%'
      AND (rolsuper OR rolcreaterole OR rolcreatedb OR rolbypassrls)
  ) THEN
    RAISE EXCEPTION 'a runtime capability role has elevated attributes';
  END IF;
END $$;
