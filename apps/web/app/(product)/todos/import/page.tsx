"use client";

import { FormEvent, Suspense, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarDays, CheckCircle2, Clock3, PlusCircle, Repeat2, UserRound, X } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { apiFetch } from "@/lib/api";
import { localDateKey } from "@/lib/date";
import type { FeedPost, TodoDto, TodoListDto } from "@/lib/types";
import { useSession } from "@/components/app-providers";
import { AuthGate, ErrorState, ListSkeleton } from "@/components/states";

const categories = ["건강", "운동", "공부", "독서", "마음", "커리어", "생활"];

export default function ImportTodoPage() {
  return <Suspense fallback={<main className="app-page"><ListSkeleton /></main>}><ImportTodoContent /></Suspense>;
}

function ImportTodoContent() {
  const params = useSearchParams();
  const router = useRouter();
  const { status } = useSession();
  const postId = params.get("postId");
  const post = useQuery({ queryKey: ["import-post", postId], queryFn: () => apiFetch<FeedPost>(`/feed/posts/${postId}`), enabled: status === "authenticated" && Boolean(postId), retry: false });

  if (status === "loading") return <main className="app-page"><ListSkeleton /></main>;
  if (status === "guest") return <main className="app-page"><AuthGate title="TODO를 가져오려면 로그인이 필요해요" /></main>;
  if (!postId) return <main className="app-page"><ErrorState message="가져올 실천이 선택되지 않았어요." onRetry={() => router.replace("/explore")} /></main>;
  if (post.isLoading || !post.data && !post.isError) return <main className="app-page"><ListSkeleton /></main>;
  if (post.isError || !post.data) return <main className="app-page"><ErrorState message="가져올 실천을 찾지 못했어요." onRetry={() => void post.refetch()} /></main>;
  return <ImportForm post={post.data} onClose={() => router.back()} />;
}

function ImportForm({ post, onClose }: { post: FeedPost; onClose: () => void }) {
  const router = useRouter();
  const client = useQueryClient();
  const sourceTodo = post.todos[0];
  const sourceList = post.todoList;
  const today = localDateKey();
  const [title, setTitle] = useState(sourceList?.title ?? sourceTodo?.title ?? "");
  const [day, setDay] = useState(today);
  const [time, setTime] = useState("07:00");
  const [category, setCategory] = useState(sourceTodo?.category ?? "생활");
  const sourceRepeatRule = sourceTodo?.repeatRule ?? "";
  const initialRepeatRule = sourceRepeatRule.includes("MO,TU,WE,TH,FR")
    ? "WEEKDAYS"
    : sourceRepeatRule.includes("DAILY")
      ? "DAILY"
      : sourceRepeatRule
        ? "WEEKLY"
        : "";
  const [repeatRule, setRepeatRule] = useState(initialRepeatRule);
  const [error, setError] = useState("");
  const save = useMutation({
    mutationFn: async () => {
      const dueDate = new Date(`${day}T${time}:00`).toISOString();
      if (sourceList) return apiFetch<TodoListDto>(`/todo-lists/${sourceList.id}/clone`, { method: "POST", body: JSON.stringify({ title: title.trim(), dueDate }) });
      if (!sourceTodo) throw new Error("가져올 TODO를 찾지 못했어요.");
      return apiFetch<TodoDto>(`/todos/${sourceTodo.id}/clone`, { method: "POST", body: JSON.stringify({ title: title.trim(), dueDate, category, repeatRule: repeatRule || undefined, keepRepeat: Boolean(repeatRule), visibility: "PRIVATE" }) });
    },
    onSuccess: async () => {
      await Promise.all([client.invalidateQueries({ queryKey: ["todos"] }), client.invalidateQueries({ queryKey: ["todo-lists"] })]);
      router.replace(`/todos?date=${day}&imported=1`);
    },
    onError: (cause) => setError(cause instanceof Error ? cause.message : "TODO를 가져오지 못했어요."),
  });
  const submit = (event: FormEvent) => { event.preventDefault(); setError(""); if (title.trim()) save.mutate(); };

  return <main className="import-page">
    <header className="import-header"><button type="button" onClick={onClose} aria-label="닫기"><X /></button><h1>할 일 가져오기</h1><span /></header>
    <form onSubmit={submit}>
      <section className="source-habit"><div className="source-avatar"><UserRound /></div><div><span><b>@{post.author.handle}</b>님의 실천</span><h2>{sourceList?.title ?? sourceTodo?.title}</h2>{post.caption && <p>“{post.caption}”</p>}</div></section>
      {sourceList && <section className="import-list-preview"><span>함께 저장되는 TODO {sourceList.items.length}개</span>{sourceList.items.map((item) => <p key={item.todo.id}><CheckCircle2 />{item.todo.title}</p>)}</section>}
      <label className="import-field"><span>어떤 이름으로 저장할까요?</span><div><input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={120} required /><button type="button" onClick={() => setTitle("")} aria-label="제목 지우기"><X /></button></div></label>
      <fieldset className="import-section"><legend>언제 할까요?</legend><div className="import-schedule"><label><span>시작일</span><b>{day === today ? "오늘" : day}</b><input type="date" value={day} onChange={(event) => setDay(event.target.value)} aria-label="시작일" /><CalendarDays /></label><label><span>시간</span><b>{new Date(`${day}T${time}:00`).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })}</b><input type="time" value={time} onChange={(event) => setTime(event.target.value)} aria-label="시간" /><Clock3 /></label></div></fieldset>
      {!sourceList && <><fieldset className="import-section"><legend>카테고리 <PlusCircle /></legend><div className="import-chips">{categories.map((item) => <button type="button" key={item} className={category === item ? "active" : ""} onClick={() => setCategory(item)}>{item}</button>)}</div></fieldset><fieldset className="import-section"><legend><Repeat2 /> 반복 설정</legend><div className="repeat-segments"><button type="button" className={repeatRule === "DAILY" ? "active" : ""} onClick={() => setRepeatRule("DAILY")}>매일</button><button type="button" className={repeatRule === "WEEKDAYS" ? "active" : ""} onClick={() => setRepeatRule("WEEKDAYS")}>평일</button><button type="button" className={repeatRule === "WEEKLY" ? "active" : ""} onClick={() => setRepeatRule("WEEKLY")}>매주</button><button type="button" className={!repeatRule ? "active" : ""} onClick={() => setRepeatRule("")}>반복 안 함</button></div></fieldset></>}
      {error && <p className="form-error">{error}</p>}
      <div className="import-submit"><button className="button full" disabled={save.isPending}><CheckCircle2 />{save.isPending ? "저장 중…" : sourceList ? "내 루틴에 저장" : "내 TODO에 저장"}</button></div>
    </form>
  </main>;
}
