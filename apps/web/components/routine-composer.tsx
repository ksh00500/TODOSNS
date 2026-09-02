"use client";

import { FormEvent, useState } from "react";
import { CalendarClock, Check, Layers3, Repeat2 } from "lucide-react";
import { apiFetch } from "@/lib/api";
import type { TodoDto, TodoListDto } from "@/lib/types";
import { Sheet } from "./sheet";

function todoSchedule(todo: TodoDto) {
  const date = new Date(todo.dueDate);
  return `${date.toLocaleDateString("ko-KR", { month: "long", day: "numeric" })} · ${date.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })}`;
}

export function RoutineComposer({ todos, lists, list, busy, onClose, onSaved }: { todos: TodoDto[]; lists: TodoListDto[]; list?: TodoListDto; busy?: boolean; onClose: () => void; onSaved: () => void }) {
  const availableTodos = [...(list?.items.map((item) => item.todo) ?? []), ...todos]
    .filter((todo, index, all) => all.findIndex((candidate) => candidate.id === todo.id) === index);
  const otherLists = lists.filter((candidate) => candidate.id !== list?.id);
  const occupiedBy = (todo: TodoDto) => otherLists.find((candidate) => candidate.items.some(({ todo: item }) => item.id === todo.id || Boolean(item.seriesId && item.seriesId === todo.seriesId)));
  const [title, setTitle] = useState(list?.title ?? "");
  const [description, setDescription] = useState(list?.description ?? "");
  const [selected, setSelected] = useState<string[]>(list?.items.map((item) => item.todo.id) ?? []);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const orderedTodos = [...availableTodos].sort((left, right) => Number(selected.includes(right.id)) - Number(selected.includes(left.id)) || new Date(left.dueDate).getTime() - new Date(right.dueDate).getTime());

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!selected.length) {
      setError("TODO를 하나 이상 선택해주세요.");
      return;
    }
    setSaving(true);
    try {
      await apiFetch(list ? `/todo-lists/${list.id}` : "/todo-lists", { method: list ? "PATCH" : "POST", body: JSON.stringify({ title, description, todoIds: selected, visibility: "PRIVATE" }) });
      onSaved();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "그룹을 저장하지 못했어요.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet title={list ? "TODO 그룹 편집" : "새 TODO 그룹"} onClose={onClose}>
      <form className="composer-form" onSubmit={submit}>
        <label className="field"><span>그룹 이름</span><input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="예: 퇴근 후 회복" maxLength={100} required /></label>
        <label className="field"><span>짧은 설명 <small>선택</small></span><textarea value={description} onChange={(event) => setDescription(event.target.value)} maxLength={300} placeholder="어떤 TODO를 함께 묶었는지 적어보세요." /></label>
        <fieldset className="group-todo-picker">
          <legend><span>함께 묶을 TODO</span><small>{selected.length}개 선택</small></legend>
          <p>선택한 TODO는 일정에서 같은 그룹으로 이어서 보여요.</p>
          <div>
            {orderedTodos.map((todo) => {
              const owner = occupiedBy(todo);
              const isSelected = selected.includes(todo.id);
              return (
                <button type="button" className={`${isSelected ? "selected" : ""} ${owner ? "unavailable" : ""}`} disabled={Boolean(owner)} aria-pressed={isSelected} onClick={() => setSelected((current) => current.includes(todo.id) ? current.filter((id) => id !== todo.id) : [...current, todo.id])} key={todo.id}>
                  <span className="group-todo-check">{isSelected ? <Check aria-hidden /> : <Layers3 aria-hidden />}</span>
                  <span className="group-todo-copy">
                    <b>{todo.title}</b>
                    <small><CalendarClock aria-hidden />{todoSchedule(todo)}</small>
                    <small><span>{todo.categoryRef?.name ?? todo.category}</span>{todo.repeatRule && <><Repeat2 aria-hidden />반복</>}</small>
                    {owner && <em>{owner.title} 그룹에 포함됨</em>}
                  </span>
                </button>
              );
            })}
          </div>
        </fieldset>
        {error && <p className="form-error">{error}</p>}
        <button className="button full" disabled={busy || saving}>{saving ? "저장 중…" : list ? "그룹 변경사항 저장" : "TODO 그룹 만들기"}</button>
      </form>
    </Sheet>
  );
}
