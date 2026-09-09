\set ON_ERROR_STOP on

DO $$
DECLARE
  identity_count INTEGER;
  profile_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO identity_count FROM identity."AccountIdentity";
  SELECT COUNT(*) INTO profile_count FROM service."ServiceProfile";
  IF identity_count <> 2 OR profile_count <> 2 THEN
    RAISE EXCEPTION 'shadow backfill count mismatch: identity %, profile %', identity_count, profile_count;
  END IF;
  IF EXISTS (
    SELECT 1
      FROM public."User" u
      LEFT JOIN identity."AccountIdentity" i ON i."userId" = u."id"
      LEFT JOIN service."ServiceProfile" p ON p."userId" = u."id"
     WHERE i."userId" IS NULL OR p."userId" IS NULL
        OR i."email" IS DISTINCT FROM u."email"
        OR i."passwordHash" IS DISTINCT FROM u."passwordHash"
        OR i."googleId" IS DISTINCT FROM u."googleId"
        OR i."birthDate" IS DISTINCT FROM u."birthDate"
        OR p."nickname" IS DISTINCT FROM u."nickname"
        OR p."handle" IS DISTINCT FROM u."handle"
        OR p."bio" IS DISTINCT FROM u."bio"
        OR p."timezone" IS DISTINCT FROM u."timezone"
  ) THEN
    RAISE EXCEPTION 'shadow backfill content mismatch';
  END IF;
  IF EXISTS (SELECT 1 FROM governance."ProcessingPurpose" WHERE "collectionEnabled") THEN
    RAISE EXCEPTION 'analytics collection unexpectedly enabled';
  END IF;
  IF EXISTS (SELECT 1 FROM analytics_release."DatasetRelease" WHERE "status" = 'RELEASED') THEN
    RAISE EXCEPTION 'analytics release unexpectedly present';
  END IF;
  IF (SELECT COUNT(*) FROM public."Post" WHERE "snapshot" IS NOT NULL) <> 2 THEN
    RAISE EXCEPTION 'post snapshot backfill count mismatch';
  END IF;
END $$;

UPDATE public."User"
   SET "email" = 'a-updated@synthetic.invalid', "nickname" = '합성 사용자 A 수정', "updatedAt" = CURRENT_TIMESTAMP
 WHERE "id" = 'synthetic-user-a';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM identity."AccountIdentity" i
    JOIN service."ServiceProfile" p ON p."userId" = i."userId"
    WHERE i."userId" = 'synthetic-user-a'
      AND i."email" = 'a-updated@synthetic.invalid'
      AND p."nickname" = '합성 사용자 A 수정'
  ) THEN
    RAISE EXCEPTION 'shadow update trigger mismatch';
  END IF;
END $$;

INSERT INTO public."User"
  ("id", "email", "nickname", "handle", "birthDate", "createdAt", "updatedAt")
VALUES
  ('synthetic-user-trigger', 'trigger@synthetic.invalid', '합성 트리거', 'synthetic.trigger', '2000-01-01T00:00:00Z', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM identity."AccountIdentity" WHERE "userId" = 'synthetic-user-trigger')
     OR NOT EXISTS (SELECT 1 FROM service."ServiceProfile" WHERE "userId" = 'synthetic-user-trigger') THEN
    RAISE EXCEPTION 'shadow insert trigger mismatch';
  END IF;
END $$;

DELETE FROM public."User" WHERE "id" = 'synthetic-user-trigger';

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM identity."AccountIdentity" WHERE "userId" = 'synthetic-user-trigger')
     OR EXISTS (SELECT 1 FROM service."ServiceProfile" WHERE "userId" = 'synthetic-user-trigger') THEN
    RAISE EXCEPTION 'shadow delete cascade mismatch';
  END IF;
END $$;

UPDATE public."TodoList" SET "visibility" = 'PRIVATE', "updatedAt" = CURRENT_TIMESTAMP
 WHERE "id" = 'synthetic-list';

DO $$
BEGIN
  IF (SELECT "sourceAccessRevokedAt" FROM public."Post" WHERE "id" = 'synthetic-post-list') IS NULL THEN
    RAISE EXCEPTION 'todo-list privacy trigger did not revoke snapshot access';
  END IF;
END $$;

UPDATE public."Todo" SET "deletedAt" = CURRENT_TIMESTAMP, "updatedAt" = CURRENT_TIMESTAMP
 WHERE "id" = 'synthetic-todo-direct';

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public."Post"
     WHERE "id" = 'synthetic-post-direct'
       AND ("snapshot" IS NOT NULL OR "snapshotSearchText" IS NOT NULL OR "caption" IS NOT NULL
         OR "snapshotErasedAt" IS NULL OR "hiddenAt" IS NULL)
  ) THEN
    RAISE EXCEPTION 'todo deletion trigger did not scrub and hide snapshot';
  END IF;
  IF EXISTS (SELECT 1 FROM public."PostTag" WHERE "postId" = 'synthetic-post-direct') THEN
    RAISE EXCEPTION 'todo deletion trigger did not remove post tags';
  END IF;
END $$;
