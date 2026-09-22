const test = require("node:test");
const assert = require("node:assert/strict");
const { mkdtempSync, readFileSync, rmSync, writeFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join, resolve } = require("node:path");
const { loadDatabaseUrl, readDatabaseUrl } = require("../scripts/database-secret.cjs");

const root = resolve(__dirname, "../../..");
const file = (path) => readFileSync(resolve(root, path), "utf8");

test("database URL은 비밀 파일에서만 읽고 값은 오류에 노출하지 않는다", () => {
  const directory = mkdtempSync(join(tmpdir(), "mungsil-db-secret-"));
  const secret = join(directory, "runtime-url");
  const expected = "postgresql://runtime:long-password@example.test:5432/mungsil?schema=public";
  writeFileSync(secret, `${expected}\n`, { mode: 0o600 });
  const original = process.env.DATABASE_URL;
  try {
    delete process.env.DATABASE_URL;
    assert.equal(readDatabaseUrl(secret), expected);
    assert.equal(loadDatabaseUrl({ DATABASE_URL_FILE: secret }), expected);
    assert.equal(process.env.DATABASE_URL, expected);
    assert.throws(
      () => loadDatabaseUrl({ DATABASE_URL_FILE: secret, DATABASE_URL: expected }),
      /inline DATABASE_URL is forbidden/,
    );
    writeFileSync(secret, "not-a-url\n");
    assert.throws(() => readDatabaseUrl(secret), /not a valid URL/);
  } finally {
    if (original === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = original;
    rmSync(directory, { recursive: true, force: true });
  }
});

test("운영과 staging API는 migration 비밀이나 시작 migration을 포함하지 않는다", () => {
  for (const path of ["infra/docker-compose.yml", "infra/docker-compose.staging.yml"]) {
    const compose = file(path);
    const api = compose.slice(compose.indexOf("  api:"), compose.indexOf("  migrate:"));
    const migrate = compose.slice(compose.indexOf("  migrate:"), compose.indexOf("  seed:"));
    assert.match(api, /database_runtime_url/);
    assert.match(api, /start-runtime\.cjs/);
    assert.doesNotMatch(api, /database_migrator_url|migrate deploy|SEED_ADMIN_PASSWORD/);
    assert.match(migrate, /database_migrator_url/);
    assert.match(migrate, /mungsil_migrator/);
    assert.match(migrate, /mungsil_owner/);
    assert.match(migrate, /run-migrations\.cjs/);
    assert.doesNotMatch(migrate, /database_runtime_url/);
  }
});

test("runtime SQL은 명시적 allowlist이며 DDL과 migration history를 부여하지 않는다", () => {
  const roles = file("infra/database/bootstrap-login-roles.sql");
  const grants = file("infra/database/apply-runtime-grants.sql");
  const verifier = file("apps/api/scripts/verify-db-logins.cjs");
  assert.match(roles, /mungsil_owner NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS/);
  assert.match(roles, /mungsil_runtime LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS/);
  assert.match(grants, /GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE/);
  assert.match(grants, /REVOKE ALL ON TABLE public\._prisma_migrations FROM mungsil_runtime/);
  assert.doesNotMatch(grants, /GRANT ALL[^\n]*mungsil_runtime/);
  assert.doesNotMatch(grants, /ALTER DEFAULT PRIVILEGES[^\n]*GRANT[^\n]*mungsil_runtime/);
  assert.match(verifier, /runtime DDL/);
  assert.match(verifier, /UPDATE public\.migrator_synthetic_ddl_check/);
  assert.match(verifier, /runtime migration history write/);
  assert.match(verifier, /runtime owner role/);
  assert.match(verifier, /runtime restricted analytics/);
  assert.match(verifier, /new table unexpectedly inherited runtime DML/);
});

test("CI는 잘못된 LOGIN 시작 실패, migration 재실행, 저장소와 백업 복원을 실제로 실행한다", () => {
  const ci = file(".github/workflows/ci.yml");
  assert.equal((ci.match(/run-migrations\.cjs/g) ?? []).length >= 3, true);
  assert.match(ci, /runtime entrypoint accepted the migrator LOGIN/);
  assert.match(ci, /migration entrypoint accepted the runtime LOGIN/);
  assert.match(ci, /database role mismatch: expected mungsil_runtime\/mungsil_runtime, received mungsil_migrator\/mungsil_owner/);
  assert.match(ci, /database role mismatch: expected mungsil_migrator\/mungsil_owner, received mungsil_runtime\/mungsil_runtime/);
  assert.match(ci, /RUN_OBJECT_STORAGE_E2E: "1"/);
  assert.match(ci, /postgres:17-alpine pg_dump[\s\S]*mungsil_backup/);
  assert.match(ci, /postgres:17-alpine pg_restore[\s\S]*backup_restore_probe/);
});

test("배포 경로는 이미지 준비 후 migration 성공 전까지 API를 교체하지 않는다", () => {
  const deploy = file("infra/deploy-separated.sh");
  const migration = deploy.indexOf("run --rm --no-deps migrate");
  const api = deploy.indexOf("--wait --wait-timeout 180 api");
  assert.ok(migration > deploy.indexOf("compose build web"));
  assert.ok(api > migration);
  assert.match(deploy, /Existing API remains unchanged on failure/);
});

test("migration runner는 hoist된 Prisma CLI를 Node로 실행한다", () => {
  const runner = file("apps/api/scripts/run-migrations.cjs");
  assert.match(runner, /require\.resolve\("prisma\/build\/index\.js"\)/);
  assert.match(runner, /spawnSync\(process\.execPath/);
  assert.doesNotMatch(runner, /node_modules\/\.bin\/prisma/);
});

test("백업은 bootstrap 계정 대신 전용 read-only LOGIN을 사용한다", () => {
  for (const path of ["infra/backup.sh", "infra/backup-to-s3.sh", "infra/backup.ps1"]) {
    const script = file(path);
    assert.match(script, /cat \/run\/secrets\/database_backup_password/);
    assert.match(script, /-U mungsil_backup/);
    assert.doesNotMatch(script, /pg_dump -U mungsil(?:\s|$)/);
  }
});

test("Linux runner 이미지는 동일 Node digest와 lockfile을 고정한다", () => {
  const api = file("apps/api/Dockerfile");
  const web = file("apps/web/Dockerfile");
  for (const dockerfile of [api, web]) {
    assert.match(dockerfile, /node:24-alpine@sha256:[a-f0-9]{64}/);
    assert.match(dockerfile, /COPY package-lock\.json \.\/package-lock\.json/);
  }
  assert.match(api, /COPY --from=prod-deps \/app\/node_modules \.\/node_modules/);
  assert.doesNotMatch(api, /\/app\/apps\/api\/node_modules/);
  assert.match(file(".github/workflows/ci.yml"), /require\('@prisma\/client'\); require\('sharp'\); require\('nodemailer'\)/);
});
