"""Temporary M-06 services. No production .env, existing volumes or containers are changed."""
import json
import os
from pathlib import Path
import secrets
import subprocess
import sys
import time
import urllib.request

ROOT = Path(__file__).resolve().parents[3]
ACTION, WORK_ARG = sys.argv[1:]
WORK = Path(WORK_ARG).resolve()
assert WORK.is_relative_to(Path('/workspace')) or WORK.is_relative_to(Path('/tmp'))
assert not WORK.is_relative_to(ROOT), 'Keep credentials and logs outside the checkout'
WORK.mkdir(parents=True, exist_ok=True)
STATE = WORK / 'service-state.json'
CONFIG = WORK / 'synthetic-runtime.json'
DOCKER_ENV = {k: v for k, v in os.environ.items() if k not in (
    'DOCKER_HOST', 'DOCKER_CONTEXT', 'DOCKER_TLS', 'DOCKER_TLS_VERIFY', 'DOCKER_CERT_PATH')}
DOCKER_ENV['BUILDX_CONFIG'] = str(WORK / 'buildx')
state = json.loads(STATE.read_text()) if STATE.exists() else None


def save(file, data):
    file.write_text(json.dumps(data), encoding='utf-8')
    file.chmod(0o600)


def docker(*args):
    result = subprocess.run(['docker', '--host=unix:///var/run/docker.sock', *args],
                            env=DOCKER_ENV, text=True, capture_output=True)
    if result.returncode:
        raise RuntimeError('Docker ' + args[0] + ' failed; inspect the named verification resource')
    return result.stdout.strip()


def owned_containers(ignore_missing=False):
    assert state and state['run']
    found = []
    for container in state['containers']:
        try:
            data = json.loads(docker('inspect', container))[0]
        except RuntimeError:
            # A failed inspect can also mean a lost daemon; verify actual absence.
            if ignore_missing and container not in docker('ps', '-aq', '--no-trunc').splitlines():
                continue
            raise
        assert data['Id'] == container
        assert data['Config']['Labels'].get('todosns.verification.run') == state['run']
        found.append(container)
    return found


def stop():
    if not state:
        return
    for container in owned_containers(ignore_missing=True):
        docker('stop', '--time', '10', container)
    CONFIG.unlink(missing_ok=True)
    STATE.unlink(missing_ok=True)
    print('Stopped only owned temporary containers; tmpfs data and credential config removed')


