ALTER TABLE "TodoList" ADD COLUMN "sourceTodoListId" TEXT;
ALTER TABLE "Post" ADD COLUMN "todoListId" TEXT;
ALTER TABLE "User" ADD COLUMN "interests" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

CREATE INDEX "TodoList_userId_createdAt_idx" ON "TodoList"("userId", "createdAt");
CREATE INDEX "TodoList_sourceTodoListId_idx" ON "TodoList"("sourceTodoListId");
CREATE INDEX "Post_todoListId_idx" ON "Post"("todoListId");

ALTER TABLE "TodoList"
  ADD CONSTRAINT "TodoList_sourceTodoListId_fkey"
  FOREIGN KEY ("sourceTodoListId") REFERENCES "TodoList"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Post"
  ADD CONSTRAINT "Post_todoListId_fkey"
  FOREIGN KEY ("todoListId") REFERENCES "TodoList"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
