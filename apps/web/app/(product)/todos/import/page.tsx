"use client";

import { FormEvent, Suspense, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, ChevronDown, ChevronRight, Layers3, Repeat2, Settings2, UserRound, X } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import type { CloneTodoListRepeatMode } from "@mungsil/contracts";
import { apiFetch } from "@/lib/api";
import { localDateKey } from "@/lib/date";
import type { FeedPost, TodoDto, TodoListDto } from "@/lib/types";
import { useSession } from "@/components/app-providers";
import { AuthGate, ErrorState, ListSkeleton } from "@/components/states";
import { CategoryPicker, RepeatPicker, TodoSchedulePicker } from "@/components/todo-form-controls";
import { REPEAT_OPTIONS, toRepeatPreset, type RepeatPreset } from "@/lib/todo-options";

interface ListItemDraft {
  sourceTodoId: string;
  title: string;
  day: string;
  time: string;
  category: string;
  repeatRule: RepeatPreset;
}

function listItemDrafts(list: TodoListDto | null | undefined, day: string, time: string): ListItemDraft[] {
  if (!list?.items.length) return [];
  const targetBase = new Date(`${day}T${time}:00`).getTime();
  const sourceBase = Math.min(...list.items.map((item) => new Date(item.todo.dueDate).getTime()));
  return list.items.map((item) => {
    const shifted = new Date(targetBase + new Date(item.todo.dueDate).getTime() - sourceBase);
    return {
      sourceTodoId: item.todo.id,
      title: item.todo.title,
      day: localDateKey(shifted),
      time: `${String(shifted.getHours()).padStart(2, "0")}:${String(shifted.getMinutes()).padStart(2, "0")}`,
      category: item.todo.category,
      repeatRule: toRepeatPreset(item.todo.repeatRule),
    };
  });
}

function repeatLabel(rule?: string | null) {
  const preset = toRepeatPreset(rule);
  return REPEAT_OPTIONS.find((option) => option.value === preset)?.label ?? "반복 안 함";
}

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
  const [repeatRule, setRepeatRule] = useState<RepeatPreset>(toRepeatPreset(sourceTodo?.repeatRule));
  const [listRepeatMode, setListRepeatMode] = useState<CloneTodoListRepeatMode>("KEEP");
  const [itemDrafts, setItemDrafts] = useState<ListItemDraft[]>(() => listItemDrafts(sourceList, today, "07:00"));
  const [expandedItem, setExpandedItem] = useState<string | null>(null);
  const [error, setError] = useState("");
  const chooseListRepeatMode = (mode: CloneTodoListRepeatMode) => {
    setListRepeatMode(mode);
    if (mode === "CUSTOM") {
      setItemDrafts(listItemDrafts(sourceList, day, time));
      setExpandedItem((current) => current ?? sourceList?.items[0]?.todo.id ?? null);
    }
  };
  const updateItem = (sourceTodoId: string, changes: Partial<ListItemDraft>) => setItemDrafts((current) => current.map((item) => item.sourceTodoId === sourceTodoId ? { ...item, ...changes } : item));
  const save = useMutation({
    mutationFn: async () => {
      const dueDate = new Date(`${day}T${time}:00`).toISOString();
      if (sourceList) return apiFetch<TodoListDto>(`/todo-lists/${sourceList.id}/clone`, { method: "POST", body: JSON.stringify({
        title: title.trim(),
        dueDate,
        repeatMode: listRepeatMode,
        items: listRepeatMode === "CUSTOM" ? itemDrafts.map((item) => ({ sourceTodoId: item.sourceTodoId, title: item.title.trim(), dueDate: new Date(`${item.day}T${item.time}:00`).toISOString(), category: item.category, repeatRule: item.repeatRule || null })) : undefined,
      }) });
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
      <TodoSchedulePicker day={day} time={time} onDayChange={setDay} onTimeChange={setTime} />
      {!sourceList && <><CategoryPicker value={category} onChange={setCategory} /><RepeatPicker value={repeatRule} onChange={setRepeatRule} /></>}
      {sourceList && <fieldset className="list-repeat-mode"><legend><Repeat2 aria-hidden /> 루틴 반복 설정</legend><p>항목마다 다른 반복 주기를 그대로 두거나, 내 일정에 맞게 바꿀 수 있어요.</p><div className="list-repeat-options">
        <button type="button" className={listRepeatMode === "KEEP" ? "selected" : ""} aria-pressed={listRepeatMode === "KEEP"} onClick={() => chooseListRepeatMode("KEEP")}><Layers3 /><span><b>원본 유지</b><small>각 TODO의 반복을 그대로 가져와요</small></span></button>
        <button type="button" className={listRepeatMode === "NONE" ? "selected" : ""} aria-pressed={listRepeatMode === "NONE"} onClick={() => chooseListRepeatMode("NONE")}><CheckCircle2 /><span><b>반복 없이</b><small>선택한 날짜에 한 번만 저장해요</small></span></button>
        <button type="button" className={listRepeatMode === "CUSTOM" ? "selected" : ""} aria-pressed={listRepeatMode === "CUSTOM"} onClick={() => chooseListRepeatMode("CUSTOM")}><Settings2 /><span><b>항목별 설정</b><small>시간과 반복을 하나씩 조정해요</small></span></button>
      </div></fieldset>}
      {sourceList && listRepeatMode === "KEEP" && <div className="import-repeat-summary"><span>원본 반복 요약</span><div>{sourceList.items.map((item) => <small key={item.todo.id}>{item.todo.title}<b>{repeatLabel(item.todo.repeatRule)}</b></small>)}</div></div>}
      {sourceList && listRepeatMode === "CUSTOM" && <section className="import-item-settings" aria-label="루틴 항목별 설정"><header><div><span>항목별 설정</span><p>TODO를 열어 시작 시각과 반복을 확인하세요.</p></div><b>{itemDrafts.length}개</b></header>{itemDrafts.map((item, index) => { const open = expandedItem === item.sourceTodoId; return <article className={open ? "open" : ""} key={item.sourceTodoId}><button type="button" className="import-item-toggle" aria-expanded={open} onClick={() => setExpandedItem(open ? null : item.sourceTodoId)}><span>{index + 1}</span><div><b>{item.title}</b><small>{item.day} · {item.time} · {repeatLabel(item.repeatRule)}</small></div>{open ? <ChevronDown /> : <ChevronRight />}</button>{open && <div className="import-item-body"><label className="field"><span>TODO 이름</span><input value={item.title} onChange={(event) => updateItem(item.sourceTodoId, { title: event.target.value })} maxLength={120} required /></label><TodoSchedulePicker day={item.day} time={item.time} onDayChange={(value) => updateItem(item.sourceTodoId, { day: value })} onTimeChange={(value) => updateItem(item.sourceTodoId, { time: value })} /><RepeatPicker value={item.repeatRule} onChange={(value) => updateItem(item.sourceTodoId, { repeatRule: value })} /></div>}</article>; })}</section>}
      {error && <p className="form-error">{error}</p>}
      <div className="import-submit"><button className="button full" disabled={save.isPending}><CheckCircle2 />{save.isPending ? "저장 중…" : sourceList ? "내 루틴에 저장" : "내 TODO에 저장"}</button></div>
    </form>
  </main>;
}
