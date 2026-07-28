"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Clock3, Plus, Repeat2, Share2, Sparkles } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { dayRange, koreanDate, localDateKey } from "@/lib/date";
import type { TodoDto } from "@/lib/types";
import { useSession } from "@/components/app-providers";
import { AuthGate, EmptyState, ErrorState, ListSkeleton } from "@/components/states";
import { TodoComposer, type TodoDraft } from "@/components/todo-composer";
import { ShareSheet } from "@/components/share-sheet";
import { CloudMark } from "@/components/cloud-mark";

export default function TodayPage() {
  const { status, user } = useSession(); const queryClient = useQueryClient(); const date = localDateKey(); const range = dayRange(date);
  const [composer, setComposer] = useState(false); const [shareTodo, setShareTodo] = useState<TodoDto | null>(null); const [notice, setNotice] = useState("");
  const query = useQuery({ queryKey: ["todos", date], queryFn: () => apiFetch<TodoDto[]>(`/todos?from=${range.from}&to=${range.to}`), enabled: status === "authenticated" });
  const create = useMutation({ mutationFn: (draft: TodoDraft) => apiFetch<TodoDto>("/todos", { method: "POST", body: JSON.stringify(draft) }), onSuccess: () => { void queryClient.invalidateQueries({ queryKey: ["todos"] }); setComposer(false); setNotice("새 TODO를 추가했어요."); } });
  const complete = useMutation({ mutationFn: (todo: TodoDto) => apiFetch(`/todos/${todo.id}/complete`, { method: "POST", body: JSON.stringify({ share: false }) }), onMutate: async (todo) => { await queryClient.cancelQueries({ queryKey: ["todos", date] }); const previous = queryClient.getQueryData<TodoDto[]>(["todos", date]); queryClient.setQueryData<TodoDto[]>(["todos", date], (items = []) => items.map((item) => item.id === todo.id ? { ...item, completedAt: new Date().toISOString() } : item)); return { previous }; }, onError: (_error, _todo, context) => { queryClient.setQueryData(["todos", date], context?.previous); setNotice("완료를 저장하지 못했어요."); }, onSuccess: (_result, todo) => { setShareTodo({ ...todo, completedAt: new Date().toISOString() }); setNotice("해냈어요! 이 실천을 공유할 수 있어요."); } });
  const share = useMutation({ mutationFn: (data: { caption: string; visibility: string; mediaKey?: string }) => apiFetch(`/todos/${shareTodo?.id}/complete`, { method: "POST", body: JSON.stringify({ share: true, ...data }) }), onSuccess: () => { setShareTodo(null); setNotice("오늘의 실천을 공유했어요."); void queryClient.invalidateQueries({ queryKey: ["feed"] }); } });
  if (status === "loading") return <main className="app-page"><ListSkeleton /></main>;
  if (status === "guest") return <main className="app-page"><AuthGate title="오늘의 TODO는 로그인 후 시작할 수 있어요" /></main>;
  const todos = query.data ?? []; const completed = todos.filter((todo) => todo.completedAt).length; const progress = todos.length ? Math.round(completed / todos.length * 100) : 0; const nextTodoId = todos.find((todo) => !todo.completedAt)?.id;
  return <main className="app-page today-page"><header className="page-intro"><div><span>{koreanDate(date)}</span><h1>안녕하세요, {user?.nickname}님!</h1><p>오늘의 작은 실천을 이어가 볼까요?</p></div></header>
    <section className="today-progress" aria-label={`오늘 진행률 ${progress}%`}><div className="progress-orbit" style={{ "--progress": `${progress * 3.6}deg` } as React.CSSProperties}><i><CloudMark compact /><b>{progress}%</b><span>오늘의 여정</span></i></div><div className="progress-summary"><strong>{completed}<small> / {todos.length}</small></strong><p>{todos.length ? `${Math.max(todos.length - completed, 0)}개의 작은 실천이 남았어요.` : "첫 TODO를 만들고 오늘을 시작해보세요."}</p></div></section>
    <blockquote className="gentle-note">“작은 실천이 쌓여 나만의 리듬이 돼요.”</blockquote>
    {notice && <button className="notice" onClick={() => setNotice("")}><Sparkles />{notice}</button>}
    <div className="section-heading"><div><h2>오늘 할 일</h2><span>{completed}/{todos.length} 완료</span></div><button className="soft-button" onClick={() => setComposer(true)}><Plus />추가</button></div>
    {query.isLoading ? <ListSkeleton count={4} /> : query.isError ? <ErrorState onRetry={() => void query.refetch()} /> : todos.length === 0 ? <EmptyState title="오늘의 여백이 열려 있어요" body="지금 할 수 있는 작은 일 하나를 적어보세요." action={<button className="button" onClick={() => setComposer(true)}><Plus /> 첫 TODO 만들기</button>} /> : <section className="todo-stack">{todos.map((todo) => <article className={`todo-item ${todo.completedAt ? "completed" : todo.id === nextTodoId ? "active" : "upcoming"}`} key={todo.id}><button className="todo-check" disabled={Boolean(todo.completedAt) || complete.isPending} onClick={() => complete.mutate(todo)} aria-label={`${todo.title} 완료`}>{todo.completedAt && <Check />}</button><div><span><b>{todo.category}</b>{todo.repeatRule && <><Repeat2 /> 반복</>}</span><h3>{todo.title}</h3><small><Clock3 /> {new Date(todo.dueDate).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })}</small></div>{todo.completedAt ? <button className="share-link" onClick={() => setShareTodo(todo)}><Share2 />공유</button> : todo.id === nextTodoId ? <span className="current-label">진행 중</span> : null}</article>)}</section>}
    <button className="floating-add" onClick={() => setComposer(true)} aria-label="TODO 추가"><Plus /></button>
    {composer && <TodoComposer date={date} busy={create.isPending} onClose={() => setComposer(false)} onSave={(draft) => create.mutate(draft)} />}
    {shareTodo && <ShareSheet todo={shareTodo} busy={share.isPending} onClose={() => setShareTodo(null)} onShare={(data) => share.mutate(data)} />}
  </main>;
}
