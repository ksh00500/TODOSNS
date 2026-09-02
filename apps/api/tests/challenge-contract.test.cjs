const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("숨김 챌린지는 참여와 직접 ID 인증에서 모두 차단한다", () => {
  const service = read("src/mungsil.service.ts");
  assert.match(service, /async checkIn[\s\S]*findFirst\([\s\S]*hiddenAt: null/);
  assert.match(service, /async joinChallenge[\s\S]*hiddenAt: null/);
  assert.match(service, /async checkIn[\s\S]*assertNotBlocked\(userId, challenge\.creatorId\)/);
});

test("챌린지 수정·종료·순위와 참여자 사진 인증 API 계약이 존재한다", () => {
  const controllers = read("src/controllers.ts");
  assert.match(controllers, /@Patch\(":id"\).*updateChallenge/);
  assert.match(controllers, /@Delete\(":id"\).*removeChallenge/);
  assert.match(controllers, /@Get\(":id\/leaderboard"\)/);
  assert.match(controllers, /@Controller\("challenge-verifications"\)/);
  assert.match(controllers, /@Post\(":checkInId\/vote"\)/);
  assert.match(controllers, /@Post\("check-ins\/:checkInId\/resubmit"\)/);
  assert.match(controllers, /@Post\("check-ins\/:checkInId\/reverify"\)/);
  assert.doesNotMatch(controllers, /@Patch\("challenge-check-ins\/:id"\)/);
});

test("완주율·순위·검수 상태를 보존하는 운영 마이그레이션이 있다", () => {
  const schema = read("prisma/schema.prisma");
  const migration = read("prisma/migrations/20260829180000_challenge_beta_completion/migration.sql");
  for (const field of ["completionThreshold", "firstPlaceTitle", "finalRank", "titleAwarded", "CheckInStatus", "reviewedAt"]) {
    assert.match(schema, new RegExp(field));
    assert.match(migration, new RegExp(field));
  }
});

test("참여자 투표 스키마와 단계별 마이그레이션이 있다", () => {
  const schema = read("prisma/schema.prisma");
  const structure = read("prisma/migrations/20260830130000_peer_verification_schema/migration.sql");
  const data = read("prisma/migrations/20260830131000_peer_verification_data/migration.sql");
  for (const field of ["PEER_PHOTO", "verificationCriteria", "ChallengeVerificationVote", "approvalTarget", "retryUntil", "reverifyUsed"]) {
    assert.match(schema, new RegExp(field));
    assert.match(`${structure}\n${data}`, new RegExp(field));
  }
  assert.match(data, /CHECK[\s\S]*OPTIONAL_PHOTO/);
  assert.match(data, /PEER_PHOTO[\s\S]*REQUIRED_PHOTO/);
});

test("운영자는 사진 인증을 개별 판정하지 않고 현황만 조회한다", () => {
  const controllers = read("src/controllers.ts");
  const service = read("src/mungsil.service.ts");
  assert.match(controllers, /@Get\("challenge-verifications"\).*adminChallengeVerificationOverview/);
  assert.match(service, /async adminChallengeVerificationOverview/);
  assert.match(controllers, /challenge-check-ins\/:id\/visibility/);
  assert.match(service, /async updateChallengeCheckInVisibility/);
  assert.match(service, /ReportTarget\.CHALLENGE_CHECK_IN/);
});

test("종료 챌린지는 정기 작업으로 완주·보상 자격을 계산한다", () => {
  const service = read("src/mungsil.service.ts");
  assert.match(service, /@Cron\("0 5 \* \* \* \*"/);
  assert.match(service, /challengeLeaderboard\([\s\S]*completionThreshold/);
  assert.match(service, /RewardStatus\.ELIGIBLE/);
});
