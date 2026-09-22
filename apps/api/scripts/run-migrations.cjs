const { spawnSync } = require("node:child_process");
const { resolve } = require("node:path");
const { assertDatabaseIdentity, loadDatabaseUrl } = require("./database-secret.cjs");

async function main() {
  loadDatabaseUrl();
  const { PrismaClient } = require("@prisma/client");
  await assertDatabaseIdentity(
    PrismaClient,
    process.env.EXPECTED_DB_SESSION_ROLE,
    process.env.EXPECTED_DB_CURRENT_ROLE,
  );
  const prisma = resolve(__dirname, "../node_modules/.bin/prisma");
  const result = spawnSync(prisma, ["migrate", "deploy", "--schema", resolve(__dirname, "../prisma/schema.prisma")], {
    env: process.env,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`prisma migrate deploy exited with status ${result.status}`);
}

main().catch((error) => {
  console.error(`migration job failed: ${error.message}`);
  process.exitCode = 1;
});
