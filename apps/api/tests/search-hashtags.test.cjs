const test = require("node:test");
const assert = require("node:assert/strict");
const { normalizeHashtags } = require("../dist/src/mungsil.service.js");

test("해시태그를 정규화하고 중복을 제거한다", () => {
  assert.deepEqual(normalizeHashtags(["#아침루틴", "아침루틴", "READING_10"]), ["아침루틴", "reading_10"]);
});

test("공백이나 기호가 포함된 해시태그를 거부한다", () => {
  assert.throws(() => normalizeHashtags(["좋은 습관"]), /글자, 숫자, 밑줄/);
  assert.throws(() => normalizeHashtags(["운동!"]), /글자, 숫자, 밑줄/);
});
