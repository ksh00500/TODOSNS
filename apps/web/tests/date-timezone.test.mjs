import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";

const file = path.resolve(import.meta.dirname, "../lib/date.ts");
const compiled = ts.transpileModule(fs.readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const mod = { exports: {} };
vm.runInContext(compiled, vm.createContext({ exports: mod.exports, module: mod, Intl, Date }));
const { localDateKey, dayRange } = mod.exports;

test("브라우저 위치가 아니라 계정 시간대로 오늘과 조회 경계를 계산한다", () => {
  const instant = new Date("2026-01-01T16:30:00.000Z");
  assert.equal(localDateKey(instant, "Asia/Seoul"), "2026-01-02");
  assert.equal(localDateKey(instant, "America/Los_Angeles"), "2026-01-01");
  assert.equal(JSON.stringify(dayRange("2026-01-02", "Asia/Seoul")), JSON.stringify({ from: "2026-01-01T15:00:00.000Z", to: "2026-01-02T14:59:59.999Z" }));
});

test("DST 전환일의 23시간 경계를 시간대 규칙에 맞춘다", () => {
  assert.equal(JSON.stringify(dayRange("2026-03-08", "America/New_York")), JSON.stringify({ from: "2026-03-08T05:00:00.000Z", to: "2026-03-09T03:59:59.999Z" }));
});
