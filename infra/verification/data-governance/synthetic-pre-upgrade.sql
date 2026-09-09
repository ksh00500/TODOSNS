\set ON_ERROR_STOP on

INSERT INTO public."User"
  ("id", "email", "nickname", "handle", "birthDate", "createdAt", "updatedAt")
VALUES
  ('synthetic-user-a', 'a@synthetic.invalid', '합성 사용자 A', 'synthetic.a', '1995-01-01T00:00:00Z', '2026-09-01T00:00:00Z', '2026-09-01T00:00:00Z'),
  ('synthetic-user-b', 'b@synthetic.invalid', '합성 사용자 B', 'synthetic.b', '1985-01-01T00:00:00Z', '2026-09-01T00:00:00Z', '2026-09-01T00:00:00Z');

INSERT INTO public."Todo"
  ("id", "userId", "title", "notes", "category", "visibility", "dueDate", "completedAt", "createdAt", "updatedAt")
VALUES
  ('synthetic-todo-direct', 'synthetic-user-a', '합성 공개 TODO', '삭제 시 스냅샷 파기 대상', '생활', 'PUBLIC', '2026-09-10T01:00:00Z', '2026-09-08T01:00:00Z', '2026-09-01T00:00:00Z', '2026-09-01T00:00:00Z'),
  ('synthetic-todo-list', 'synthetic-user-a', '합성 목록 TODO', NULL, '운동', 'PUBLIC', '2026-09-11T01:00:00Z', NULL, '2026-09-01T00:00:00Z', '2026-09-01T00:00:00Z');

INSERT INTO public."TodoList"
  ("id", "userId", "title", "description", "visibility", "createdAt", "updatedAt")
VALUES
  ('synthetic-list', 'synthetic-user-a', '합성 루틴', '공개 범위 축소 검증', 'PUBLIC', '2026-09-01T00:00:00Z', '2026-09-01T00:00:00Z');

INSERT INTO public."TodoListItem" ("listId", "todoId", "order")
VALUES ('synthetic-list', 'synthetic-todo-list', 0);

INSERT INTO public."Post"
  ("id", "authorId", "caption", "todoListId", "visibility", "createdAt", "updatedAt")
VALUES
  ('synthetic-post-direct', 'synthetic-user-a', '직접 게시 합성 캡션', NULL, 'PUBLIC', '2026-09-08T01:00:00Z', '2026-09-08T01:00:00Z'),
  ('synthetic-post-list', 'synthetic-user-a', '목록 게시 합성 캡션', 'synthetic-list', 'PUBLIC', '2026-09-08T02:00:00Z', '2026-09-08T02:00:00Z');

INSERT INTO public."PostTodo" ("postId", "todoId", "order")
VALUES ('synthetic-post-direct', 'synthetic-todo-direct', 0);

INSERT INTO public."Tag" ("id", "name", "createdAt")
VALUES ('synthetic-tag', '합성태그', '2026-09-08T01:00:00Z');

INSERT INTO public."PostTag" ("postId", "tagId")
VALUES ('synthetic-post-direct', 'synthetic-tag');
