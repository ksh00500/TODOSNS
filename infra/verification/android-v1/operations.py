"""Exercise repository role SQL and backup/restore only in services.py's owned fixture.

Usage: python operations.py /workspace/path/to/services-work /workspace/path/to/results
No production configuration is read. Generated LOGIN passwords stay in private
files/stdin and are removed from the container even when a check fails.
"""
import json
import os
from pathlib import Path
import secrets
import subprocess
import sys
from urllib.parse import urlsplit, urlunsplit

ROOT = Path(__file__).resolve().parents[3]
SERVICE, WORK = [Path(x).resolve() for x in sys.argv[1:]]
for directory in (SERVICE, WORK):
    assert directory.is_relative_to(Path('/workspace')) or directory.is_relative_to(Path('/tmp'))
    assert not directory.is_relative_to(ROOT), 'Keep credentials/artifacts outside Git'
WORK.mkdir(parents=True, exist_ok=True)
state = json.loads((SERVICE / 'service-state.json').read_text())
config = json.loads((SERVICE / 'synthetic-runtime.json').read_text())
ENV = {k: v for k, v in os.environ.items() if k not in (
    'DOCKER_HOST', 'DOCKER_CONTEXT', 'DOCKER_TLS', 'DOCKER_TLS_VERIFY', 'DOCKER_CERT_PATH')}
DOCKER = ['docker', '--host=unix:///var/run/docker.sock']
container = state['containers'][0]
info = json.loads(subprocess.check_output(DOCKER + ['inspect', container], env=ENV))[0]
assert info['Id'] == container
assert info['Config']['Labels'].get('todosns.verification.run') == state['run']
assert info['Config']['Image'] == 'postgres:17-alpine'
DB, RESTORE = 'todosns_m12', 'todosns_m12_restore'
results = []


def run(label, args, data=None, env=None, binary=False):
    log = WORK / (label + ('.dump' if binary else '.log'))
    # subprocess output must never reach the terminal with credentials attached.
    with log.open('wb') as file:
        log.chmod(0o600)
        if binary:
            with (WORK / (label + '-stderr.log')).open('wb') as errors:
                (WORK / (label + '-stderr.log')).chmod(0o600)
                p = subprocess.run(args, cwd=ROOT, env=env or ENV, input=data,
                                   stdout=file, stderr=errors)
        else:
            p = subprocess.run(args, cwd=ROOT, env=env or ENV,
                               input=data.encode() if isinstance(data, str) else data,
                               stdout=file, stderr=subprocess.STDOUT)
    if p.returncode:
        raise RuntimeError(label + ' failed; inspect private local log')
    results.append(label)
    print(label + ' passed', flush=True)
    return log


def pg(label, sql, db=DB, user='postgres'):
    command = DOCKER + ['exec', '-i', '-e', 'PGPASSFILE=/tmp/todosns-m12.pgpass', container,
                        'psql', '-X', '-q', '-v', 'ON_ERROR_STOP=1', '-d', db, '-U', user]
    if user != 'postgres':
        command += ['-h', '127.0.0.1']  # actual authenticated TCP LOGIN, not local trust
    return run(label, command, sql)


