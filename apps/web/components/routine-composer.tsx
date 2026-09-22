"use client";

import { FormEvent, useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { CalendarClock, Check, Layers3, Repeat2 } from "lucide-react";
import type { TodoSearchPageDto } from "@mungsil/contracts";
import { apiFetch, userErrorMessage } from "@/lib/api";
import { dayRange, localDateKey } from "@/lib/date";
import type { TodoDto, TodoListDto } from "@/lib/types";
import { DatePicker } from "./todo-form-controls";
import { Sheet } from "./sheet";
import { ConfirmSheet } from "./confirm-sheet";

function shiftedDay(days: number) { const date = new Date(); date.setDate(date.getDate() + days); return localDateKey(date); }
function todoSchedule(todo: TodoDto) { const date = new Date(todo.dueDate); return `${date.toLocaleDateString("ko-KR", { month: "long", day: "numeric" })} · ${date.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })}`; }

export function RoutineComposer({ lists, list, busy, onClose, onSaved }: { lists: TodoListDto[]; list?: TodoListDto; busy?: boolean; onClose: () => void; onSaved: () => void }) {
  const [title, setTitle] = useState(list?.title ?? "");
  const [description, setDescription] = useState(list?.description ?? "");
  const [selected, setSelected] = useState<string[]>(list?.items.map((item) => item.todo.id) ?? []);
  const [selectedDetails, setSelectedDetails] = useState<Record<string, TodoDto>>(() => Object.fromEntries((list?.items ?? []).map((item) => [item.todo.id, item.todo])));
  const [search, setSearch] = useState("");
  const [from, setFrom] = useState(() => shiftedDay(-60));
  const [to, setTo] = useState(() => shiftedDay(60));
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [discardOpen, setDiscardOpen] = useState(false);
  const initialSelected = list?.items.map((item) => item.todo.id) ?? [];
  const dirty = title !== (list?.title ?? "") || description !== (list?.description ?? "") || selected.join("|") !== initialSelected.join("|");
  const validRange = from <= to;
  const results = useInfiniteQuery({
    queryKey: ["group-todo-search", search.trim(), from, to], initialPageParam: "",
    queryFn: ({ pageParam, signal }) => apiFetch<TodoSearchPageDto>(`/todos/search?from=${encodeURIComponent(dayRange(from).from)}&to=${encodeURIComponent(dayRange(to).to)}&query=${encodeURIComponent(search.trim())}&limit=20${pageParam ? `&cursor=${encodeURIComponent(pageParam)}` : ""}`, { signal }),
    getNextPageParam: (page) => page.nextCursor ?? undefined, enabled: validRange,
  });
  const visible = results.data?.pages.flatMap((page) => page.items) ?? [];
  const ownerOf = (todo: TodoDto & { group?: { id: string; title: string } | null }) => todo.group ?? lists.filter((candidate) => candidate.id !== list?.id).find((candidate) => candidate.items.some((item) => item.todo.id === todo.id || Boolean(todo.seriesId && item.todo.seriesId === todo.seriesId)));
  const toggle = (todo: TodoDto) => {
    if (selected.includes(todo.id)) setSelected((current) => current.filter((id) => id !== todo.id));
    else { setSelected((current) => [...current, todo.id]); setSelectedDetails((current) => ({ ...current, [todo.id]: todo })); }
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!selected.length) { setError("TODO를 하나 이상 선택해주세요."); return; }
    setSaving(true); setError("");
    try {
      await apiFetch(list ? `/todo-lists/${list.id}` : "/todo-lists", { method: list ? "PATCH" : "POST", body: JSON.stringify({ title, description, todoIds: selected, ...(!list ? { visibility: "PRIVATE" } : {}) }) });
      onSaved();
    } catch (cause) { setError(userErrorMessage(cause, "그룹을 저장하지 못했어요.")); }
    finally { setSaving(false); }
  };
  return <>
    <Sheet title={list ? "TODO 그룹 편집" : "새 TODO 그룹"} onClose={() => dirty ? setDiscardOpen(true) : onClose()}>
      <form className="composer-form" onSubmit={submit}>
        <label className="field"><span>그룹 이름</span><input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="예: 퇴근 후 회복" maxLength={100} required /></label>
        <label className="field"><span>짧은 설명 <small>선택</small></span><textarea value={description} onChange={(event) => setDescription(event.target.value)} maxLength={300} placeholder="어떤 TODO를 함께 묶었는지 적어보세요." /></label>
        <section className="group-selected-summary" aria-label="선택한 TODO"><h3>선택한 TODO · {selected.length}개</h3>{selected.length ? <div>{selected.map((id) => <div key={id}><span>{selectedDetails[id]?.title ?? "선택한 TODO"}</span><button type="button" onClick={() => setSelected((current) => current.filter((item) => item !== id))} aria-label={`${selectedDetails[id]?.title ?? "TODO"} 선택 해제`}>해제</button></div>)}</div> : <p>아래에서 TODO를 선택해주세요.</p>}</section>
        <label className="field"><span>TODO 제목 검색</span><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="제목으로 찾기" /></label>
        <div className="group-search-dates"><DatePicker label="조회 시작일" value={from} onChange={setFrom} /><DatePicker label="조회 종료일" value={to} onChange={setTo} /></div>
        {!validRange && <p className="form-error" role="alert">종료일은 시작일 이후로 선택해주세요.</p>}
        <fieldset className="group-todo-picker"><legend><span>검색 결과</span><small>{visible.length}개 표시</small></legend><p>기간을 넓히거나 제목을 검색해 오래된 TODO도 찾을 수 있어요.</p>
          {results.isPending && validRange ? <p>TODO를 찾는 중이에요…</p> : results.isError ? <p className="form-error" role="alert">TODO를 찾지 못했어요. <button type="button" onClick={() => void results.refetch()}>다시 시도</button></p> : !visible.length ? <p>이 기간에 일치하는 TODO가 없어요.</p> : <div>{visible.map((todo) => { const owner = ownerOf(todo); const unavailable = Boolean(owner && owner.id !== list?.id); const isSelected = selected.includes(todo.id); return <button type="button" className={`${isSelected ? "selected" : ""} ${unavailable ? "unavailable" : ""}`} disabled={unavailable} aria-pressed={isSelected} onClick={() => toggle(todo)} key={todo.id}><span className="group-todo-check">{isSelected ? <Check aria-hidden /> : <Layers3 aria-hidden />}</span><span className="group-todo-copy"><b>{todo.title}</b><small><CalendarClock aria-hidden />{todoSchedule(todo)}</small><small><span>{todo.categoryRef?.name ?? todo.category}</span>{todo.repeatRule && <><Repeat2 aria-hidden />반복</>}</small>{unavailable && <em>{owner?.title} 그룹에 포함됨</em>}</span></button>; })}</div>}
          {results.hasNextPage && <button className="load-more" type="button" disabled={results.isFetchingNextPage} onClick={() => void results.fetchNextPage()}>{results.isFetchingNextPage ? "불러오는 중…" : "TODO 더 보기"}</button>}
          {results.isFetchNextPageError && <p className="form-error" role="alert">추가 TODO를 불러오지 못했어요. <button type="button" onClick={() => void results.fetchNextPage()}>다시 시도</button></p>}
        </fieldset>
        {error && <p className="form-error" role="alert">{error}</p>}
        <button className="button full" disabled={busy || saving}>{saving ? "저장 중…" : list ? "그룹 변경사항 저장" : "TODO 그룹 만들기"}</button>
      </form>
    </Sheet>
    {discardOpen && <ConfirmSheet title="그룹 편집을 닫을까요?" body="저장하지 않은 그룹 이름과 TODO 선택은 사라져요." confirmLabel="변경사항 버리기" danger onClose={() => setDiscardOpen(false)} onConfirm={onClose} />}
  </>;
}
