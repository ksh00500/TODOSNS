"use client";

import { FormEvent, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, Layers3 } from "lucide-react";
import { Sheet } from "./sheet";
import type { TodoCategoryDto, TodoDto, TodoListDto } from "@/lib/types";
import { apiFetch } from "@/lib/api";
import { localDateKey } from "@/lib/date";
import { CategoryPicker, RepeatPicker, TodoSchedulePicker } from "./todo-form-controls";
import { toRepeatPreset, type RepeatPreset } from "@/lib/todo-options";

export type TodoDraft = {
  title: string;
  notes?: string | null;
  category: string;
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
}: {
  date: string;
  todo?: TodoDto | null;
  lists?: TodoListDto[];
  busy?: boolean;
  onClose: () => void;
  onSave: (draft: TodoDraft) => void;
  onDelete?: () => void;
  onEndSeries?: () => void;
}) {
  const due = todo ? new Date(todo.dueDate) : new Date(`${date}T09:00:00`);
  const [title, setTitle] = useState(todo?.title ?? "");
  const [notes, setNotes] = useState(todo?.notes ?? "");
  const [category, setCategory] = useState(todo?.category ?? "생활");
  const [categoryId, setCategoryId] = useState(todo?.categoryId ?? "");
  const categories = useQuery({ queryKey: ["todo-categories"], queryFn: () => apiFetch<TodoCategoryDto[]>("/me/todo-categories") });
  const [day, setDay] = useState(localDateKey(due));
  const [time, setTime] = useState(
    `${String(due.getHours()).padStart(2, "0")}:${String(due.getMinutes()).padStart(2, "0")}`,
  );
  const [repeatRule, setRepeatRule] = useState<RepeatPreset>(toRepeatPreset(todo?.repeatRule));
  const [recurrenceScope, setRecurrenceScope] = useState<"THIS" | "FUTURE">("THIS");
  const [todoListId, setTodoListId] = useState(currentTodoListId(todo, lists));

  const categoryOptions = todo?.categoryRef && !categories.data?.some((item) => item.id === todo.categoryRef?.id) ? [todo.categoryRef, ...(categories.data ?? [])] : categories.data;
  const selectedCategoryId = categoryId || categoryOptions?.find((item) => item.name === category || item.baseCategory === category)?.id || "";

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!title.trim()) return;
    onSave({
      title: title.trim(),
      notes: notes.trim() || null,
      category,
      categoryId: selectedCategoryId || null,
      dueDate: new Date(`${day}T${time}:00`).toISOString(),
      repeatRule: repeatRule || (todo?.seriesId ? null : undefined),
      recurrenceScope: todo?.seriesId ? recurrenceScope : undefined,
      todoListId: todoListId || null,
    });
  };

  return (
    <Sheet title={todo ? "TODO 상세 및 편집" : "새 TODO"} onClose={onClose}>
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
        <CategoryPicker value={category} categoryId={selectedCategoryId} categories={categoryOptions} onChange={setCategory} onCategoryChange={setCategoryId} />
        <RepeatPicker value={repeatRule} onChange={setRepeatRule} />
        <fieldset className="todo-list-selector">
          <legend><Layers3 />루틴 묶음 <small>선택</small></legend>
          <p>함께 이어서 보고 싶은 루틴을 골라보세요.</p>
          <div className="todo-list-options">
            <button type="button" className={!todoListId ? "active" : ""} aria-pressed={!todoListId} onClick={() => setTodoListId("")}>
              <span><b>그룹 없음</b><small>독립된 TODO로 관리해요</small></span>
              {!todoListId && <Check aria-hidden />}
            </button>
            {lists.map((list) => {
              const selected = todoListId === list.id;
              return <button type="button" className={selected ? "active" : ""} aria-pressed={selected} onClick={() => setTodoListId(list.id)} key={list.id}>
                <span><b>{list.title}</b><small>{list.items.length}개의 TODO</small></span>
                {selected && <Check aria-hidden />}
              </button>;
            })}
          </div>
          {lists.length === 0 && <small className="todo-list-empty">TODO 탭의 루틴 보관함에서 묶음을 먼저 만들 수 있어요.</small>}
          {todo?.seriesId && <small className="todo-list-series-note">반복 TODO의 묶음은 이후 일정에도 함께 적용돼요.</small>}
        </fieldset>
        {todo?.seriesId && (
          <fieldset className="repeat-scope">
            <legend>변경 범위</legend>
            <button
              type="button"
              className={recurrenceScope === "THIS" ? "active" : ""}
              onClick={() => setRecurrenceScope("THIS")}
            >
              이번 일정만
            </button>
            <button
              type="button"
              className={recurrenceScope === "FUTURE" ? "active" : ""}
              onClick={() => setRecurrenceScope("FUTURE")}
            >
              이후 일정 전체
            </button>
          </fieldset>
        )}
        <button className="button full" disabled={busy}>
          {busy ? "저장 중…" : todo ? "변경사항 저장" : "TODO 추가"}
        </button>
        {todo && onDelete && (
          <button type="button" className="danger-link" onClick={onDelete} disabled={busy}>
            이번 TODO 삭제
          </button>
        )}
        {todo?.seriesId && onEndSeries && (
          <button type="button" className="danger-link subtle" onClick={onEndSeries} disabled={busy}>
            이 날짜 이후 반복 종료
          </button>
        )}
      </form>
    </Sheet>
  );
}
