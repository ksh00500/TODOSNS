const { PrismaClient } = require("@prisma/client");
const { readDatabaseUrl } = require("./database-secret.cjs");

function client(url) {
  return new PrismaClient({ datasources: { db: { url } } });
}

async function identity(prisma) {
  const rows = await prisma.$queryRawUnsafe(
    "SELECT session_user::text AS session_role, current_user::text AS current_role",
  );
  return rows[0];
}

async function expectDenied(prisma, label, sql) {
  try {
    await prisma.$executeRawUnsafe(sql);
  } catch (error) {
    const code = error?.meta?.code ?? error?.code;
    if (code === "42501" || /permission denied|must be owner|not permitted/i.test(error?.message ?? "")) return;
    throw new Error(`${label} failed for an unexpected reason: ${code ?? error?.message}`);
  }
  throw new Error(`${label} was unexpectedly allowed`);
}

async function verifyRuntime(url) {
  const prisma = client(url);
  try {
    const roles = await identity(prisma);
    if (roles.session_role !== "mungsil_runtime" || roles.current_role !== "mungsil_runtime") {
      throw new Error(`runtime identity mismatch: ${roles.session_role}/${roles.current_role}`);
    }
    const attributes = await prisma.$queryRawUnsafe(
      "SELECT rolsuper, rolcreatedb, rolcreaterole, rolinherit, rolbypassrls FROM pg_roles WHERE rolname = 'mungsil_runtime'",
    );
    if (!attributes[0] || attributes[0].rolsuper || attributes[0].rolcreatedb || attributes[0].rolcreaterole || attributes[0].rolinherit || attributes[0].rolbypassrls) {
      throw new Error("runtime role has an elevated or inherited attribute");
    }
    const ownerMembership = await prisma.$queryRawUnsafe(
      "SELECT COUNT(*)::bigint AS count FROM pg_auth_members membership JOIN pg_roles granted ON granted.oid = membership.roleid JOIN pg_roles member ON member.oid = membership.member WHERE member.rolname = 'mungsil_runtime' AND granted.rolname IN ('mungsil_owner', 'mungsil_migrator')",
    );
    if (ownerMembership[0]?.count !== 0n) throw new Error("runtime has a privileged role membership");
    const ownership = await prisma.$queryRawUnsafe(
      "SELECT COUNT(*)::bigint AS count FROM pg_class WHERE relowner = (SELECT oid FROM pg_roles WHERE rolname = 'mungsil_runtime')",
    );
    if (ownership[0]?.count !== 0n) throw new Error("runtime unexpectedly owns a database object");
    const temporary = await prisma.$queryRawUnsafe(
      "SELECT has_database_privilege(current_user, current_database(), 'TEMP') AS allowed",
    );
    if (temporary[0]?.allowed) throw new Error("runtime unexpectedly has database TEMP privilege");
    await prisma.$queryRawUnsafe('SELECT COUNT(*)::bigint FROM public."User"');
    await prisma.$queryRawUnsafe('SELECT COUNT(*)::bigint FROM governance."ObjectDeletionTask"');
    if (process.env.ALLOW_SYNTHETIC_DDL_CHECK === "1") {
      await prisma.$executeRawUnsafe("INSERT INTO public.migrator_synthetic_ddl_check(id) VALUES (1)");
      const rows = await prisma.$queryRawUnsafe("SELECT id FROM public.migrator_synthetic_ddl_check WHERE id = 1");
      if (rows[0]?.id !== 1) throw new Error("runtime allowed DML fixture could not be read");
      await prisma.$executeRawUnsafe("UPDATE public.migrator_synthetic_ddl_check SET id = 2 WHERE id = 1");
      await prisma.$executeRawUnsafe("DELETE FROM public.migrator_synthetic_ddl_check WHERE id = 2");
    }
    await expectDenied(prisma, "runtime DDL", "CREATE TABLE public.runtime_must_not_create(id integer)");
    await expectDenied(prisma, "runtime schema DDL", "CREATE SCHEMA runtime_must_not_create");
    await expectDenied(prisma, "runtime truncate", 'TRUNCATE TABLE public."User"');
    await expectDenied(prisma, "runtime migration history write", "UPDATE public._prisma_migrations SET logs = logs WHERE FALSE");
    await expectDenied(prisma, "runtime owner role", "SET ROLE mungsil_owner");
    await expectDenied(prisma, "runtime migrator role", "SET ROLE mungsil_migrator");
    await expectDenied(prisma, "runtime role management", "CREATE ROLE runtime_must_not_create");
    await expectDenied(prisma, "runtime restricted analytics", 'SELECT 1 FROM analytics_restricted."AnalyticsEvent" LIMIT 1');
    await expectDenied(prisma, "runtime release data", 'SELECT 1 FROM analytics_release."DatasetRelease" LIMIT 1');
    await expectDenied(prisma, "runtime policy approval data", 'SELECT 1 FROM governance."PolicyVersion" LIMIT 1');
  } finally {
    await prisma.$disconnect();
  }
}

