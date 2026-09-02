"use client";

import { FormEvent, useState } from "react";
import { Sheet } from "./sheet";
import type { TodoDto } from "@/lib/types";
import { localDateKey } from "@/lib/date";
import { CategoryPicker, RepeatPicker, TodoSchedulePicker } from "./todo-form-controls";
import { toRepeatPreset, type RepeatPreset } from "@/lib/todo-options";

export type TodoDraft = {
  title: string;
  notes?: string | null;
  category: string;
  dueDate: string;
  repeatRule?: string | null;
  recurrenceScope?: "THIS" | "FUTURE";
};

export function TodoComposer({
  date,
  todo,
  busy,
  onClose,
  onSave,
  onDelete,
  onEndSeries,
}: {
  date: string;
  todo?: TodoDto | null;
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
  const [day, setDay] = useState(localDateKey(due));
  const [time, setTime] = useState(
    `${String(due.getHours()).padStart(2, "0")}:${String(due.getMinutes()).padStart(2, "0")}`,
  );
  const [repeatRule, setRepeatRule] = useState<RepeatPreset>(toRepeatPreset(todo?.repeatRule));
  const [recurrenceScope, setRecurrenceScope] = useState<"THIS" | "FUTURE">("THIS");

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!title.trim()) return;
    onSave({
      title: title.trim(),
      notes: notes.trim() || null,
      category,
      dueDate: new Date(`${day}T${time}:00`).toISOString(),
      repeatRule: repeatRule || (todo?.seriesId ? null : undefined),
      recurrenceScope: todo?.seriesId ? recurrenceScope : undefined,
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
        <CategoryPicker value={category} onChange={setCategory} />
        <RepeatPicker value={repeatRule} onChange={setRepeatRule} />
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
