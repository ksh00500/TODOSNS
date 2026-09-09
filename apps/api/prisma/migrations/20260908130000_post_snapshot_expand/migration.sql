-- Expand-only post snapshot policy fields. No existing content is removed here.
-- Production apply and legacy backfill require separate operational approval.

ALTER TABLE public."Post"
  ADD COLUMN "snapshot" JSONB,
  ADD COLUMN "snapshotSearchText" VARCHAR(2000),
  ADD COLUMN "snapshotCategories" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "sourceAccessRevokedAt" TIMESTAMP(3),
  ADD COLUMN "snapshotErasedAt" TIMESTAMP(3);

CREATE INDEX "Post_sourceAccessRevokedAt_snapshotErasedAt_createdAt_idx"
  ON public."Post"("sourceAccessRevokedAt", "snapshotErasedAt", "createdAt");

-- A more restrictive source visibility change permanently revokes new access to
-- the already captured snapshot. Re-publishing creates a new snapshot instead.
CREATE OR REPLACE FUNCTION governance.revoke_todo_post_snapshots()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
DECLARE
  old_rank INTEGER;
  new_rank INTEGER;
BEGIN
  old_rank := CASE OLD."visibility"::text WHEN 'PUBLIC' THEN 2 WHEN 'FOLLOWERS' THEN 1 ELSE 0 END;
  new_rank := CASE NEW."visibility"::text WHEN 'PUBLIC' THEN 2 WHEN 'FOLLOWERS' THEN 1 ELSE 0 END;

  IF new_rank < old_rank THEN
    UPDATE public."Post" p
       SET "sourceAccessRevokedAt" = COALESCE(p."sourceAccessRevokedAt", CURRENT_TIMESTAMP),
           "updatedAt" = CURRENT_TIMESTAMP
     WHERE p."sourceAccessRevokedAt" IS NULL
       AND (
         EXISTS (SELECT 1 FROM public."PostTodo" pt WHERE pt."postId" = p."id" AND pt."todoId" = NEW."id")
         OR EXISTS (
           SELECT 1
             FROM public."TodoListItem" li
            WHERE li."listId" = p."todoListId" AND li."todoId" = NEW."id"
         )
       );
  END IF;

  IF OLD."deletedAt" IS NULL AND NEW."deletedAt" IS NOT NULL THEN
    UPDATE public."Post" p
       SET "caption" = NULL,
           "snapshot" = NULL,
           "snapshotSearchText" = NULL,
           "snapshotCategories" = ARRAY[]::TEXT[],
           "snapshotErasedAt" = COALESCE(p."snapshotErasedAt", CURRENT_TIMESTAMP),
           "hiddenAt" = COALESCE(p."hiddenAt", CURRENT_TIMESTAMP),
           "updatedAt" = CURRENT_TIMESTAMP
     WHERE EXISTS (SELECT 1 FROM public."PostTodo" pt WHERE pt."postId" = p."id" AND pt."todoId" = NEW."id")
        OR EXISTS (
          SELECT 1
            FROM public."TodoListItem" li
           WHERE li."listId" = p."todoListId" AND li."todoId" = NEW."id"
        );
    DELETE FROM public."PostTag" pt
     WHERE EXISTS (
       SELECT 1 FROM public."Post" p
        WHERE p."id" = pt."postId" AND p."snapshotErasedAt" IS NOT NULL
     );
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "Todo_post_snapshot_policy"
AFTER UPDATE OF "visibility", "deletedAt" ON public."Todo"
FOR EACH ROW EXECUTE FUNCTION governance.revoke_todo_post_snapshots();

CREATE OR REPLACE FUNCTION governance.revoke_todo_list_post_snapshots()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
DECLARE
  old_rank INTEGER;
  new_rank INTEGER;
BEGIN
  old_rank := CASE OLD."visibility"::text WHEN 'PUBLIC' THEN 2 WHEN 'FOLLOWERS' THEN 1 ELSE 0 END;
  new_rank := CASE NEW."visibility"::text WHEN 'PUBLIC' THEN 2 WHEN 'FOLLOWERS' THEN 1 ELSE 0 END;
  IF new_rank < old_rank THEN
    UPDATE public."Post"
       SET "sourceAccessRevokedAt" = COALESCE("sourceAccessRevokedAt", CURRENT_TIMESTAMP),
           "updatedAt" = CURRENT_TIMESTAMP
     WHERE "todoListId" = NEW."id" AND "sourceAccessRevokedAt" IS NULL;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "TodoList_post_snapshot_policy"
AFTER UPDATE OF "visibility" ON public."TodoList"
FOR EACH ROW EXECUTE FUNCTION governance.revoke_todo_list_post_snapshots();

REVOKE ALL ON FUNCTION governance.revoke_todo_post_snapshots() FROM PUBLIC;
REVOKE ALL ON FUNCTION governance.revoke_todo_list_post_snapshots() FROM PUBLIC;
