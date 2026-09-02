"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Clock3, Plus, Repeat2, Send, Sparkles, X } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { dayRange, koreanDate, localDateKey } from "@/lib/date";
import type { TodoDto, TodoListDto } from "@/lib/types";
import { useSession } from "@/components/app-providers";
import { AuthGate, EmptyState, ErrorState, ListSkeleton } from "@/components/states";
import { TodoComposer, type TodoDraft } from "@/components/todo-composer";
import { PublishSheet } from "@/components/publish-sheet";
import { CloudMark } from "@/components/cloud-mark";
import { TodoGroupList } from "@/components/todo-group-list";

function todoTime(todo: TodoDto) {
  return new Date(todo.dueDate).toLocaleTimeString("ko-KR", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function TodayPage() {
  const { status, user } = useSession();
  const queryClient = useQueryClient();
  const date = localDateKey();
  const range = dayRange(date);
  const [composer, setComposer] = useState(false);
  const [editing, setEditing] = useState<TodoDto | null>(null);
  const [publishTodo, setPublishTodo] = useState<TodoDto | null>(null);
  const [notice, setNotice] = useState("");
  const [deletedId, setDeletedId] = useState<string | null>(null);

  const query = useQuery({
    queryKey: ["todos", date],
    queryFn: () => apiFetch<TodoDto[]>(`/todos?from=${range.from}&to=${range.to}`),
    enabled: status === "authenticated",
  });
  const lists = useQuery({
    queryKey: ["todo-lists"],
    queryFn: () => apiFetch<TodoListDto[]>("/todo-lists"),
    enabled: status === "authenticated",
  });

  const create = useMutation({
    mutationFn: (draft: TodoDraft) =>
      apiFetch<TodoDto>("/todos", { method: "POST", body: JSON.stringify(draft) }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["todos"] });
      void queryClient.invalidateQueries({ queryKey: ["todo-lists"] });
      setComposer(false);
      setNotice("새 TODO를 오늘에 담았어요.");
    },
    onError: () => setNotice("TODO를 추가하지 못했어요. 잠시 후 다시 시도해주세요."),
  });

  const update = useMutation({
    mutationFn: (draft: TodoDraft) => {
      if (!editing) throw new Error("TODO를 찾지 못했어요.");
      return apiFetch<TodoDto>(`/todos/${editing.id}`, { method: "PATCH", body: JSON.stringify(draft) });
    },
    onSuccess: () => {
      setEditing(null);
      setNotice("변경사항을 저장했어요.");
      void queryClient.invalidateQueries({ queryKey: ["todos"] });
      void queryClient.invalidateQueries({ queryKey: ["todo-lists"] });
    },
    onError: () => setNotice("변경사항을 저장하지 못했어요."),
  });

  const remove = useMutation({
    mutationFn: () => {
      if (!editing) throw new Error("TODO를 찾지 못했어요.");
      return apiFetch(`/todos/${editing.id}`, { method: "DELETE" }).then(() => editing.id);
    },
    onSuccess: (id) => {
      setDeletedId(id);
      setEditing(null);
      setNotice("TODO를 삭제했어요.");
      void queryClient.invalidateQueries({ queryKey: ["todos"] });
    },
    onError: () => setNotice("TODO를 삭제하지 못했어요."),
  });

  const restore = useMutation({
    mutationFn: (id: string) => apiFetch(`/todos/${id}/restore`, { method: "POST" }),
    onSuccess: () => {
      setDeletedId(null);
      setNotice("삭제한 TODO를 복구했어요.");
      void queryClient.invalidateQueries({ queryKey: ["todos"] });
    },
    onError: () => setNotice("삭제한 TODO를 복구하지 못했어요."),
  });

  const endSeries = useMutation({
    mutationFn: () => {
      if (!editing) throw new Error("TODO를 찾지 못했어요.");
      return apiFetch(`/todos/${editing.id}/series`, { method: "DELETE" });
    },
    onSuccess: () => {
      setEditing(null);
      setNotice("이 날짜 이후의 반복을 종료했어요.");
      void queryClient.invalidateQueries({ queryKey: ["todos"] });
    },
    onError: () => setNotice("반복 일정을 종료하지 못했어요."),
  });

  const complete = useMutation({
    mutationFn: (todo: TodoDto) =>
      apiFetch(`/todos/${todo.id}/complete`, {
        method: "POST",
        body: JSON.stringify({ share: false }),
      }),
    onMutate: async (todo) => {
      await queryClient.cancelQueries({ queryKey: ["todos", date] });
      const previous = queryClient.getQueryData<TodoDto[]>(["todos", date]);
      queryClient.setQueryData<TodoDto[]>(["todos", date], (items = []) =>
        items.map((item) =>
          item.id === todo.id ? { ...item, completedAt: new Date().toISOString() } : item,
        ),
      );
      return { previous };
    },
    onError: (_error, _todo, context) => {
      queryClient.setQueryData(["todos", date], context?.previous);
      setNotice("완료를 저장하지 못했어요. 잠시 후 다시 눌러주세요.");
    },
    onSuccess: (_result, todo) => {
      setPublishTodo({ ...todo, completedAt: new Date().toISOString() });
      setNotice("해냈어요! 완료 기록을 저장했어요.");
    },
    onSettled: () => void queryClient.invalidateQueries({ queryKey: ["todos"] }),
  });

  const uncomplete = useMutation({
    mutationFn: (todo: TodoDto) =>
      apiFetch(`/todos/${todo.id}/uncomplete`, { method: "POST" }),
    onMutate: async (todo) => {
      await queryClient.cancelQueries({ queryKey: ["todos", date] });
      const previous = queryClient.getQueryData<TodoDto[]>(["todos", date]);
      queryClient.setQueryData<TodoDto[]>(["todos", date], (items = []) =>
        items.map((item) => (item.id === todo.id ? { ...item, completedAt: null } : item)),
      );
      return { previous };
    },
    onError: (_error, _todo, context) => {
      queryClient.setQueryData(["todos", date], context?.previous);
      setNotice("완료 취소를 저장하지 못했어요.");
    },
    onSuccess: () => {
      setPublishTodo(null);
      setNotice("완료를 취소했어요.");
    },
    onSettled: () => void queryClient.invalidateQueries({ queryKey: ["todos"] }),
  });

  const publish = useMutation({
    mutationFn: (data: { caption: string; visibility: string; hashtags: string[]; mediaId?: string }) =>
      apiFetch(`/todos/${publishTodo?.id}/complete`, {
        method: "POST",
        body: JSON.stringify({ share: true, ...data }),
      }),
    onSuccess: () => {
      setPublishTodo(null);
      setNotice("오늘의 실천을 게시했어요.");
      void queryClient.invalidateQueries({ queryKey: ["feed"] });
    },
    onError: () => setNotice("실천을 게시하지 못했어요. 다시 시도해주세요."),
  });

  if (status === "loading") return <main className="app-page"><ListSkeleton /></main>;
  if (status === "guest") {
    return <main className="app-page"><AuthGate title="오늘의 TODO는 로그인 후 시작할 수 있어요" /></main>;
  }

  const todos = query.data ?? [];
  const completed = todos.filter((todo) => todo.completedAt).length;
  const remaining = Math.max(todos.length - completed, 0);
  const progress = todos.length ? Math.round((completed / todos.length) * 100) : 0;
  const nextTodo = todos.find((todo) => !todo.completedAt);
  const otherTodoCount = todos.length - (nextTodo ? 1 : 0);
  const mutationBusy = complete.isPending || uncomplete.isPending;

  return (
    <main className="app-page today-page">
      <header className="today-heading">
        <span>{koreanDate(date)}</span>
        <h1>{user?.nickname ?? "뭉실"}님의 오늘</h1>
        <p>{remaining ? `지금 할 수 있는 ${remaining}개의 작은 실천이 있어요.` : "오늘도 내 리듬만큼 잘 해냈어요."}</p>
      </header>

      <section className="today-overview" aria-label={`오늘 진행률 ${progress}%`}>
        <div className="today-overview-copy">
          <span>오늘의 흐름</span>
          <strong>{completed}<small> / {todos.length} 완료</small></strong>
          <p>{todos.length ? (remaining ? "하나씩 가볍게 이어가요." : "모든 실천을 마쳤어요.") : "첫 TODO를 담아 오늘을 시작해보세요."}</p>
          <div className="linear-progress" aria-hidden="true"><i style={{ width: `${progress}%` }} /></div>
        </div>
        <div className="compact-progress" style={{ "--progress": `${progress * 3.6}deg` } as React.CSSProperties}>
          <i><CloudMark compact /><b>{progress}%</b></i>
        </div>
      </section>

      {notice && (
        <div className="status-notice" role="status" aria-live="polite">
          <Sparkles />
          <span>{notice}</span>
          {deletedId && notice === "TODO를 삭제했어요." && <button className="status-notice-action" onClick={() => restore.mutate(deletedId)} disabled={restore.isPending}>{restore.isPending ? "복구 중…" : "되돌리기"}</button>}
          <button onClick={() => setNotice("")} aria-label="알림 닫기"><X /></button>
        </div>
      )}

      {query.isLoading ? (
        <ListSkeleton count={4} />
      ) : query.isError ? (
        <ErrorState onRetry={() => void query.refetch()} />
      ) : todos.length === 0 ? (
        <EmptyState
          title="오늘은 아직 여백이에요"
          body="지금 할 수 있는 작은 일 하나를 적어보세요."
          action={<button className="button" onClick={() => setComposer(true)}><Plus /> 첫 TODO 만들기</button>}
        />
      ) : (
        <>
          {nextTodo ? (
            <section className="today-focus" aria-labelledby="today-focus-title">
              <button className="today-focus-content" onClick={() => setEditing(nextTodo)} aria-label={`${nextTodo.title} 상세 및 편집`}>
                <header>
                  <span><Sparkles /> 지금 할 일</span>
                  <small><Clock3 /> {todoTime(nextTodo)}</small>
                </header>
                <div>
                  <span className="category-pill">{nextTodo.category}</span>
                  {nextTodo.repeatRule && <span className="repeat-label"><Repeat2 /> 반복</span>}
                </div>
                <h2 id="today-focus-title">{nextTodo.title}</h2>
                {nextTodo.notes && <p>{nextTodo.notes}</p>}
              </button>
              <button className="button full focus-complete" disabled={mutationBusy} onClick={() => complete.mutate(nextTodo)}>
                <Check /> {complete.isPending ? "완료 저장 중…" : "이 실천 완료하기"}
              </button>
            </section>
          ) : (
            <section className="today-celebration" role="status">
              <CloudMark />
              <div><span>오늘의 TODO 완료</span><h2>모든 실천을 마쳤어요!</h2><p>완벽해서가 아니라, 오늘도 이어간 마음이 멋져요.</p></div>
            </section>
          )}

          <div className="section-heading today-list-heading">
            <div><h2>오늘의 목록</h2><span>{completed}/{todos.length} 완료</span></div>
            <button className="soft-button" onClick={() => setComposer(true)}><Plus /> TODO 추가</button>
          </div>
          {otherTodoCount > 0 ? (
              <TodoGroupList todos={todos} lists={lists.data ?? []} hiddenTodoIds={nextTodo ? new Set([nextTodo.id]) : undefined} renderTodo={(todo) => (
                  <article className={`todo-item ${todo.completedAt ? "completed" : "upcoming"}`} key={todo.id}>
                    <button
                      className="todo-check"
                      disabled={mutationBusy}
                      onClick={() => (todo.completedAt ? uncomplete.mutate(todo) : complete.mutate(todo))}
                      aria-label={todo.completedAt ? `${todo.title} 완료 취소` : `${todo.title} 완료`}
                    >
                      {todo.completedAt && <Check />}
                    </button>
                    <button className="todo-details-trigger" onClick={() => setEditing(todo)} aria-label={`${todo.title} 상세 및 편집`}>
                      <span><b>{todo.category}</b>{todo.repeatRule && <><Repeat2 /> 반복</>}</span>
                      <h3>{todo.title}</h3>
                      <small><Clock3 /> {todoTime(todo)}</small>
                    </button>
                    {todo.completedAt ? (
                      <button className="share-link" onClick={() => setPublishTodo(todo)}><Send /> 게시</button>
                    ) : (
                      <span className="upcoming-label">예정</span>
                    )}
                  </article>
                )} />
          ) : <div className="inline-empty">지금 할 일 다음에 이어질 TODO가 없어요.</div>}
        </>
      )}

      {composer && <TodoComposer date={date} lists={lists.data ?? []} busy={create.isPending} onClose={() => setComposer(false)} onSave={(draft) => create.mutate(draft)} />}
      {editing && <TodoComposer date={date} todo={editing} lists={lists.data ?? []} busy={update.isPending || remove.isPending || endSeries.isPending} onClose={() => setEditing(null)} onSave={(draft) => update.mutate(draft)} onDelete={() => remove.mutate()} onEndSeries={() => endSeries.mutate()} />}
      {publishTodo && <PublishSheet todo={publishTodo} busy={publish.isPending} onClose={() => setPublishTodo(null)} onPublish={(data) => publish.mutate(data)} />}
    </main>
  );
}
