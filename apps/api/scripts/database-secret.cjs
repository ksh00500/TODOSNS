const { readFileSync } = require("node:fs");

function readDatabaseUrl(filePath, label = "database URL") {
  if (!filePath) throw new Error(`${label} secret file is required`);
  let value;
  try {
    value = readFileSync(filePath, "utf8").trim();
  } catch {
    throw new Error(`${label} secret file could not be read`);
  }
  if (!value) throw new Error(`${label} secret file is empty`);
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${label} secret is not a valid URL`);
  }
  if (!new Set(["postgresql:", "postgres:"]).has(parsed.protocol)) {
    throw new Error(`${label} must use PostgreSQL`);
  }
  if (!parsed.username || !parsed.password || !parsed.hostname || !parsed.pathname.slice(1)) {
    throw new Error(`${label} must include username, password, host, and database`);
  }
  return value;
}

function loadDatabaseUrl(env = process.env) {
  if (env.DATABASE_URL) throw new Error("inline DATABASE_URL is forbidden for this container entrypoint");
  const value = readDatabaseUrl(env.DATABASE_URL_FILE);
  process.env.DATABASE_URL = value;
  return value;
}

async function assertDatabaseIdentity(PrismaClient, expectedSessionRole, expectedCurrentRole) {
  if (!expectedSessionRole || !expectedCurrentRole) throw new Error("expected database roles are required");
  const prisma = new PrismaClient();
  try {
    const rows = await prisma.$queryRawUnsafe(
      "SELECT session_user::text AS session_role, current_user::text AS current_role",
    );
    const identity = rows[0];
    if (identity?.session_role !== expectedSessionRole || identity?.current_role !== expectedCurrentRole) {
      throw new Error(
        `database role mismatch: expected ${expectedSessionRole}/${expectedCurrentRole}, received ${identity?.session_role ?? "unknown"}/${identity?.current_role ?? "unknown"}`,
      );
    }
  } finally {
    await prisma.$disconnect();
  }
}

module.exports = { assertDatabaseIdentity, loadDatabaseUrl, readDatabaseUrl };
