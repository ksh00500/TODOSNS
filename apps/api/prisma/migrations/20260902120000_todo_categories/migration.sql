CREATE TABLE "TodoCategory" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "name" VARCHAR(30) NOT NULL,
  "baseCategory" VARCHAR(30) NOT NULL,
  "icon" VARCHAR(30) NOT NULL DEFAULT 'tag',
  "color" VARCHAR(30) NOT NULL DEFAULT 'lilac',
  "position" INTEGER NOT NULL DEFAULT 0,
  "isDefault" BOOLEAN NOT NULL DEFAULT false,
  "archivedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TodoCategory_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "Todo" ADD COLUMN "categoryId" TEXT;
ALTER TABLE "TodoSeries" ADD COLUMN "categoryId" TEXT;

CREATE UNIQUE INDEX "TodoCategory_userId_name_key" ON "TodoCategory"("userId", "name");
CREATE INDEX "TodoCategory_userId_archivedAt_position_idx" ON "TodoCategory"("userId", "archivedAt", "position");
CREATE INDEX "Todo_categoryId_idx" ON "Todo"("categoryId");
CREATE INDEX "TodoSeries_categoryId_idx" ON "TodoSeries"("categoryId");

ALTER TABLE "TodoCategory" ADD CONSTRAINT "TodoCategory_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Todo" ADD CONSTRAINT "Todo_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "TodoCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "TodoSeries" ADD CONSTRAINT "TodoSeries_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "TodoCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;