def start():
    global state
    if state:
        owned_containers()
        assert state.get('ready') and CONFIG.exists(), 'Incomplete startup: run stop, then start'
        print('Reusing owned M-06 services and existing synthetic configuration')
        return
    assert not CONFIG.exists(), 'An existing config without ownership state must be preserved'
    docker('info', '--format', '{{.ServerVersion}}')
    run = secrets.token_hex(5)
    state = {'run': run, 'containers': [], 'ready': False}
    save(STATE, state)

    def launch(kind, options, image, command=()):
        container = docker('run', '--rm', '--name', f'todosns-m06-{run}-{kind}',
                           '--label', 'todosns.verification.run=' + run, '-d', *options, image, *command)
        state['containers'].append(container)
        save(STATE, state)
        return container

    image = 'todosns-m06-minio:2025-09-07'
    existing = subprocess.run(['docker', '--host=unix:///var/run/docker.sock', 'image', 'inspect', image],
                              env=DOCKER_ENV, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    if existing.returncode:
        ca = os.environ.get('CODEX_PROXY_CERT', '/etc/ssl/certs/ca-certificates.crt')
        with (WORK / 'minio-build.log').open('w') as log:
            subprocess.run(['docker', '--host=unix:///var/run/docker.sock', 'build',
                            '--secret', 'id=proxy_ca,src=' + ca, '-t', image,
                            '-f', str(Path(__file__).with_name('Dockerfile.minio')), str(Path(__file__).parent)],
                           env=DOCKER_ENV, stdout=log, stderr=subprocess.STDOUT, check=True)
    password = secrets.token_hex(24)
    access, secret = 'm06-' + secrets.token_hex(8), secrets.token_hex(32)
    pg = launch('pg', ['--memory=768m', '--cpus=1', '--tmpfs', '/var/lib/postgresql/data:rw',
                       '-e', 'POSTGRES_PASSWORD=' + password, '-e', 'POSTGRES_DB=todosns_m06',
                       '-p', '127.0.0.1::5432'], 'postgres:17-alpine')
    redis = launch('redis', ['--memory=128m', '--cpus=0.5', '-p', '127.0.0.1::6379'],
                   'redis:7-alpine', ['redis-server', '--save', '', '--appendonly', 'no'])
    storage = launch('minio', ['--memory=512m', '--cpus=1', '--tmpfs', '/data:rw',
                              '-e', 'MINIO_ROOT_USER=' + access, '-e', 'MINIO_ROOT_PASSWORD=' + secret,
                              '-p', '127.0.0.1::9000'], image, ['server', '/data'])

    def port(container, number):
        return docker('port', container, str(number)).split(':')[-1]

    pgport = port(pg, 5432)
    endpoint = 'http://127.0.0.1:' + port(storage, 9000)
    for _ in range(60):
        ready = subprocess.run(['docker', '--host=unix:///var/run/docker.sock', 'exec', pg,
                                'pg_isready', '-U', 'postgres'], env=DOCKER_ENV, capture_output=True).returncode == 0
        try:
            with urllib.request.urlopen(endpoint + '/minio/health/live', timeout=2) as r:
                ready = ready and r.status == 200
        except OSError:
            ready = False
        if ready:
            break
        time.sleep(1)
    else:
        raise RuntimeError('Temporary services did not become ready')
    assert docker('exec', redis, 'redis-cli', 'ping') == 'PONG'
    docker('exec', pg, 'createdb', '-U', 'postgres', 'todosns_m04')
    env = {
        'NODE_ENV': 'test', 'DATABASE_URL': f'postgresql://postgres:{password}@127.0.0.1:{pgport}/todosns_m06',
        'TODO_HISTORY_TEST_DATABASE_URL': f'postgresql://postgres:{password}@127.0.0.1:{pgport}/todosns_m04',
        'REDIS_URL': 'redis://127.0.0.1:' + port(redis, 6379),
        'JWT_ACCESS_SECRET': secrets.token_hex(32), 'JWT_REFRESH_SECRET': secrets.token_hex(32),
        'RUN_DATABASE_E2E': '1', 'RUN_OBJECT_STORAGE_E2E': '1', 'OBJECT_STORAGE_CREATE_BUCKET': '0',
        'OBJECT_STORAGE_VERSIONED': '1', 'SMTP_HOST': '', 'SMTP_USER': '', 'SMTP_PASSWORD': '',
        'PUSH_ENABLED': 'false', 'GOOGLE_AUTH_ENABLED': 'false', 'INVITE_REQUIRED': 'false', 'COOKIE_SECURE': 'false',
        'SITE_ORIGIN': 'http://127.0.0.1:3000', 'NEXT_PUBLIC_SITE_URL': 'http://127.0.0.1:3000',
        'WEB_ORIGIN': 'http://127.0.0.1:3000', 'STORAGE_ENDPOINT': endpoint, 'STORAGE_PUBLIC_ENDPOINT': endpoint,
        'STORAGE_BUCKET': 'todosns-m06', 'STORAGE_REGION': 'us-east-1', 'STORAGE_ACCESS_KEY_ID': access,
        'STORAGE_SECRET_ACCESS_KEY': secret, 'STORAGE_FORCE_PATH_STYLE': 'true',
    }
    for label, url in [('core', env['DATABASE_URL']), ('history', env['TODO_HISTORY_TEST_DATABASE_URL'])]:
        with (WORK / (label + '-migrations.log')).open('w') as log:
            subprocess.run(['npm', 'run', 'prisma:deploy', '-w', '@mungsil/api'], cwd=ROOT,
                           env={**os.environ, **env, 'DATABASE_URL': url}, stdout=log, stderr=subprocess.STDOUT, check=True)
    subprocess.run(['node', '-e', '''
const {CreateBucketCommand,PutBucketVersioningCommand}=require('@aws-sdk/client-s3');
const s=require('./apps/api/dist/src/storage.js').createStorageClients();
(async()=>{try{await s.internal.send(new CreateBucketCommand({Bucket:s.bucket}));
await s.internal.send(new PutBucketVersioningCommand({Bucket:s.bucket,VersioningConfiguration:{Status:'Enabled'}}));}
finally{s.internal.destroy();s.public.destroy();}})().catch(()=>process.exitCode=1);
'''], cwd=ROOT, env={**os.environ, **env}, check=True)
    save(CONFIG, env)
    state['ready'] = True
    save(STATE, state)
    print('Temporary PostgreSQL/Redis/MinIO ready; migrations and versioned bucket verified; credentials not printed')


if ACTION == 'start':
    try:
        start()
    except Exception:
        stop()
        raise
elif ACTION == 'stop':
    stop()
elif ACTION == 'test':
    assert state and state.get('ready') and state['containers']
    owned_containers()
    env = {**os.environ, **json.loads(CONFIG.read_text())}
    for task in ['lint', 'test', 'build']:
        with (WORK / ('root-' + task + '.log')).open('w') as log:
            subprocess.run(['npm', 'run', task], cwd=ROOT, env=env,
                           stdout=log, stderr=subprocess.STDOUT, check=True)
        print(task + ' passed', flush=True)
else:
    raise ValueError('Use start, test or stop, followed by a workspace/temp directory')
