// Isolated M-06 fixture host. This is never imported by the production server.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { randomBytes } = require("node:crypto");
const { execFileSync } = require("node:child_process");

const configPath = process.env.M06_RUNTIME_CONFIG;
assert.ok(configPath, "M06_RUNTIME_CONFIG must point to the temporary synthetic configuration");
const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
for (const key of ["DATABASE_URL", "REDIS_URL", "STORAGE_ENDPOINT", "STORAGE_PUBLIC_ENDPOINT"]) {
  assert.ok(["127.0.0.1", "localhost"].includes(new URL(config[key]).hostname), `${key} must use loopback`);
}
assert.equal(new URL(config.DATABASE_URL).pathname, "/todosns_m06");
Object.assign(process.env, config, { NODE_ENV: "test", SMTP_HOST: "", PUSH_ENABLED: "false", GOOGLE_AUTH_ENABLED: "false" });

require("reflect-metadata");
const { NestFactory } = require("@nestjs/core");
const { ValidationPipe } = require("@nestjs/common");
const cookieParser = require("cookie-parser");
const { PrismaClient } = require("@prisma/client");
const { hash } = require("bcryptjs");
const { AppModule } = require("../../../apps/api/dist/src/app.module.js");

const output = path.dirname(configPath);
const repository = path.resolve(__dirname, "../../..");
assert.ok(path.resolve(output) !== repository && !path.resolve(output).startsWith(repository + path.sep), "Keep fixtures outside the checkout");
const fixturePath = path.join(output, "device-fixture.json");
const pidPath = path.join(output, "real-api.pid");
const db = new PrismaClient();
const ids = [];
let app;
let stopping = false;
let wroteFixture = false;
let wrotePid = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  if (app) await app.close();
  if (ids.length) await db.user.deleteMany({ where: { id: { in: ids } } });
  await db.$disconnect();
  if (wroteFixture) {
    fs.rmSync(fixturePath, { force: true });
  }
  if (wrotePid) fs.rmSync(pidPath, { force: true });
  console.log("M-06 fixture host stopped; owned resources cleaned");
}
async function main() {
  assert.ok(!fs.existsSync(fixturePath), "Preserve an existing fixture; stop its owner before starting another host");
  fs.writeFileSync(pidPath, String(process.pid), { flag: "wx", mode: 0o600 });
  wrotePid = true;
  const run = randomBytes(4).toString("hex");
  const requestLog = path.join(output, `real-api-requests-${run}.jsonl`);
  fs.writeFileSync(requestLog, "", { flag: "wx", mode: 0o600 });
  const password = randomBytes(18).toString("base64url");
  const passwordHash = await hash(password, 4);
  const accounts = [];
  const completedAt = new Date();
  for (const name of ["a", "b"]) {
    const user = await db.user.create({ data: {
      email: `m06-${run}-${name}@example.test`, handle: `m06_${name}_${run}`,
      nickname: `M06 ${name}`, passwordHash, birthDate: new Date("1995-01-01T00:00:00Z"),
      emailVerifiedAt: new Date(), onboardingCompletedAt: new Date(),
      timezone: name === "a" ? "America/New_York" : "Asia/Seoul",
    } });
    ids.push(user.id);
    accounts.push({ id: user.id, email: user.email, password });
    await db.todo.createMany({ data: Array.from({ length: name === "a" ? 55 : 1 }, (_, index) => {
      const number = String(index + 1).padStart(3, "0");
      return {
        id: `m06-${run}-${name}-${number}`, userId: user.id,
        title: name === "a" ? `실제 API 완료 ${number}` : "B 계정의 완료 기록",
        notes: name === "a" ? `실제 API 메모 ${number}` : "B 계정의 메모",
        dueDate: new Date(completedAt.getTime() - 3 * 86_400_000), completedAt,
        category: "생활", visibility: ["PRIVATE", "FOLLOWERS", "PUBLIC"][index % 3],
      };
    }) });
  }
  app = await NestFactory.create(AppModule, { logger: false });
  app.setGlobalPrefix("api/v1");
  app.use(cookieParser());
  app.use((req, res, next) => {
    res.on("finish", () => {
      const row = { method: req.method, path: req.path, status: res.statusCode };
      fs.appendFileSync(requestLog, JSON.stringify(row) + "\n");
    });
    next();
  });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }));
  const docker = ["--host=unix:///var/run/docker.sock"];
  const gateway = execFileSync("docker", [...docker, "inspect", "--format", "{{range .NetworkSettings.Networks}}{{.Gateway}}{{end}}", "todosns-m06-android"], { encoding: "utf8" }).trim();
  assert.match(gateway, /^(172\.(1[6-9]|2\d|3[01])|192\.168|10)\./, "Bind only to the local Docker bridge");
  // Force idle closure between UI interactions so stale-socket recovery is tested.
  app.getHttpServer().keepAliveTimeout = 50;
  app.getHttpServer().keepAliveTimeoutBuffer = 0;
  await app.listen(19106, gateway);
  const readiness = await fetch(`http://${gateway}:19106/api/v1/ready`);
  assert.equal(readiness.status, 200, "Real PostgreSQL, Redis and MinIO must all be ready");
  assert.deepEqual((await readiness.json()).checks, { database: true, redis: true, storage: true });
  fs.writeFileSync(fixturePath, JSON.stringify({
    baseUrl: "http://127.0.0.1:19106/api/v1/", accounts,
    cancelId: `m06-${run}-a-055`, deleteId: `m06-${run}-a-054`,
  }), { mode: 0o600 });
  wroteFixture = true;
  console.log(`M-06 fixture API ready; pid=${process.pid}; /ready: database/redis/storage=true; fixture=${fixturePath}`);
}
process.once("SIGINT", () => stop().then(() => process.exit(0)));
process.once("SIGTERM", () => stop().then(() => process.exit(0)));
main().catch(async (error) => {
  console.error(`M-06 fixture startup failed: ${error.name}`);
  await stop();
  process.exitCode = 1;
});
