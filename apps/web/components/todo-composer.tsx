"use client";

import { FormEvent, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, Layers3 } from "lucide-react";
import { Sheet } from "./sheet";
import { ConfirmSheet } from "./confirm-sheet";
import type { TodoCategoryDto, TodoDto, TodoListDto } from "@/lib/types";
import { apiFetch } from "@/lib/api";
import { localDateKey } from "@/lib/date";
import { CategoryPicker, RepeatPicker, TodoSchedulePicker } from "./todo-form-controls";
import { isPresetRepeatRule, toRepeatPreset, type RepeatPreset } from "@/lib/todo-options";

export type TodoDraft = {
  title: string;
  notes?: string | null;
  category?: string;
  categoryId?: string | null;
  dueDate: string;
  repeatRule?: string | null;
  recurrenceScope?: "THIS" | "FUTURE";
  todoListId?: string | null;
};

function currentTodoListId(todo: TodoDto | null | undefined, lists: TodoListDto[]) {
  if (!todo) return "";
  return lists.find((list) => list.items.some(({ todo: listed }) => listed.id === todo.id || Boolean(todo.seriesId && listed.seriesId === todo.seriesId)))?.id ?? "";
}

export function TodoComposer({
  date,
  todo,
  lists = [],
  busy,
  onClose,
  onSave,
  onDelete,
  onEndSeries,
  listsStatus = "ready",
  onRetryLists,
  error = "",
}: {
  date: string;
  todo?: TodoDto | null;
  lists?: TodoListDto[];
  busy?: boolean;
  onClose: () => void;
  onSave: (draft: TodoDraft) => void;
  onDelete?: () => void;
  onEndSeries?: () => void;
  listsStatus?: "loading" | "error" | "ready";
  onRetryLists?: () => void;
  error?: string;
}) {
  const due = todo ? new Date(todo.dueDate) : new Date(`${date}T09:00:00`);
  const initialDay = localDateKey(due);
  const initialTime = `${String(due.getHours()).padStart(2, "0")}:${String(due.getMinutes()).padStart(2, "0")}`;
  const [title, setTitle] = useState(todo?.title ?? "");
  const [notes, setNotes] = useState(todo?.notes ?? "");
  const [category, setCategory] = useState(todo?.category ?? "생활");
  const [categoryId, setCategoryId] = useState(todo?.categoryId ?? "");
  const categories = useQuery({ queryKey: ["todo-categories"], queryFn: () => apiFetch<TodoCategoryDto[]>("/me/todo-categories") });
  const [day, setDay] = useState(initialDay);
  const [time, setTime] = useState(initialTime);
  const [repeatRule, setRepeatRule] = useState<RepeatPreset>(toRepeatPreset(todo?.repeatRule));
  const [repeatEdited, setRepeatEdited] = useState(false);
  const [recurrenceScope, setRecurrenceScope] = useState<"THIS" | "FUTURE">("THIS");
  const [todoListChoice, setTodoListChoice] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<"discard" | "delete" | "end" | null>(null);
  const todoListId = todoListChoice ?? currentTodoListId(todo, lists);
  const dirty = title !== (todo?.title ?? "") || notes !== (todo?.notes ?? "") || category !== (todo?.category ?? "생활") || categoryId !== (todo?.categoryId ?? "") || day !== initialDay || time !== initialTime || repeatEdited || recurrenceScope !== "THIS" || todoListChoice !== null;

  const categoryOptions = todo?.categoryRef && !categories.data?.some((item) => item.id === todo.categoryRef?.id) ? [todo.categoryRef, ...(categories.data ?? [])] : categories.data;
  const selectedCategoryId = categoryId || categoryOptions?.find((item) => item.name === category || item.baseCategory === category)?.id || "";

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!title.trim()) return;
    onSave({
      title: title.trim(),
      notes: notes.trim() || null,
      ...(!todo || categories.isSuccess ? { category, categoryId: selectedCategoryId || null } : {}),
      dueDate: new Date(`${day}T${time}:00`).toISOString(),
      repeatRule: repeatEdited ? repeatRule || (todo?.seriesId ? null : undefined) : todo?.repeatRule ?? (repeatRule || undefined),
      recurrenceScope: todo?.seriesId ? recurrenceScope : undefined,
      ...(listsStatus === "ready" ? { todoListId: todoListId || null } : {}),
    });
  };

  return (<>
    <Sheet title={todo ? "TODO 상세 및 편집" : "새 TODO"} onClose={() => dirty ? setConfirmation("discard") : onClose()}>
      <form className="composer-form" onSubmit={submit}>
        <label className="field">
          <span>무엇을 실천할까요?</span>
          <input
            autoFocus
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            maxLength={120}
            placeholder="예: 잠들기 전 책 10쪽"
            required
          />
        </label>
        <label className="field">
          <span>메모 <small>선택</small></span>
          <textarea value={notes} onChange={(event) => setNotes(event.target.value)} maxLength={500} placeholder="실천에 필요한 내용을 적어두세요." />
        </label>
        <TodoSchedulePicker day={day} time={time} onDayChange={setDay} onTimeChange={setTime} />
        {categories.isLoading ? <div className="relationship-state" role="status">카테고리를 확인하고 있어요. 저장해도 기존 분류는 유지돼요.</div> : categories.isError ? <div className="relationship-state error"><span>카테고리를 불러오지 못했어요. 기존 분류는 바꾸지 않아요.</span><button type="button" onClick={() => void categories.refetch()}>다시 시도</button></div> : <CategoryPicker value={category} categoryId={selectedCategoryId} categories={categoryOptions} onChange={setCategory} onCategoryChange={setCategoryId} />}
        {!repeatEdited && todo?.repeatRule && !isPresetRepeatRule(todo.repeatRule) && <p className="form-help">현재의 세부 반복 규칙을 그대로 유지해요. 다른 반복을 고르면 새 설정으로 바뀌어요.</p>}
        <RepeatPicker value={repeatRule} onChange={(value) => { setRepeatRule(value); setRepeatEdited(true); }} />
        <fieldset className="todo-list-selector">
          <legend><Layers3 />루틴 묶음 <small>선택</small></legend>
          <p>함께 이어서 보고 싶은 루틴을 골라보세요.</p>
          <div className="todo-list-options">
            <button type="button" disabled={listsStatus !== "ready"} className={!todoListId ? "active" : ""} aria-pressed={!todoListId} onClick={() => setTodoListChoice("")}>
              <span><b>그룹 없음</b><small>독립된 TODO로 관리해요</small></span>
              {!todoListId && <Check aria-hidden />}
            </button>
            {lists.map((list) => {
              const selected = todoListId === list.id;
              return <button type="button" disabled={listsStatus !== "ready"} className={selected ? "active" : ""} aria-pressed={selected} onClick={() => setTodoListChoice(list.id)} key={list.id}>
                <span><b>{list.title}</b><small>{list.items.length}개의 TODO</small></span>
                {selected && <Check aria-hidden />}
              </button>;
            })}
          </div>
          {listsStatus === "loading" && <small className="todo-list-empty">현재 그룹을 확인하고 있어요. 저장해도 기존 관계는 유지돼요.</small>}
          {listsStatus === "error" && <small className="todo-list-empty">그룹을 불러오지 못했어요. 기존 관계는 바꾸지 않아요. {onRetryLists && <button type="button" onClick={onRetryLists}>다시 시도</button>}</small>}
          {listsStatus === "ready" && lists.length === 0 && <small className="todo-list-empty">TODO 탭의 그룹 화면에서 묶음을 먼저 만들 수 있어요.</small>}
          {todo?.seriesId && <small className="todo-list-series-note">반복 TODO의 묶음은 이후 일정에도 함께 적용돼요.</small>}
        </fieldset>
        {todo?.seriesId && (
          <fieldset className="repeat-scope">
            <legend>변경 범위</legend>
            <button
              type="button"
              className={recurrenceScope === "THIS" ? "active" : ""}
              aria-pressed={recurrenceScope === "THIS"}
              onClick={() => setRecurrenceScope("THIS")}
            >
              이번 일정만
            </button>
            <button
              type="button"
              className={recurrenceScope === "FUTURE" ? "active" : ""}
              aria-pressed={recurrenceScope === "FUTURE"}
              onClick={() => setRecurrenceScope("FUTURE")}
            >
              이후 일정 전체
            </button>
          </fieldset>
        )}
        {error && <p className="form-error" role="alert">{error}</p>}
        <button className="button full" disabled={busy}>
          {busy ? "저장 중…" : todo ? "변경사항 저장" : "TODO 추가"}
        </button>
        {todo && onDelete && (
          <button type="button" className="danger-link" onClick={() => setConfirmation("delete")} disabled={busy}>
            이번 TODO 삭제
          </button>
        )}
        {todo?.seriesId && onEndSeries && (
          <button type="button" className="danger-link subtle" onClick={() => setConfirmation("end")} disabled={busy}>
            이 날짜 이후 반복 종료
          </button>
        )}
      </form>
    </Sheet>
    {confirmation === "discard" && <ConfirmSheet title="작성 중인 내용을 닫을까요?" body="저장하지 않은 변경사항은 사라져요." confirmLabel="변경사항 버리기" danger onClose={() => setConfirmation(null)} onConfirm={onClose} />}
    {confirmation === "delete" && onDelete && <ConfirmSheet title="이 TODO를 삭제할까요?" body="선택한 일정만 삭제해요. 연결된 게시물이 있다면 게시 내용과 사진도 삭제되며, 반복 시리즈의 다른 일정은 유지돼요." confirmLabel="이번 TODO 삭제" danger busy={busy} error={error} onClose={() => setConfirmation(null)} onConfirm={onDelete} />}
    {confirmation === "end" && onEndSeries && <ConfirmSheet title="이 날짜 이후 반복을 종료할까요?" body={`${new Date(`${day}T12:00:00`).toLocaleDateString("ko-KR", { year: "numeric", month: "long", day: "numeric" })}부터 같은 반복 시리즈의 이후 일정을 종료해요. 이미 지난 일정과 완료 기록은 유지돼요.`} confirmLabel="이후 반복 종료" danger busy={busy} error={error} onClose={() => setConfirmation(null)} onConfirm={onEndSeries} />}
  </>);
}
