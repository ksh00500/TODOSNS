-- Run only as the dedicated database owner during an approved deployment.
-- These are NOLOGIN capability roles. Create LOGIN roles and grant only the
-- required capability role in the secret-management/deployment system.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mungsil_auth') THEN CREATE ROLE mungsil_auth NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mungsil_service') THEN CREATE ROLE mungsil_service NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mungsil_erasure') THEN CREATE ROLE mungsil_erasure NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mungsil_analytics_ingest') THEN CREATE ROLE mungsil_analytics_ingest NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mungsil_analytics_reader') THEN CREATE ROLE mungsil_analytics_reader NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mungsil_release_reader') THEN CREATE ROLE mungsil_release_reader NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mungsil_audit_writer') THEN CREATE ROLE mungsil_audit_writer NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS; END IF;
END $$;

REVOKE CREATE ON SCHEMA public FROM PUBLIC;
REVOKE ALL ON SCHEMA identity, service, governance, security_audit, analytics_restricted, analytics_release FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA identity, service, governance, security_audit, analytics_restricted, analytics_release FROM PUBLIC;

GRANT USAGE ON SCHEMA identity TO mungsil_auth;
GRANT SELECT, INSERT, UPDATE ON identity."AccountIdentity" TO mungsil_auth;

GRANT USAGE ON SCHEMA service TO mungsil_service;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA service TO mungsil_service;

GRANT USAGE ON SCHEMA governance, identity, analytics_restricted TO mungsil_erasure;
GRANT SELECT, INSERT, UPDATE ON governance."ErasureRequest", governance."ErasureTask", governance."ObjectDeletionTask" TO mungsil_erasure;
GRANT SELECT, DELETE ON identity."PurposeSubjectMap", analytics_restricted."AnalyticsEvent" TO mungsil_erasure;

GRANT USAGE ON SCHEMA governance, identity, analytics_restricted TO mungsil_analytics_ingest;
GRANT SELECT ON governance."ProcessingPurpose", governance."ConsentRecord", governance."RetentionPolicy" TO mungsil_analytics_ingest;
GRANT SELECT, INSERT, UPDATE, DELETE ON identity."PurposeSubjectMap", analytics_restricted."AnalyticsEvent", analytics_restricted."AggregationJob", analytics_restricted."MonthlyAggregate" TO mungsil_analytics_ingest;

GRANT USAGE ON SCHEMA analytics_restricted TO mungsil_analytics_reader;
GRANT SELECT ON analytics_restricted."MonthlyAggregate", analytics_restricted."AggregateReview" TO mungsil_analytics_reader;

GRANT USAGE ON SCHEMA analytics_release TO mungsil_release_reader;
GRANT SELECT ON analytics_release."DatasetRelease", analytics_release."AggregateMetric" TO mungsil_release_reader;

GRANT USAGE ON SCHEMA security_audit TO mungsil_audit_writer;
GRANT INSERT ON security_audit."SecurityAuditEvent" TO mungsil_audit_writer;

ALTER DEFAULT PRIVILEGES IN SCHEMA identity REVOKE ALL ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA service REVOKE ALL ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA governance REVOKE ALL ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA security_audit REVOKE ALL ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA analytics_restricted REVOKE ALL ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA analytics_release REVOKE ALL ON TABLES FROM PUBLIC;
