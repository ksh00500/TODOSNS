const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const vm = require("node:vm");

function loadPolicy() {
  const filename = path.join(__dirname, "../src/challenge-policy.ts");
  const source = fs.readFileSync(filename, "utf8");
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(`(function(module,exports){${output}\n})(module,module.exports);`, { module });
  return module.exports;
}

const { challengeLeaderboard, challengeTotalDays, peerVerificationDecision, peerVoteVerdict, PEER_VERIFICATION } = loadPolicy();

test("챌린지 기간은 시작일과 종료일을 모두 포함한다", () => {
  assert.equal(challengeTotalDays(new Date("2026-08-01T09:00:00Z"), new Date("2026-08-31T23:00:00Z")), 31);
});

test("승인 인증 수와 가입 시각으로 순위를 안정적으로 계산한다", () => {
  const rows = challengeLeaderboard([
    { userId: "late", joinedAt: new Date("2026-08-02T00:00:00Z"), approvedCheckIns: 8 },
    { userId: "early", joinedAt: new Date("2026-08-01T00:00:00Z"), approvedCheckIns: 8 },
    { userId: "third", joinedAt: new Date("2026-08-01T00:00:00Z"), approvedCheckIns: 6 },
  ], 10, 70, ["첫 구름", "두 번째 구름", "세 번째 구름"]);
  assert.deepEqual(JSON.parse(JSON.stringify(rows.map((item) => [item.userId, item.rank, item.successRate, item.eligible, item.titleAwarded]))), [
    ["early", 1, 80, true, "첫 구름"],
    ["late", 2, 80, true, "두 번째 구름"],
    ["third", 3, 60, false, null],
  ]);
});

test("기준별 응답은 재요청, 판단 보류, 통과 순으로 안전하게 판정한다", () => {
  assert.equal(peerVoteVerdict(["MET", "MET"]), "APPROVE");
  assert.equal(peerVoteVerdict(["MET", "UNSURE"]), "UNSURE");
  assert.equal(peerVoteVerdict(["UNSURE", "NOT_MET"]), "RETRY");
});

test("최초 5명과 재검증 7명의 임계값을 적용한다", () => {
  assert.equal(peerVerificationDecision(3, 1, 4, 2), "PENDING");
  assert.equal(peerVerificationDecision(4, 0, 4, 2), "APPROVED");
  assert.equal(peerVerificationDecision(2, 2, 4, 2), "REJECTED");
  assert.deepEqual(JSON.parse(JSON.stringify(PEER_VERIFICATION.firstReview)), { reviewSize: 5, approvalTarget: 4, rejectionTarget: 2 });
  assert.deepEqual(JSON.parse(JSON.stringify(PEER_VERIFICATION.reverify)), { reviewSize: 7, approvalTarget: 5, rejectionTarget: 3 });
  assert.equal(PEER_VERIFICATION.minimumParticipants, 8);
  assert.equal(PEER_VERIFICATION.maxAttempts, 3);
});
