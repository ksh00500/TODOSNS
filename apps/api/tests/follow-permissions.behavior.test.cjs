const assert = require("node:assert/strict");
const test = require("node:test");
const { BadRequestException, NotFoundException } = require("@nestjs/common");
const { MungsilService } = require("../dist/src/mungsil.service.js");

function harness(blocks = [], active = true) {
  const writes = []; let following = false;
  const service = new MungsilService({
    user: {
      findFirst: async ({ where }) => { assert.deepEqual(where, { id: "them", suspendedAt: null, deletionRequestedAt: null }); return active ? { id: "them" } : null; },
      findUniqueOrThrow: async () => ({ handle: "me.cloud" }),
    },
    block: { count: async ({ where }) => blocks.filter(row => where.OR.some(part => part.blockerId === row.blockerId && part.blockedId === row.blockedId)).length },
    follow: {
      findUnique: async () => following ? { followerId: "me", followingId: "them" } : null,
      create: async ({ data }) => { writes.push(["follow", data]); following = true; },
      delete: async () => { writes.push(["unfollow"]); following = false; },
    },
  }, {}, {}, {}, {});
  service.notify = async (...args) => { writes.push(["notify", ...args]); };
  return { service, writes };
}

for (const [blockerId, blockedId] of [["me", "them"], ["them", "me"]]) {
  test(`팔로우 변경은 ${blockerId} → ${blockedId} 차단 뒤 쓰기와 알림을 거부한다`, async () => {
    const { service, writes } = harness([{ blockerId, blockedId }]);
    await assert.rejects(service.toggleFollow("me", "them"), NotFoundException);
    assert.deepEqual(writes, []);
  });
}
test("팔로우 대상이 탈퇴·정지 또는 존재하지 않으면 변경하지 않는다", async () => {
  const { service, writes } = harness([], false);
  await assert.rejects(service.toggleFollow("me", "them"), NotFoundException);
  await assert.rejects(service.toggleFollow("me", "me"), BadRequestException);
  assert.deepEqual(writes, []);
});
test("활성 대상과 차단 없는 관계의 팔로우·취소 동작과 알림을 유지한다", async () => {
  const { service, writes } = harness();
  assert.deepEqual(await service.toggleFollow("me", "them"), { following: true });
  assert.deepEqual(await service.toggleFollow("me", "them"), { following: false });
  assert.equal(writes.filter(row => row[0] === "follow").length, 1);
  assert.equal(writes.filter(row => row[0] === "notify").length, 1);
  assert.equal(writes.filter(row => row[0] === "unfollow").length, 1);
});
