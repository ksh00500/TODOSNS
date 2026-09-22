\set ON_ERROR_STOP on

-- Run through the separately approved bootstrap administrator connection.
-- Passwords are read from the psql process environment and are never accepted
-- as command-line arguments or stored in this file.
\getenv runtime_password MUNGSIL_RUNTIME_DB_PASSWORD
\getenv migrator_password MUNGSIL_MIGRATOR_DB_PASSWORD
\getenv backup_password MUNGSIL_BACKUP_DB_PASSWORD

SELECT length(:'runtime_password') >= 32 AS runtime_password_valid,
       length(:'migrator_password') >= 32 AS migrator_password_valid,
       length(:'backup_password') >= 32 AS backup_password_valid
\gset

\if :runtime_password_valid
\else
  \echo 'runtime database password must contain at least 32 characters'
  \quit 2
\endif
\if :migrator_password_valid
\else
  \echo 'migrator database password must contain at least 32 characters'
  \quit 2
\endif
\if :backup_password_valid
\else
  \echo 'backup database password must contain at least 32 characters'
  \quit 2
\endif

SELECT 'CREATE ROLE mungsil_owner NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS'
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mungsil_owner')
\gexec
SELECT 'CREATE ROLE mungsil_migrator LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS'
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mungsil_migrator')
\gexec
SELECT 'CREATE ROLE mungsil_runtime LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS'
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mungsil_runtime')
\gexec
SELECT 'CREATE ROLE mungsil_backup LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS'
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mungsil_backup')
\gexec

ALTER ROLE mungsil_owner NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
ALTER ROLE mungsil_migrator LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS PASSWORD :'migrator_password';
ALTER ROLE mungsil_runtime LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS PASSWORD :'runtime_password';
ALTER ROLE mungsil_backup LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS PASSWORD :'backup_password';

SELECT format('REVOKE %I FROM %I', granted.rolname, member.rolname)
FROM pg_auth_members membership
JOIN pg_roles granted ON granted.oid = membership.roleid
JOIN pg_roles member ON member.oid = membership.member
WHERE member.rolname IN ('mungsil_owner', 'mungsil_migrator', 'mungsil_runtime', 'mungsil_backup')
\gexec
GRANT mungsil_owner TO mungsil_migrator;
REVOKE ADMIN OPTION FOR mungsil_owner FROM mungsil_migrator;

COMMENT ON ROLE mungsil_owner IS 'NOLOGIN owner for Mungsil database objects';
COMMENT ON ROLE mungsil_migrator IS 'Deployment-only LOGIN; migration URL must SET ROLE mungsil_owner';
COMMENT ON ROLE mungsil_runtime IS 'Always-on API LOGIN with explicit DML allowlist and no DDL';
COMMENT ON ROLE mungsil_backup IS 'Backup-only LOGIN with read access and no application writes';
