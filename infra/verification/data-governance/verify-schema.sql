\set ON_ERROR_STOP on

DO $$
DECLARE
  required_schema TEXT;
BEGIN
  FOREACH required_schema IN ARRAY ARRAY[
    'identity', 'service', 'governance', 'security_audit', 'analytics_restricted', 'analytics_release'
  ] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = required_schema) THEN
      RAISE EXCEPTION 'required schema missing: %', required_schema;
    END IF;
  END LOOP;
  IF (
    SELECT COUNT(*) FROM pg_trigger
     WHERE tgname IN ('User_identity_shadow_trigger', 'User_profile_shadow_trigger', 'Todo_post_snapshot_policy', 'TodoList_post_snapshot_policy')
  ) <> 4 THEN
    RAISE EXCEPTION 'required trigger inventory mismatch';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_roles
     WHERE rolname LIKE 'mungsil_%' AND (rolsuper OR rolcreaterole OR rolcreatedb OR rolbypassrls)
  ) THEN
    RAISE EXCEPTION 'capability role has elevated attributes';
  END IF;
END $$;