async function verifyBackup(url) {
  const prisma = client(url);
  try {
    const roles = await identity(prisma);
    if (roles.session_role !== "mungsil_backup" || roles.current_role !== "mungsil_backup") {
      throw new Error(`backup identity mismatch: ${roles.session_role}/${roles.current_role}`);
    }
    await prisma.$queryRawUnsafe('SELECT COUNT(*)::bigint FROM public."User"');
    await prisma.$queryRawUnsafe('SELECT COUNT(*)::bigint FROM analytics_restricted."AnalyticsEvent"');
    await expectDenied(prisma, "backup application write", 'UPDATE public."User" SET "updatedAt" = "updatedAt" WHERE FALSE');
    await expectDenied(prisma, "backup truncate", 'TRUNCATE TABLE public."User"');
    await expectDenied(prisma, "backup DDL", "CREATE TABLE public.backup_must_not_create(id integer)");
    await expectDenied(prisma, "backup migration write", "UPDATE public._prisma_migrations SET logs = logs WHERE FALSE");
    await expectDenied(prisma, "backup owner role", "SET ROLE mungsil_owner");
  } finally {
    await prisma.$disconnect();
  }
}

async function verifyMigrator(url) {
  const prisma = client(url);
  try {
    const roles = await identity(prisma);
    if (roles.session_role !== "mungsil_migrator" || roles.current_role !== "mungsil_owner") {
      throw new Error(`migrator identity mismatch: ${roles.session_role}/${roles.current_role}`);
    }
    await prisma.$queryRawUnsafe("SELECT COUNT(*)::bigint FROM public._prisma_migrations");
    if (process.env.ALLOW_SYNTHETIC_DDL_CHECK === "1") {
      await prisma.$executeRawUnsafe("CREATE TABLE public.migrator_synthetic_ddl_check(id integer)");
      const rows = await prisma.$queryRawUnsafe(
        "SELECT pg_get_userbyid(relowner)::text AS owner, has_table_privilege('mungsil_runtime', 'public.migrator_synthetic_ddl_check', 'SELECT,INSERT,UPDATE,DELETE') AS runtime_allowed FROM pg_class WHERE oid = 'public.migrator_synthetic_ddl_check'::regclass",
      );
      if (rows[0]?.owner !== "mungsil_owner") throw new Error(`new object owner mismatch: ${rows[0]?.owner}`);
      if (rows[0]?.runtime_allowed) throw new Error("new table unexpectedly inherited runtime DML");
      await prisma.$executeRawUnsafe(
        "GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.migrator_synthetic_ddl_check TO mungsil_runtime",
      );
    }
  } finally {
    await prisma.$disconnect();
  }
}

async function cleanupMigratorFixture(url) {
  const prisma = client(url);
  try {
    await prisma.$executeRawUnsafe("DROP TABLE IF EXISTS public.migrator_synthetic_ddl_check");
  } finally {
    await prisma.$disconnect();
  }
}

async function main() {
  const runtimeUrl = readDatabaseUrl(process.env.RUNTIME_DATABASE_URL_FILE, "runtime database URL");
  const migratorUrl = readDatabaseUrl(process.env.MIGRATOR_DATABASE_URL_FILE, "migrator database URL");
  const backupUrl = readDatabaseUrl(process.env.BACKUP_DATABASE_URL_FILE, "backup database URL");
  try {
    await verifyMigrator(migratorUrl);
    await verifyRuntime(runtimeUrl);
    await verifyBackup(backupUrl);
  } finally {
    if (process.env.ALLOW_SYNTHETIC_DDL_CHECK === "1") await cleanupMigratorFixture(migratorUrl);
  }
  console.log("database LOGIN boundary verification passed");
}

main().catch((error) => {
  console.error(`database LOGIN boundary verification failed: ${error.message}`);
  process.exitCode = 1;
});
