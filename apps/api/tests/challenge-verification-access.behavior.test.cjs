const assert = require("node:assert/strict");
const test = require("node:test");
const { BadRequestException, ForbiddenException, ConflictException } = require("@nestjs/common");
const { MungsilService } = require("../dist/src/mungsil.service.js");

function harness(options = {}) {
  const writes = [];
  const challenge = {
    id: "challenge", title: "실천", creatorId: "owner", kind: "COMMUNITY", verificationMode: "PEER_PHOTO",
    startsAt: new Date(Date.now() - 60_000), endsAt: new Date(Date.now() + 60_000), endedAt: null, hiddenAt: null,
    minimumParticipants: 8, verificationCriteria: ["실천이 보이나요?"], _count: { participants: 8 }, ...options.challenge,
  };
  const check = {
    id: "check", challengeId: "challenge", userId: "owner", status: "REJECTED", attempt: 1,
    retryUntil: new Date(Date.now() + 30_000), reverifyUsed: false, hiddenAt: null,
    reviewSize: 5, approvalTarget: 4, rejectionTarget: 2, ...options.check, challenge,
  };
  const prisma = {
    challengeCheckIn: {
      findFirst: async ({ where }) => { assert.equal(where.hiddenAt, null); return check; },
      findUnique: async () => check,
      updateMany: async ({ data }) => { writes.push(["check", data]); return { count: 1 }; },
      findUniqueOrThrow: async () => ({ ...check, status: "PENDING", attempt: 2 }),
      findMany: async ({ where }) => {
        assert.equal(where.challenge.endedAt, null);
        assert.ok(where.challenge.startsAt.lte instanceof Date); assert.ok(where.challenge.endsAt.gte instanceof Date);
        return [];
      },
    },
    challengeParticipant: {
      findUnique: async ({ where }) => options.missingMember === where.challengeId_userId.userId ? null : { userId: where.challengeId_userId.userId },
      count: async () => 8,
    },
    user: { findFirst: async ({ where }) => ({ id: where.id }) },
    block: { count: async () => 0 },
    media: { count: async () => 1 },
    challengeVerificationVote: {
      findUnique: async () => null, count: async () => 0,
      create: async ({ data }) => { writes.push(["vote", data]); },
      groupBy: async () => [{ verdict: "APPROVE", _count: { _all: 1 } }],
    },
    challenge: {
      findFirst: async () => ({ ...challenge, _count: { checkIns: 0 } }),
      update: async ({ data }) => { writes.push(["challenge", data]); return challenge; },
    },
  };
  prisma.$transaction = async (operation) => operation(prisma);
  const media = {
    readyOwned: async () => { writes.push(["media-read"]); },
    attachToCheckIn: async () => { writes.push(["media-attach"]); },
  };
  const service = new MungsilService(prisma, media, {}, {}, {});
  return { service, writes, challenge, check };
}

for (const [label, state] of [
  ["수동 종료", { endedAt: new Date() }],
  ["기간 종료", { endsAt: new Date(Date.now() - 30_000) }],
  ["시작 전", { startsAt: new Date(Date.now() + 30_000) }],
  ["숨김", { hiddenAt: new Date() }],
]) {
  test(`${label} 상태에서는 새 사진·같은 사진·검수의 모든 변경을 거부한다`, async () => {
    const { service, writes, check } = harness({ challenge: state });
    await assert.rejects(service.resubmitChallengeVerification("owner", "check", { mediaId: "photo" }), BadRequestException);
    await assert.rejects(service.reverifyChallengeVerification("owner", "check"), BadRequestException);
    check.status = "PENDING";
    await assert.rejects(service.voteChallengeVerification("reviewer", "check", { answers: [{ criterionIndex: 0, result: "MET" }] }), state.hiddenAt ? ConflictException : BadRequestException);
    assert.deepEqual(writes, []);
  });
}
test("탈퇴한 제출자는 새 사진 첨부와 같은 사진 재검증을 하지 못한다", async () => {
  const { service, writes } = harness({ missingMember: "owner" });
  await assert.rejects(service.resubmitChallengeVerification("owner", "check", { mediaId: "photo" }), ForbiddenException);
  await assert.rejects(service.reverifyChallengeVerification("owner", "check"), ForbiddenException);
  assert.deepEqual(writes, []);
});
for (const member of ["owner", "reviewer"]) {
  test(`${member} 멤버십이 없으면 검수 투표를 기록하지 않는다`, async () => {
    const { service, writes } = harness({ missingMember: member, check: { status: "PENDING" } });
    await assert.rejects(service.voteChallengeVerification("reviewer", "check", { answers: [{ criterionIndex: 0, result: "MET" }] }), ForbiddenException);
    assert.deepEqual(writes, []);
  });
}
test("진행 중인 멤버의 새 사진·같은 사진 재검증과 검수는 기존 계약을 유지한다", async () => {
  for (const action of ["resubmit", "reverify", "vote"]) {
    const { service, writes, check } = harness();
    if (action === "resubmit") {
      const result = await service.resubmitChallengeVerification("owner", "check", { mediaId: "photo", note: "새 사진" });
      assert.equal(result.status, "PENDING"); assert.equal(writes.filter(row => row[0] === "media-attach").length, 1);
    } else if (action === "reverify") {
      const result = await service.reverifyChallengeVerification("owner", "check");
      assert.equal(result.status, "PENDING"); assert.equal(writes.find(row => row[0] === "check")[1].reverifyUsed, true);
    } else {
      check.status = "PENDING";
      const result = await service.voteChallengeVerification("reviewer", "check", { answers: [{ criterionIndex: 0, result: "MET" }] });
      assert.equal(result.status, "PENDING"); assert.equal(writes.filter(row => row[0] === "vote").length, 1);
    }
  }
});
test("대기열은 진행 기간과 종료되지 않은 챌린지만 조회한다", async () => {
  const { service } = harness();
  assert.deepEqual(await service.verificationQueue("reviewer", { challengeId: "challenge", limit: 1 }), { contributionCount: 0, items: [] });
});
test("종료된 챌린지 편집은 작성자와 운영자 모두에게 거부되고 시작 전 편집은 유지된다", async () => {
  for (const role of ["USER", "ADMIN"]) {
    const { service, writes } = harness({ challenge: { endedAt: new Date() } });
    await assert.rejects(service.updateChallenge("owner", role, "challenge", { title: "변경" }), BadRequestException);
    assert.deepEqual(writes, []);
  }
  const { service, writes } = harness({ challenge: { startsAt: new Date(Date.now() + 30_000) } });
  await service.updateChallenge("owner", "USER", "challenge", { title: "변경" });
  assert.equal(writes[0][1].title, "변경");
});
