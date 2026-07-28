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
