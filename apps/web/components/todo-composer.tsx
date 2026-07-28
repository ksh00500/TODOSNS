"use client";

import { FormEvent, useState } from "react";
import { CalendarDays, Clock3, Repeat2 } from "lucide-react";
import { Sheet } from "./sheet";
import type { TodoDto } from "@/lib/types";

export type TodoDraft = { title: string; category: string; dueDate: string; repeatRule?: string };

export function TodoComposer({ date, todo, busy, onClose, onSave, onDelete }: { date: string; todo?: TodoDto | null; busy?: boolean; onClose: () => void; onSave: (draft: TodoDraft) => void; onDelete?: () => void }) {
  const due = todo ? new Date(todo.dueDate) : new Date(`${date}T09:00:00`);
  const [title, setTitle] = useState(todo?.title ?? "");
  const [category, setCategory] = useState(todo?.category ?? "생활");
  const [day, setDay] = useState(due.toISOString().slice(0, 10));
  const [time, setTime] = useState(`${String(due.getHours()).padStart(2, "0")}:${String(due.getMinutes()).padStart(2, "0")}`);
  const [repeatRule, setRepeatRule] = useState(todo?.repeatRule ?? "");
  const submit = (event: FormEvent) => { event.preventDefault(); if (!title.trim()) return; onSave({ title: title.trim(), category, dueDate: new Date(`${day}T${time}:00`).toISOString(), repeatRule: repeatRule || undefined }); };
  return <Sheet title={todo ? "TODO 편집" : "새 TODO"} onClose={onClose}><form className="composer-form" onSubmit={submit}>
    <label className="field"><span>무엇을 실천할까요?</span><input autoFocus value={title} onChange={(event) => setTitle(event.target.value)} maxLength={120} placeholder="예: 잠들기 전 책 10쪽" required /></label>
    <label className="field"><span>카테고리</span><select value={category} onChange={(event) => setCategory(event.target.value)}>{["생활", "운동", "공부", "건강", "마음", "커리어", "취미"].map((item) => <option key={item}>{item}</option>)}</select></label>
    <div className="field-grid"><label className="field"><span><CalendarDays /> 날짜</span><input type="date" value={day} onChange={(event) => setDay(event.target.value)} /></label><label className="field"><span><Clock3 /> 시간</span><input type="time" value={time} onChange={(event) => setTime(event.target.value)} /></label></div>
    <label className="field"><span><Repeat2 /> 반복</span><select value={repeatRule} onChange={(event) => setRepeatRule(event.target.value)}><option value="">반복 안 함</option><option value="DAILY">매일</option><option value="WEEKDAYS">평일</option><option value="WEEKLY">매주</option></select></label>
    <button className="button full" disabled={busy}>{busy ? "저장 중…" : todo ? "변경사항 저장" : "TODO 추가"}</button>
    {todo && onDelete && <button type="button" className="danger-link" onClick={onDelete} disabled={busy}>TODO 삭제</button>}
  </form></Sheet>;
}
