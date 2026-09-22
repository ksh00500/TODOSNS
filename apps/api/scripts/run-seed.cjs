const { assertDatabaseIdentity, loadDatabaseUrl } = require("./database-secret.cjs");

async function main() {
  loadDatabaseUrl();
  const { PrismaClient } = require("@prisma/client");
  await assertDatabaseIdentity(
    PrismaClient,
    process.env.EXPECTED_DB_SESSION_ROLE,
    process.env.EXPECTED_DB_CURRENT_ROLE,
  );
  require("../prisma/seed.cjs");
}

main().catch((error) => {
  console.error(`seed job failed: ${error.message}`);
  process.exitCode = 1;
});
