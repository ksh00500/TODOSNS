const test = require("node:test");
const assert = require("node:assert/strict");
const { rankOf } = require("../dist/src/mungsil.service.js");

test("누적 뭉실력이 등급 경계에 맞게 변한다", () => {
  const cases = [[0, "구름씨앗"], [100, "조각구름"], [300, "솜구름"], [800, "뭉게구름"], [2000, "노을구름"], [5000, "별구름"]];
  for (const [power, rank] of cases) assert.equal(rankOf(power), rank);
});
