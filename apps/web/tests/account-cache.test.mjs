import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";

function loadApi(fetchImpl) {
  const file = path.resolve(import.meta.dirname, "../lib/api.ts");
  const compiled = ts.transpileModule(fs.readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const local = new Map();
  const stores = new Map();
  const browser = {
    localStorage: { setItem: (key, value) => local.set(key, value), removeItem: (key) => local.delete(key), getItem: (key) => local.get(key) ?? null },
    caches: {
      open: async (name) => { if (!stores.has(name)) stores.set(name, new Map()); const values = stores.get(name); return { put: async (key, value) => values.set(String(key), value), match: async (key) => values.get(String(key)), delete: async (key) => values.delete(String(key)), keys: async () => [...values.keys()] }; },
      delete: async (name) => stores.delete(name),
    },
    addEventListener() {}, removeEventListener() {},
  };
  const mod = { exports: {} };
  vm.runInContext(compiled, vm.createContext({ exports: mod.exports, module: mod, require: () => ({ isDemoMode: () => false, demoAvailable: false, DEMO_MODE_KEY: "demo" }), process: { env: { NEXT_PUBLIC_API_URL: "https://api.invalid" } }, window: browser, navigator: { onLine: true }, fetch: fetchImpl, Response, Headers, URL, console, crypto, AbortController, atob }), { filename: file });
  return { api: mod.exports, stores, browser };
}

test("계정 전환은 개인 오프라인 캐시를 분리하고 이전 계정의 늦은 응답을 저장하지 않는다", async () => {
  let release;
  const delayed = new Promise((resolve) => { release = resolve; });
  const { api, stores } = loadApi(async () => { await delayed; return new Response(JSON.stringify([{ id: "a-private" }]), { headers: { "content-type": "application/json" } }); });
  api.setAccessToken("account-a");
  const scopeA = api.getSessionScope();
  const pending = api.apiFetch("/todos");
  api.setAccessToken("account-b");
  const scopeB = api.getSessionScope();
  assert.notEqual(scopeA, scopeB);
  release();
  await pending;
  await new Promise((resolve) => setImmediate(resolve));
  const aStore = [...stores.entries()].find(([name]) => name.endsWith(encodeURIComponent(scopeA)))?.[1];
  const bStore = [...stores.entries()].find(([name]) => name.endsWith(encodeURIComponent(scopeB)))?.[1];
  assert.equal(aStore?.size ?? 0, 0);
  assert.equal(bStore?.size ?? 0, 0);
});

test("응답 본문을 읽은 뒤에도 캐시 저장에서 clone 오류가 발생하지 않는다", async () => {
  const errors = [];
  const onError = (error) => errors.push(String(error));
  process.on("unhandledRejection", onError);
  try {
    const { api } = loadApi(async () => new Response(JSON.stringify([{ id: "ok" }]), { headers: { "content-type": "application/json" } }));
    api.setAccessToken("account-a");
    assert.deepEqual(await api.apiFetch("/todos"), [{ id: "ok" }]);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(errors.some((error) => error.includes("Body has already been consumed")), false);
  } finally {
    process.removeListener("unhandledRejection", onError);
  }
});

test("응답 유실로 변경 요청을 다시 보낼 때 같은 Idempotency-Key를 유지한다", async () => {
  const keys = [];
  let attempts = 0;
  const { api } = loadApi(async (_url, init) => {
    keys.push(init.headers["Idempotency-Key"]);
    attempts += 1;
    if (attempts === 1) throw new TypeError("network response lost");
    return new Response(JSON.stringify({ ok: true }), { headers: { "content-type": "application/json" } });
  });
  api.setAccessToken("account-a");
  assert.deepEqual(await api.apiFetch("/todos/t1/complete", { method: "POST", body: JSON.stringify({ share: false }) }), { ok: true });
  assert.equal(attempts, 2);
  assert.equal(keys[0], keys[1]);
});
