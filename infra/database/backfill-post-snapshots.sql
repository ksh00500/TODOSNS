-- Staged legacy backfill. Do not run against production without the migration
-- runbook approval, backup/restore evidence, counts, and sampled verification.
-- Existing posts are represented from their state at backfill time because a
-- historical publish-time snapshot does not exist for legacy rows.

WITH todo_snapshots AS (
  SELECT
    p."id" AS "postId",
    jsonb_build_object(
      'version', 1,
      'kind', 'TODO',
      'capturedAt', p."createdAt",
      'todo', jsonb_build_object(
        'id', t."id",
        'title', t."title",
        'notes', t."notes",
        'category', t."category",
        'dueDate', t."dueDate",
        'completedAt', t."completedAt",
        'repeatRule', t."repeatRule",
        'seriesId', t."seriesId"
      )
    ) AS content,
    left(concat_ws(' ', p."caption", t."title", t."notes", t."category"), 2000) AS search_text,
    ARRAY[t."category"]::TEXT[] AS categories
  FROM public."Post" p
  JOIN public."PostTodo" pt ON pt."postId" = p."id"
  JOIN public."Todo" t ON t."id" = pt."todoId" AND t."deletedAt" IS NULL
  WHERE p."todoListId" IS NULL AND p."snapshot" IS NULL AND p."snapshotErasedAt" IS NULL
),
list_items AS (
  SELECT
    p."id" AS "postId",
    p."createdAt",
    p."caption",
    l."id" AS "listId",
    l."title",
    l."description",
    jsonb_agg(jsonb_build_object(
      'order', li."order",
      'todo', jsonb_build_object(
        'id', t."id",
        'title', t."title",
        'notes', t."notes",
        'category', t."category",
        'dueDate', t."dueDate",
        'completedAt', t."completedAt",
        'repeatRule', t."repeatRule",
        'seriesId', t."seriesId"
      )
    ) ORDER BY li."order") AS items,
    string_agg(concat_ws(' ', t."title", t."notes", t."category"), ' ' ORDER BY li."order") AS item_text,
    array_agg(DISTINCT t."category") AS categories
  FROM public."Post" p
  JOIN public."TodoList" l ON l."id" = p."todoListId"
  JOIN public."TodoListItem" li ON li."listId" = l."id"
  JOIN public."Todo" t ON t."id" = li."todoId" AND t."deletedAt" IS NULL
  WHERE p."snapshot" IS NULL AND p."snapshotErasedAt" IS NULL
  GROUP BY p."id", p."createdAt", p."caption", l."id", l."title", l."description"
),
snapshots AS (
  SELECT "postId", content, search_text, categories FROM todo_snapshots
  UNION ALL
  SELECT
    "postId",
    jsonb_build_object(
      'version', 1,
      'kind', 'TODO_LIST',
      'capturedAt', "createdAt",
      'list', jsonb_build_object('id', "listId", 'title', "title", 'description', "description", 'items', items)
    ),
    left(concat_ws(' ', "caption", "title", "description", item_text), 2000),
    categories
  FROM list_items
)
UPDATE public."Post" p
   SET "snapshot" = s.content,
       "snapshotSearchText" = s.search_text,
       "snapshotCategories" = s.categories,
       "updatedAt" = CURRENT_TIMESTAMP
  FROM snapshots s
 WHERE p."id" = s."postId"
   AND p."snapshot" IS NULL
   AND p."snapshotErasedAt" IS NULL;

-- Fail closed for legacy rows that could not be represented safely.
UPDATE public."Post"
   SET "sourceAccessRevokedAt" = COALESCE("sourceAccessRevokedAt", CURRENT_TIMESTAMP),
       "updatedAt" = CURRENT_TIMESTAMP
 WHERE "snapshot" IS NULL AND "snapshotErasedAt" IS NULL;
