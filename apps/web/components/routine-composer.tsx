"use client";

import { FormEvent, useState } from "react";
import { apiFetch } from "@/lib/api";
import type { TodoDto, TodoListDto } from "@/lib/types";
import { Sheet } from "./sheet";

export function RoutineComposer({ todos, lists, list, busy, onClose, onSaved }: { todos: TodoDto[]; lists: TodoListDto[]; list?: TodoListDto; busy?: boolean; onClose: () => void; onSaved: () => void }) {
  const availableTodos = [...(list?.items.map((item) => item.todo) ?? []), ...todos].filter((todo, index, all) => all.findIndex((candidate) => candidate.id === todo.id) === index);
  const occupied = lists.filter((candidate) => candidate.id !== list?.id).flatMap((candidate) => candidate.items.map((item) => item.todo));
  const unavailable = (todo: TodoDto) => occupied.some((item) => item.id === todo.id || Boolean(item.seriesId && item.seriesId === todo.seriesId));
  const [title, setTitle] = useState(list?.title ?? "");
  const [description, setDescription] = useState(list?.description ?? "");
  const [selected, setSelected] = useState<string[]>(list?.items.map((item) => item.todo.id) ?? []);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!selected.length) { setError("TODO를 하나 이상 선택해주세요."); return; }
    setSaving(true);
    try {
      await apiFetch(list ? `/todo-lists/${list.id}` : "/todo-lists", { method: list ? "PATCH" : "POST", body: JSON.stringify({ title, description, todoIds: selected, visibility: "PRIVATE" }) });
      onSaved();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "루틴을 저장하지 못했어요."); }
    finally { setSaving(false); }
  };
  return <Sheet title={list ? "루틴 그룹 관리" : "루틴 묶음 만들기"} onClose={onClose}><form className="composer-form" onSubmit={submit}><label className="field"><span>루틴 이름</span><input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="예: 퇴근 후 회복 루틴" maxLength={100} required /></label><label className="field"><span>짧은 설명</span><textarea value={description} onChange={(event) => setDescription(event.target.value)} maxLength={300} placeholder="어떤 실천을 함께 묶었는지 적어보세요." /></label><fieldset className="todo-picker"><legend>함께 묶을 TODO</legend>{availableTodos.map((todo) => { const disabled = unavailable(todo); return <label className={disabled ? "unavailable" : ""} key={todo.id}><input type="checkbox" disabled={disabled} checked={selected.includes(todo.id)} onChange={() => setSelected((current) => current.includes(todo.id) ? current.filter((id) => id !== todo.id) : [...current, todo.id])} /><span>{todo.title}<small>{disabled ? "다른 그룹에 포함됨" : todo.categoryRef?.name ?? todo.category}</small></span></label>; })}</fieldset>{error && <p className="form-error">{error}</p>}<button className="button full" disabled={busy || saving}>{saving ? "저장 중…" : list ? "그룹 변경사항 저장" : "루틴 묶음 만들기"}</button></form></Sheet>;
}
