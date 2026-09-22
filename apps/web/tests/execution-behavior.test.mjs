import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";

function load(relativePath) {
  const file = path.resolve(import.meta.dirname, relativePath);
  const compiled = ts.transpileModule(fs.readFileSync(file, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const mod = { exports: {} };
  vm.runInContext(compiled, vm.createContext({ exports: mod.exports, module: mod }), { filename: file });
  return mod.exports;
}

const chat = load("../lib/chat-state.ts");
const rollback = load("../lib/query-rollback.ts");

test("API 실패와 전송 중 추가 입력은 채팅 초안을 지우지 않는다", () => {
  assert.equal(chat.shouldClearChatDraft(3, 3, false), false);
  assert.equal(chat.shouldClearChatDraft(3, 4, true), false);
  assert.equal(chat.shouldClearChatDraft(3, 3, true), true);
});

test("과거 메시지를 읽는 중 새 메시지가 와도 자동 스크롤하지 않고 개수만 계산한다", () => {
  assert.equal(chat.isNearChatBottom({ scrollHeight: 2_000, scrollTop: 400, clientHeight: 700 }), false);
  assert.equal(chat.isNearChatBottom({ scrollHeight: 2_000, scrollTop: 1_200, clientHeight: 700 }), true);
  assert.equal(chat.countNewChatMessages([{ id: "old" }, { id: "new-1" }, { id: "new-2" }], "old"), 2);
  assert.equal(chat.countNewChatMessages([{ id: "new-1" }], "missing"), 0);
});

test("낙관적 완료와 응원 실패는 모든 캐시 스냅샷을 원래 값으로 복원한다", () => {
  const cache = new Map([
    [JSON.stringify(["todos", "2026-09-16"]), [{ id: "todo", completedAt: null }]],
    [JSON.stringify(["feed", "recent"]), { pages: [{ items: [{ id: "post", cheered: false, cheerCount: 0 }] }] }],
  ]);
  const snapshots = [...cache.entries()].map(([key, data]) => [JSON.parse(key), structuredClone(data)]);
  cache.set(JSON.stringify(["todos", "2026-09-16"]), [{ id: "todo", completedAt: "optimistic" }]);
  cache.set(JSON.stringify(["feed", "recent"]), { pages: [{ items: [{ id: "post", cheered: true, cheerCount: 1 }] }] });
  rollback.restoreQuerySnapshots({ setQueryData: (key, data) => cache.set(JSON.stringify(key), data) }, snapshots);
  assert.equal(cache.get(JSON.stringify(["todos", "2026-09-16"]))[0].completedAt, null);
  assert.deepEqual(cache.get(JSON.stringify(["feed", "recent"])).pages[0].items[0], { id: "post", cheered: false, cheerCount: 0 });
});
