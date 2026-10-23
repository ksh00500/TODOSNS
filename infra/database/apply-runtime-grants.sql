\set ON_ERROR_STOP on

\if :{?database_name}
\else
  SELECT current_database() AS database_name \gset
\endif
\if :{?legacy_owner}
\else
  \set legacy_owner mungsil
\endif

-- Preserve the legacy administrator as a recovery path. The bootstrap LOGIN
-- can also be PostgreSQL's initial superuser, so REASSIGN OWNED would include
-- cluster/system objects that PostgreSQL refuses to transfer. Restrict the
-- handoff to objects created for this application in its managed schemas.
SELECT format(
  'ALTER %s %I.%I OWNER TO mungsil_owner',
  CASE class.relkind
    WHEN 'r' THEN 'TABLE'
    WHEN 'p' THEN 'TABLE'
    WHEN 'S' THEN 'SEQUENCE'
    WHEN 'v' THEN 'VIEW'
    WHEN 'm' THEN 'MATERIALIZED VIEW'
    WHEN 'f' THEN 'FOREIGN TABLE'
  END,
  namespace.nspname,
  class.relname
)
FROM pg_class class
JOIN pg_namespace namespace ON namespace.oid = class.relnamespace
WHERE namespace.nspname IN ('public', 'identity', 'service', 'governance', 'security_audit', 'analytics_restricted', 'analytics_release')
  AND class.relkind IN ('r', 'p', 'S', 'v', 'm', 'f')
  AND pg_get_userbyid(class.relowner) = :'legacy_owner'
ORDER BY namespace.nspname, class.relkind, class.relname
\gexec

SELECT format(
  'ALTER %s %I.%I(%s) OWNER TO mungsil_owner',
  CASE routine.prokind WHEN 'p' THEN 'PROCEDURE' ELSE 'FUNCTION' END,
  namespace.nspname,
  routine.proname,
  pg_get_function_identity_arguments(routine.oid)
)
FROM pg_proc routine
JOIN pg_namespace namespace ON namespace.oid = routine.pronamespace
WHERE namespace.nspname IN ('public', 'identity', 'service', 'governance', 'security_audit', 'analytics_restricted', 'analytics_release')
  AND pg_get_userbyid(routine.proowner) = :'legacy_owner'
ORDER BY namespace.nspname, routine.proname, pg_get_function_identity_arguments(routine.oid)
\gexec

SELECT format('ALTER TYPE %I.%I OWNER TO mungsil_owner', namespace.nspname, type.typname)
FROM pg_type type
JOIN pg_namespace namespace ON namespace.oid = type.typnamespace
WHERE namespace.nspname IN ('public', 'identity', 'service', 'governance', 'security_audit', 'analytics_restricted', 'analytics_release')
  AND type.typtype IN ('d', 'e', 'r')
  AND type.typrelid = 0
  AND pg_get_userbyid(type.typowner) = :'legacy_owner'
ORDER BY namespace.nspname, type.typname
\gexec

SELECT format('ALTER DATABASE %I OWNER TO mungsil_owner', :'database_name') \gexec
ALTER SCHEMA public OWNER TO mungsil_owner;
ALTER SCHEMA identity OWNER TO mungsil_owner;
ALTER SCHEMA service OWNER TO mungsil_owner;
ALTER SCHEMA governance OWNER TO mungsil_owner;
ALTER SCHEMA security_audit OWNER TO mungsil_owner;
ALTER SCHEMA analytics_restricted OWNER TO mungsil_owner;
ALTER SCHEMA analytics_release OWNER TO mungsil_owner;

SELECT format('REVOKE ALL ON DATABASE %I FROM PUBLIC', :'database_name') \gexec
SELECT format('REVOKE ALL ON DATABASE %I FROM mungsil_migrator, mungsil_runtime, mungsil_backup', :'database_name') \gexec
SELECT format('GRANT CONNECT ON DATABASE %I TO mungsil_migrator, mungsil_runtime, mungsil_backup', :'database_name') \gexec
SELECT format('GRANT CONNECT ON DATABASE %I TO %I', :'database_name', :'legacy_owner')
WHERE EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'legacy_owner')
\gexec

REVOKE ALL ON SCHEMA public FROM PUBLIC;
REVOKE ALL ON SCHEMA identity, service, governance, security_audit, analytics_restricted, analytics_release FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA public, identity, service, governance, security_audit, analytics_restricted, analytics_release FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public, identity, service, governance, security_audit, analytics_restricted, analytics_release FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public, identity, service, governance, security_audit, analytics_restricted, analytics_release FROM PUBLIC;

