const { assertDatabaseIdentity, loadDatabaseUrl } = require("./database-secret.cjs");

async function main() {
  loadDatabaseUrl();
  const { PrismaClient } = require("@prisma/client");
  await assertDatabaseIdentity(
    PrismaClient,
    process.env.EXPECTED_DB_SESSION_ROLE,
    process.env.EXPECTED_DB_CURRENT_ROLE,
  );
  require("../dist/src/main.js");
}

main().catch((error) => {
  console.error(`runtime database bootstrap failed: ${error.message}`);
  process.exitCode = 1;
});
