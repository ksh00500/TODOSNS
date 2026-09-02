"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Ellipsis, ListPlus, Send } from "lucide-react";
import { apiFetch } from "@/lib/api";
import type { TodoDto, TodoListDto, Visibility } from "@/lib/types";
import { useSession } from "@/components/app-providers";
import { AuthGate, EmptyState, ErrorState, ListSkeleton } from "@/components/states";
import { PublishSheet } from "@/components/publish-sheet";
import { RoutineComposer } from "@/components/routine-composer";
import { TodoSectionNav } from "@/components/todo-section-nav";

export default function TodoRoutinesPage() {
  const { status } = useSession();
  const queryClient = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<TodoListDto | null>(null);
  const [publishing, setPublishing] = useState<TodoListDto | null>(null);
  const [notice, setNotice] = useState("");
  const lists = useQuery({ queryKey: ["todo-lists"], queryFn: () => apiFetch<TodoListDto[]>("/todo-lists"), enabled: status === "authenticated" });
  const todos = useQuery({ queryKey: ["todos", "routine-library"], queryFn: () => { const from = new Date(); const to = new Date(); from.setDate(from.getDate() - 60); to.setDate(to.getDate() + 60); return apiFetch<TodoDto[]>(`/todos?from=${from.toISOString()}&to=${to.toISOString()}`); }, enabled: status === "authenticated" });
  const publish = useMutation({ mutationFn: (data: { caption: string; visibility: Visibility; hashtags: string[]; mediaId?: string }) => apiFetch("/feed/posts", { method: "POST", body: JSON.stringify({ todoListId: publishing?.id, ...data }) }), onSuccess: () => { setPublishing(null); setNotice("루틴을 게시했어요."); void queryClient.invalidateQueries({ queryKey: ["feed"] }); } });
  const refresh = (message: string) => { setCreating(false); setEditing(null); setNotice(message); void queryClient.invalidateQueries({ queryKey: ["todo-lists"] }); };
  if (status === "loading") return <main className="app-page"><ListSkeleton /></main>;
  if (status === "guest") return <main className="app-page"><AuthGate title="내 루틴은 로그인 후 관리할 수 있어요" /></main>;
  const allTodos = [...(todos.data ?? []), ...(lists.data ?? []).flatMap((list) => list.items.map((item) => item.todo))].filter((todo, index, rows) => rows.findIndex((item) => item.id === todo.id) === index);
  return <main className="app-page todo-management-page"><header className="page-intro compact"><div><span>자주 함께하는 실천 묶음</span><h1>루틴</h1></div><button className="round-button primary" onClick={() => setCreating(true)} aria-label="새 루틴 만들기"><ListPlus /></button></header><TodoSectionNav />{notice && <button className="notice" onClick={() => setNotice("")}>{notice}</button>}{lists.isLoading ? <ListSkeleton count={3} /> : lists.isError ? <ErrorState onRetry={() => void lists.refetch()} /> : !lists.data?.length ? <EmptyState title="아직 만든 루틴이 없어요" body="같이 실천할 TODO를 묶으면 일정 화면이 한결 단정해져요." action={<button className="button" onClick={() => setCreating(true)}>첫 루틴 만들기</button>} /> : <div className="routine-library-list">{lists.data.map((list) => { const completed = list.items.filter((item) => item.todo.completedAt).length; return <article className="routine-library-card" key={list.id}><div><span>{list.items.length}개 TODO · {completed}개 완료</span><h2>{list.title}</h2><p>{list.description || list.items.slice(0, 2).map((item) => item.todo.title).join(" · ")}</p></div><div className="routine-preview">{list.items.slice(0, 3).map((item) => <span key={item.todo.id}>{item.todo.title}</span>)}</div><footer><button onClick={() => setEditing(list)}><Ellipsis />관리</button><button className="routine-publish" onClick={() => setPublishing(list)}><Send />게시하기</button></footer></article>; })}</div>}{creating && <RoutineComposer todos={allTodos} lists={lists.data ?? []} onClose={() => setCreating(false)} onSaved={() => refresh("새 루틴을 만들었어요.")} />}{editing && <RoutineComposer todos={allTodos} lists={lists.data ?? []} list={editing} onClose={() => setEditing(null)} onSaved={() => refresh("루틴을 정리했어요.")} />}{publishing && <PublishSheet list={publishing} busy={publish.isPending} onClose={() => setPublishing(null)} onPublish={(data) => publish.mutate(data)} />}</main>;
}