REVOKE ALL ON SCHEMA public, identity, service, governance, security_audit, analytics_restricted, analytics_release FROM mungsil_runtime;
REVOKE ALL ON ALL TABLES IN SCHEMA public, identity, service, governance, security_audit, analytics_restricted, analytics_release FROM mungsil_runtime;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public, identity, service, governance, security_audit, analytics_restricted, analytics_release FROM mungsil_runtime;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public, identity, service, governance, security_audit, analytics_restricted, analytics_release FROM mungsil_runtime;

GRANT USAGE ON SCHEMA public, identity, service, governance TO mungsil_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  public."User",
  public."Session",
  public."VerificationToken",
  public."InviteCode",
  public."AdminAuditLog",
  public."IdempotencyKey",
  public."Todo",
  public."TodoSeries",
  public."TodoCategory",
  public."TodoList",
  public."TodoListItem",
  public."Post",
  public."Tag",
  public."PostTag",
  public."PostTodo",
  public."Cheer",
  public."Comment",
  public."Follow",
  public."Block",
  public."MessageRequest",
  public."Conversation",
  public."ConversationMember",
  public."Message",
  public."MessageRevision",
  public."MessageReaction",
  public."ConversationMute",
  public."ChatModerationAction",
  public."Challenge",
  public."ChallengeParticipant",
  public."ChallengeCheckIn",
  public."ChallengeVerificationVote",
  public."PointLedger",
  public."Report",
  public."Notification",
  public."Media"
TO mungsil_runtime;
-- Keep role setup usable both before and after the push migration.
DO $$
BEGIN
  IF to_regclass('public."PushDevice"') IS NOT NULL THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public."PushDevice" TO mungsil_runtime;
  END IF;
END $$;
GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO mungsil_runtime;
REVOKE USAGE ON TYPE
  public."Role",
  public."Visibility",
  public."TodoKind",
  public."ChallengeKind",
  public."VerificationMode",
  public."VerificationVoteVerdict",
  public."CheckInStatus",
  public."RequestStatus",
  public."ConversationKind",
  public."ChatNotificationLevel",
  public."MessageKind",
  public."ChatReactionType",
  public."ChatModerationActionType",
  public."ReportTarget",
  public."ReportStatus",
  public."NotificationType",
  public."RewardStatus",
  public."VerificationTokenType",
  public."MediaStatus"
FROM PUBLIC;
GRANT USAGE ON TYPE
  public."Role",
  public."Visibility",
  public."TodoKind",
  public."ChallengeKind",
  public."VerificationMode",
  public."VerificationVoteVerdict",
  public."CheckInStatus",
  public."RequestStatus",
  public."ConversationKind",
  public."ChatNotificationLevel",
  public."MessageKind",
  public."ChatReactionType",
  public."ChatModerationActionType",
  public."ReportTarget",
  public."ReportStatus",
  public."NotificationType",
  public."RewardStatus",
  public."VerificationTokenType",
  public."MediaStatus"
TO mungsil_runtime, mungsil_backup;

-- SECURITY INVOKER shadow functions need only these explicit shadow writes.
GRANT SELECT, INSERT, UPDATE ON identity."AccountIdentity", service."ServiceProfile" TO mungsil_runtime;
GRANT SELECT, INSERT, UPDATE ON governance."ErasureRequest", governance."ErasureTask", governance."ObjectDeletionTask" TO mungsil_runtime;
GRANT EXECUTE ON FUNCTION identity.sync_account_identity_shadow() TO mungsil_runtime;
GRANT EXECUTE ON FUNCTION service.sync_service_profile_shadow() TO mungsil_runtime;
GRANT EXECUTE ON FUNCTION governance.revoke_todo_post_snapshots() TO mungsil_runtime;
GRANT EXECUTE ON FUNCTION governance.revoke_todo_list_post_snapshots() TO mungsil_runtime;