passwords = {name: secrets.token_hex(32) for name in ('runtime', 'migrator', 'backup')}
try:
    # Refuse to reset an existing database, even inside our fixture.
    pg('create-isolated-databases', f'CREATE DATABASE {DB}; CREATE DATABASE {RESTORE};', db='postgres')
    source = urlsplit(config['DATABASE_URL'])
    admin_url = urlunsplit(source._replace(path='/' + DB))
    run('migrations', ['npm', 'run', 'prisma:deploy', '-w', '@mungsil/api'],
        env={**ENV, **config, 'DATABASE_URL': admin_url})
    credentials = ''.join(f'MUNGSIL_{role.upper()}_DB_PASSWORD={password}\n' for role, password in passwords.items())
    credentials += "PGPASSFILE=/tmp/todosns-m12.pgpass\n"
    run('private-bootstrap-environment', DOCKER + ['exec', '-i', container, 'sh', '-c',
        'umask 077; cat > /tmp/todosns-m12.env'], credentials)
    run('bootstrap-login-roles', DOCKER + ['exec', '-i', container, 'sh', '-c',
        f'set -a; . /tmp/todosns-m12.env; exec psql -X -q -v ON_ERROR_STOP=1 -U postgres -d {DB}'],
        (ROOT / 'infra/database/bootstrap-login-roles.sql').read_text())
    pg('capability-grants', (ROOT / 'infra/database/roles.sql').read_text())
    pg('runtime-grants', "\\set legacy_owner postgres\n" + (ROOT / 'infra/database/apply-runtime-grants.sql').read_text())
    pg('capability-boundaries', (ROOT / 'infra/database/verify-role-boundaries.sql').read_text())
    pg('role-inventory', (ROOT / 'infra/database/inspect-role-boundaries.sql').read_text())
    pgpass = ''.join(f'127.0.0.1:5432:*:mungsil_{role}:{password}\n' for role, password in passwords.items())
    run('private-pgpass', DOCKER + ['exec', '-i', container, 'sh', '-c',
        'umask 077; cat > /tmp/todosns-m12.pgpass'], pgpass)
    pg('runtime-login-boundaries', '''
SELECT session_user, current_user, count(*) FROM public."Todo" GROUP BY session_user, current_user;
BEGIN;
INSERT INTO public."User" ("id","email","handle","nickname","passwordHash","birthDate","updatedAt")
VALUES ('m12-restore-user','m12@example.test','m12.restore','합성 복구','synthetic-only','1995-01-01',now());
UPDATE public."User" SET "nickname"='합성 복구 확인' WHERE "id"='m12-restore-user';
COMMIT;
DO $$ BEGIN
  BEGIN CREATE TABLE public.m12_forbidden(id int); RAISE EXCEPTION 'runtime DDL allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN SET ROLE mungsil_owner; RAISE EXCEPTION 'runtime owner escalation allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM 1 FROM identity."PurposeSubjectMap"; RAISE EXCEPTION 'runtime mappings allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM 1 FROM public._prisma_migrations; RAISE EXCEPTION 'runtime migrations allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
''', user='mungsil_runtime')
    pg('backup-login-boundaries', '''
SELECT session_user, current_user, count(*) FROM public."User" GROUP BY session_user, current_user;
DO $$ BEGIN
  BEGIN UPDATE public."User" SET "nickname"='forbidden'; RAISE EXCEPTION 'backup write allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN SET ROLE mungsil_owner; RAISE EXCEPTION 'backup owner escalation allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
''', user='mungsil_backup')
    pg('migrator-login-boundaries', '''
SET ROLE mungsil_owner;
BEGIN;
CREATE TABLE public.m12_future_table(id int);
DO $$ BEGIN
 IF has_table_privilege('mungsil_runtime','public.m12_future_table','SELECT') THEN
 RAISE EXCEPTION 'future runtime grant unexpectedly open'; END IF;
 IF NOT has_table_privilege('mungsil_backup','public.m12_future_table','SELECT') THEN
 RAISE EXCEPTION 'future backup grant missing'; END IF;
END $$;
DROP TABLE public.m12_future_table;
COMMIT;
''', user='mungsil_migrator')
    # Exercise real HTTP + Prisma with the restricted application LOGIN.
    runtime_url = urlunsplit(source._replace(netloc=f'mungsil_runtime:{passwords["runtime"]}@{source.hostname}:{source.port}', path='/' + DB))
    run('runtime-api-cheer', ['node', '--test', '--test-concurrency=1', 'apps/api/tests/cheer-result.database.test.cjs'],
        env={**ENV, **config, 'DATABASE_URL': runtime_url})
    pg('prepare-restore-owner', f'ALTER DATABASE {RESTORE} OWNER TO mungsil_owner; GRANT CONNECT ON DATABASE {RESTORE} TO mungsil_migrator,mungsil_runtime,mungsil_backup;', db='postgres')
    dump = run('backup', DOCKER + ['exec', '-e', 'PGPASSFILE=/tmp/todosns-m12.pgpass', container,
        'pg_dump', '-h', '127.0.0.1', '-U', 'mungsil_backup', '-d', DB, '-Fc'], binary=True)
    run('restore', DOCKER + ['exec', '-i', '-e', 'PGPASSFILE=/tmp/todosns-m12.pgpass', container,
        'pg_restore', '-h', '127.0.0.1', '-U', 'mungsil_migrator', '--role=mungsil_owner',
        '--exit-on-error', '-d', RESTORE], dump.read_bytes())
    invariant = '''
DO $$ BEGIN
 IF (SELECT count(*) FROM public._prisma_migrations WHERE finished_at IS NOT NULL) <> 15 THEN RAISE EXCEPTION 'migration inventory mismatch'; END IF;
 IF (SELECT count(*) FROM public."User" WHERE "id"='m12-restore-user' AND "nickname"='합성 복구 확인') <> 1 THEN RAISE EXCEPTION 'sample row mismatch'; END IF;
 IF (SELECT count(*) FROM identity."AccountIdentity" WHERE "userId"='m12-restore-user') <> 1 THEN RAISE EXCEPTION 'identity shadow mismatch'; END IF;
 IF (SELECT count(*) FROM service."ServiceProfile" WHERE "userId"='m12-restore-user') <> 1 THEN RAISE EXCEPTION 'service shadow mismatch'; END IF;
 IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname IN ('public','identity','service','governance','security_audit','analytics_restricted','analytics_release')
 AND c.relkind IN ('r','p','S') AND pg_get_userbyid(c.relowner) <> 'mungsil_owner') THEN RAISE EXCEPTION 'restored object ownership mismatch'; END IF;
END $$;
'''
    pg('source-invariants', invariant)
    pg('restored-invariants', invariant, db=RESTORE)
    pg('restored-capability-boundaries', (ROOT / 'infra/database/verify-role-boundaries.sql').read_text(), db=RESTORE)
    pg('restored-runtime-login', 'SELECT count(*) FROM public."User";', db=RESTORE, user='mungsil_runtime')
    (WORK / 'result.json').write_text(json.dumps({'status':'passed','checks':results,'production':False}, indent=2) + '\n')
finally:
    subprocess.run(DOCKER + ['exec', container, 'rm', '-f', '/tmp/todosns-m12.env', '/tmp/todosns-m12.pgpass'], env=ENV, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
