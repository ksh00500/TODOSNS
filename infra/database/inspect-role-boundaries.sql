\set ON_ERROR_STOP on

-- Read-only inventory. PostgreSQL password verifiers and connection strings are
-- intentionally excluded.
SELECT rolname, rolcanlogin, rolsuper, rolcreatedb, rolcreaterole, rolinherit, rolbypassrls
FROM pg_roles
WHERE rolname IN ('mungsil_owner', 'mungsil_migrator', 'mungsil_runtime', 'mungsil_backup')
ORDER BY rolname;

SELECT granted.rolname AS granted_role,
       member.rolname AS member_role,
       membership.admin_option,
       membership.inherit_option,
       membership.set_option
FROM pg_auth_members membership
JOIN pg_roles granted ON granted.oid = membership.roleid
JOIN pg_roles member ON member.oid = membership.member
WHERE granted.rolname LIKE 'mungsil_%' OR member.rolname LIKE 'mungsil_%'
ORDER BY granted_role, member_role;

WITH RECURSIVE role_paths AS (
  SELECT membership.member AS member_oid,
         membership.roleid AS granted_oid,
         ARRAY[membership.member, membership.roleid] AS path
  FROM pg_auth_members membership
  UNION ALL
  SELECT role_paths.member_oid,
         membership.roleid,
         role_paths.path || membership.roleid
  FROM role_paths
  JOIN pg_auth_members membership ON membership.member = role_paths.granted_oid
  WHERE NOT membership.roleid = ANY(role_paths.path)
)
SELECT member.rolname AS member_role,
       granted.rolname AS directly_or_indirectly_reachable_role
FROM role_paths
JOIN pg_roles member ON member.oid = role_paths.member_oid
JOIN pg_roles granted ON granted.oid = role_paths.granted_oid
WHERE member.rolname IN ('mungsil_migrator', 'mungsil_runtime', 'mungsil_backup')
ORDER BY member_role, directly_or_indirectly_reachable_role;

SELECT datname, pg_get_userbyid(datdba) AS owner,
       has_database_privilege('mungsil_runtime', datname, 'CONNECT') AS runtime_connect,
       has_database_privilege('mungsil_runtime', datname, 'TEMP') AS runtime_temp
FROM pg_database
WHERE datname = current_database();

SELECT n.nspname AS schema_name,
       c.relkind,
       c.relname AS object_name,
       pg_get_userbyid(c.relowner) AS owner
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname IN ('public', 'identity', 'service', 'governance', 'security_audit', 'analytics_restricted', 'analytics_release')
  AND c.relkind IN ('r', 'p', 'S', 'v', 'm')
ORDER BY schema_name, relkind, object_name;

SELECT routine_schema, routine_name, routine_type, external_language, security_type
FROM information_schema.routines
WHERE routine_schema IN ('public', 'identity', 'service', 'governance', 'security_audit', 'analytics_restricted', 'analytics_release')
ORDER BY routine_schema, routine_name;

SELECT n.nspname AS schema_name,
       p.proname AS function_name,
       pg_get_userbyid(p.proowner) AS owner,
       p.prosecdef AS security_definer,
       p.proacl
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname IN ('public', 'identity', 'service', 'governance', 'security_audit', 'analytics_restricted', 'analytics_release')
ORDER BY schema_name, function_name;

SELECT grantee, table_schema, table_name, privilege_type
FROM information_schema.role_table_grants
WHERE grantee IN ('PUBLIC', 'mungsil_runtime', 'mungsil_backup')
  AND table_schema IN ('public', 'identity', 'service', 'governance', 'security_audit', 'analytics_restricted', 'analytics_release')
ORDER BY grantee, table_schema, table_name, privilege_type;

SELECT defaclrole::regrole AS object_creator,
       COALESCE(n.nspname, '*') AS schema_name,
       defaclobjtype AS object_type,
       defaclacl
FROM pg_default_acl acl
LEFT JOIN pg_namespace n ON n.oid = acl.defaclnamespace
WHERE defaclrole IN (SELECT oid FROM pg_roles WHERE rolname = 'mungsil_owner')
ORDER BY schema_name, object_type;

SELECT current_setting('server_version') AS server_version,
       session_user::text AS session_role,
       current_user::text AS current_role;
