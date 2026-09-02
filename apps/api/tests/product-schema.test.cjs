const test = require("node:test");
const assert = require("node:assert/strict");
const { readFile } = require("node:fs/promises");
const { join } = require("node:path");

test("TODO 리스트 복제와 게시물 연결 필드가 스키마에 존재한다", async () => {
  const schema = await readFile(join(__dirname, "../prisma/schema.prisma"), "utf8");
  assert.match(schema, /sourceTodoListId\s+String\?/);
  assert.match(schema, /todoListId\s+String\?/);
  assert.match(schema, /interests\s+String\[\]/);
});

test("새 스키마 변경에 운영 배포용 마이그레이션이 포함된다", async () => {
  const migration = await readFile(join(__dirname, "../prisma/migrations/20260723100000_todo_list_sharing/migration.sql"), "utf8");
  assert.match(migration, /TodoList_sourceTodoListId_fkey/);
  assert.match(migration, /Post_todoListId_fkey/);
});

test("사용자 카테고리는 공개 기준과 반복 TODO 연결을 함께 보존한다", async () => {
  const schema = await readFile(join(__dirname, "../prisma/schema.prisma"), "utf8");
  const migration = await readFile(join(__dirname, "../prisma/migrations/20260902120000_todo_categories/migration.sql"), "utf8");
  const service = await readFile(join(__dirname, "../src/mungsil.service.ts"), "utf8");
  const recurrence = await readFile(join(__dirname, "../src/recurrence.service.ts"), "utf8");
  assert.match(schema, /model TodoCategory/);
  assert.match(schema, /baseCategory\s+String/);
  assert.match(schema, /categoryId\s+String\?/);
  assert.match(migration, /TodoSeries_categoryId_fkey/);
  assert.match(service, /TODO_CATEGORY_DEFAULTS/);
  assert.match(service, /active >= 12/);
  assert.match(recurrence, /categoryId: series\.categoryId/);
});