REVOKE ALL ON SCHEMA public, identity, service, governance, security_audit, analytics_restricted, analytics_release FROM mungsil_backup;
REVOKE ALL ON ALL TABLES IN SCHEMA public, identity, service, governance, security_audit, analytics_restricted, analytics_release FROM mungsil_backup;
GRANT USAGE ON SCHEMA public, identity, service, governance, security_audit, analytics_restricted, analytics_release TO mungsil_backup;
GRANT SELECT ON ALL TABLES IN SCHEMA public, identity, service, governance, security_audit, analytics_restricted, analytics_release TO mungsil_backup;
GRANT SELECT ON ALL SEQUENCES IN SCHEMA public, identity, service, governance, security_audit, analytics_restricted, analytics_release TO mungsil_backup;

-- Future objects are owned by mungsil_owner because the migrator connection
-- starts with options=-c role=mungsil_owner. Runtime access is deny-by-default:
-- every new application table/sequence/type must be added to the reviewed
-- explicit grants above (or to its migration) before the API can use it.
ALTER DEFAULT PRIVILEGES FOR ROLE mungsil_owner IN SCHEMA public REVOKE ALL ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE mungsil_owner IN SCHEMA public GRANT SELECT ON TABLES TO mungsil_backup;
ALTER DEFAULT PRIVILEGES FOR ROLE mungsil_owner IN SCHEMA public REVOKE ALL ON SEQUENCES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE mungsil_owner IN SCHEMA public GRANT SELECT ON SEQUENCES TO mungsil_backup;
ALTER DEFAULT PRIVILEGES FOR ROLE mungsil_owner IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE mungsil_owner IN SCHEMA public REVOKE USAGE ON TYPES FROM PUBLIC;

ALTER DEFAULT PRIVILEGES FOR ROLE mungsil_owner IN SCHEMA identity REVOKE ALL ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE mungsil_owner IN SCHEMA service REVOKE ALL ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE mungsil_owner IN SCHEMA governance REVOKE ALL ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE mungsil_owner IN SCHEMA security_audit REVOKE ALL ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE mungsil_owner IN SCHEMA analytics_restricted REVOKE ALL ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE mungsil_owner IN SCHEMA analytics_release REVOKE ALL ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE mungsil_owner IN SCHEMA identity GRANT SELECT ON TABLES TO mungsil_backup;
ALTER DEFAULT PRIVILEGES FOR ROLE mungsil_owner IN SCHEMA service GRANT SELECT ON TABLES TO mungsil_backup;
ALTER DEFAULT PRIVILEGES FOR ROLE mungsil_owner IN SCHEMA governance GRANT SELECT ON TABLES TO mungsil_backup;
ALTER DEFAULT PRIVILEGES FOR ROLE mungsil_owner IN SCHEMA security_audit GRANT SELECT ON TABLES TO mungsil_backup;
ALTER DEFAULT PRIVILEGES FOR ROLE mungsil_owner IN SCHEMA analytics_restricted GRANT SELECT ON TABLES TO mungsil_backup;
ALTER DEFAULT PRIVILEGES FOR ROLE mungsil_owner IN SCHEMA analytics_release GRANT SELECT ON TABLES TO mungsil_backup;
ALTER DEFAULT PRIVILEGES FOR ROLE mungsil_owner IN SCHEMA identity GRANT SELECT ON SEQUENCES TO mungsil_backup;
ALTER DEFAULT PRIVILEGES FOR ROLE mungsil_owner IN SCHEMA service GRANT SELECT ON SEQUENCES TO mungsil_backup;
ALTER DEFAULT PRIVILEGES FOR ROLE mungsil_owner IN SCHEMA governance GRANT SELECT ON SEQUENCES TO mungsil_backup;
ALTER DEFAULT PRIVILEGES FOR ROLE mungsil_owner IN SCHEMA security_audit GRANT SELECT ON SEQUENCES TO mungsil_backup;
ALTER DEFAULT PRIVILEGES FOR ROLE mungsil_owner IN SCHEMA analytics_restricted GRANT SELECT ON SEQUENCES TO mungsil_backup;
ALTER DEFAULT PRIVILEGES FOR ROLE mungsil_owner IN SCHEMA analytics_release GRANT SELECT ON SEQUENCES TO mungsil_backup;
ALTER DEFAULT PRIVILEGES FOR ROLE mungsil_owner IN SCHEMA identity REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE mungsil_owner IN SCHEMA service REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE mungsil_owner IN SCHEMA governance REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE mungsil_owner IN SCHEMA security_audit REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE mungsil_owner IN SCHEMA analytics_restricted REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE mungsil_owner IN SCHEMA analytics_release REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

REVOKE ALL ON TABLE public._prisma_migrations FROM mungsil_runtime;
