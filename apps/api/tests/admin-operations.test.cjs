const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("베타 운영 API는 역할에 따라 운영 기능을 분리한다", () => {
  const controller = read("src/controllers.ts");
  for (const route of [
    '@Get("overview")',
    '@Get("invite-codes")',
    '@Post("invite-codes")',
    '@Get("users")',
    '@Patch("users/:id/suspension")',
    '@Get("content")',
    '@Patch("content/:type/:id/visibility")',
    '@Get("audit-logs")',
  ]) assert.match(controller, new RegExp(route.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(controller, /inviteCodes[\s\S]*allowAdmin/);
  assert.match(controller, /users[\s\S]*allowAdmin/);
  assert.match(controller, /auditLogs[\s\S]*allowAdmin/);
});

test("사용자 정지는 활성 세션을 폐기하고 운영 이력을 남긴다", () => {
  const service = read("src/mungsil.service.ts");
  assert.match(service, /async updateUserSuspension[\s\S]*target\.role !== "USER"/);
  assert.match(service, /async updateUserSuspension[\s\S]*session\.updateMany[\s\S]*revokedAt: now/);
  assert.match(service, /USER_SUSPENDED/);
  assert.match(service, /USER_RESTORED/);
});

test("초대 코드 원문과 인증 비밀값은 관리자 목록 응답에 포함하지 않는다", () => {
  const service = read("src/mungsil.service.ts");
  const inviteList = service.match(/async adminInviteCodes\(\)[\s\S]*?\n  }/)?.[0] ?? "";
  const userList = service.match(/async adminUsers\([\s\S]*?\n  }/)?.[0] ?? "";
  assert.match(service, /randomBytes\(5\)/);
  assert.match(service, /createHash\("sha256"\)/);
  assert.doesNotMatch(inviteList, /codeHash:\s*true/);
  assert.doesNotMatch(userList, /passwordHash:\s*true|googleId:\s*true|birthDate:\s*true/);
});

test("콘텐츠 숨김과 운영자 행동 기록 스키마가 마이그레이션된다", () => {
  const service = read("src/mungsil.service.ts");
  const schema = read("prisma/schema.prisma");
  const migration = read("prisma/migrations/20260830120000_admin_beta_operations/migration.sql");
  assert.match(service, /async updateAdminContentVisibility/);
  assert.match(service, /CONTENT_HIDDEN/);
  assert.match(service, /CONTENT_RESTORED/);
  for (const field of ["suspensionReason", "AdminAuditLog", "adminId", "targetType", "targetId"]) {
    assert.match(schema, new RegExp(field));
    assert.match(migration, new RegExp(field));
  }
});
