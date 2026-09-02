"use client";

import { KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  BookOpen,
  Brain,
  BriefcaseBusiness,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Dumbbell,
  GraduationCap,
  HeartPulse,
  House,
  Palette,
  Repeat2,
} from "lucide-react";
import { localDateKey } from "@/lib/date";
import { REPEAT_OPTIONS, TODO_CATEGORIES, type RepeatPreset } from "@/lib/todo-options";
import type { TodoCategoryDto } from "@/lib/types";

const categoryIcons = {
  생활: House,
  건강: HeartPulse,
  운동: Dumbbell,
  공부: GraduationCap,
  독서: BookOpen,
  마음: Brain,
  커리어: BriefcaseBusiness,
  취미: Palette,
};

const weekdays = ["월", "화", "수", "목", "금", "토", "일"];
const hours = Array.from({ length: 24 }, (_, index) => String(index).padStart(2, "0"));
const minutes = Array.from({ length: 12 }, (_, index) => String(index * 5).padStart(2, "0"));

function monthKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function calendarDays(view: Date) {
  const first = new Date(view.getFullYear(), view.getMonth(), 1, 12);
  const mondayOffset = (first.getDay() + 6) % 7;
  const start = new Date(first);
  start.setDate(first.getDate() - mondayOffset);
  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    return date;
  });
}

export function DatePicker({ label, value, onChange, min }: { label: string; value: string; onChange: (value: string) => void; min?: string }) {
  const selected = new Date(`${value}T12:00:00`);
  const [open, setOpen] = useState(false);
  const [view, setView] = useState(() => new Date(selected.getFullYear(), selected.getMonth(), 1, 12));
  const days = useMemo(() => calendarDays(view), [view]);
  const today = localDateKey();
  const moveCalendarFocus = (event: KeyboardEvent<HTMLButtonElement>) => {
    const offsets: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
    const offset = offsets[event.key];
    if (!offset) return;
    event.preventDefault();
    const candidates = [...event.currentTarget.parentElement!.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")];
    const current = candidates.indexOf(event.currentTarget);
    candidates[Math.min(candidates.length - 1, Math.max(0, current + offset))]?.focus();
  };
  return <fieldset className="date-field-picker"><legend>{label}</legend>
    <button type="button" className={open ? "active" : ""} aria-expanded={open} onClick={() => setOpen(!open)}><CalendarDays aria-hidden /><span>{value === today ? "오늘" : value}</span></button>
    {open && <div className="picker-panel calendar-picker" aria-label={`${label} 선택`}>
      <header><button type="button" onClick={() => setView(new Date(view.getFullYear(), view.getMonth() - 1, 1, 12))} aria-label="이전 달"><ChevronLeft /></button><strong>{view.getFullYear()}년 {view.getMonth() + 1}월</strong><button type="button" onClick={() => setView(new Date(view.getFullYear(), view.getMonth() + 1, 1, 12))} aria-label="다음 달"><ChevronRight /></button></header>
      <div className="calendar-weekdays" aria-hidden>{weekdays.map((item) => <span key={item}>{item}</span>)}</div>
      <div className="calendar-grid">{days.map((item) => { const key = localDateKey(item); const disabled = Boolean(min && key < min); return <button type="button" key={key} disabled={disabled} className={`${monthKey(item) !== monthKey(view) ? "outside" : ""} ${key === value ? "selected" : ""} ${key === today ? "today" : ""}`} aria-label={item.toLocaleDateString("ko-KR", { year: "numeric", month: "long", day: "numeric", weekday: "long" })} aria-pressed={key === value} onKeyDown={moveCalendarFocus} onClick={() => { onChange(key); setOpen(false); }}>{item.getDate()}</button>; })}</div>
      {!min || today >= min ? <button type="button" className="calendar-today" onClick={() => { const now = new Date(); setView(new Date(now.getFullYear(), now.getMonth(), 1, 12)); onChange(today); setOpen(false); }}>오늘로 이동</button> : null}
    </div>}
  </fieldset>;
}

export function BirthDatePicker({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const now = new Date();
  const fallbackYear = now.getFullYear() - 25;
  const parsed = value ? new Date(`${value}T12:00:00`) : null;
  const [open, setOpen] = useState(false);
  const [year, setYear] = useState(parsed && !Number.isNaN(parsed.getTime()) ? parsed.getFullYear() : fallbackYear);
  const [month, setMonth] = useState(parsed && !Number.isNaN(parsed.getTime()) ? parsed.getMonth() + 1 : 1);
  const [day, setDay] = useState(parsed && !Number.isNaN(parsed.getTime()) ? parsed.getDate() : 1);
  const selectedYearRef = useRef<HTMLButtonElement>(null);
  const years = Array.from({ length: 101 }, (_, index) => now.getFullYear() - index);
  const months = Array.from({ length: 12 }, (_, index) => index + 1);
  const dayCount = new Date(year, month, 0).getDate();
  const days = Array.from({ length: dayCount }, (_, index) => index + 1);
  const safeDay = Math.min(day, dayCount);
  useEffect(() => {
    if (open) selectedYearRef.current?.scrollIntoView({ block: "center" });
  }, [open]);
  const chooseByArrow = (event: KeyboardEvent<HTMLButtonElement>, values: number[], current: number, apply: (next: number) => void) => {
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
    event.preventDefault();
    const offset = event.key === "ArrowDown" ? 1 : -1;
    const nextIndex = Math.min(values.length - 1, Math.max(0, values.indexOf(current) + offset));
    apply(values[nextIndex]);
    event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>("button")[nextIndex]?.focus();
  };
  const display = value ? new Date(`${value}T12:00:00`).toLocaleDateString("ko-KR", { year: "numeric", month: "long", day: "numeric" }) : "생년월일을 선택해주세요";
  const apply = () => {
    onChange(`${year}-${String(month).padStart(2, "0")}-${String(safeDay).padStart(2, "0")}`);
    setOpen(false);
  };

  return <fieldset className="date-field-picker birthdate-field-picker"><legend>생년월일</legend>
    <button type="button" className={open ? "active" : ""} aria-expanded={open} onClick={() => setOpen(!open)}><CalendarDays aria-hidden /><span>{display}</span></button>
    {open && <div className="picker-panel birthdate-picker" aria-label="생년월일 선택">
      <div><span>연도</span><div className="birthdate-column" role="listbox" aria-label="출생 연도">{years.map((item) => <button ref={year === item ? selectedYearRef : undefined} type="button" role="option" aria-selected={year === item} className={year === item ? "selected" : ""} key={item} onKeyDown={(event) => chooseByArrow(event, years, item, setYear)} onClick={() => setYear(item)}>{item}년</button>)}</div></div>
      <div><span>월</span><div className="birthdate-column" role="listbox" aria-label="출생 월">{months.map((item) => <button type="button" role="option" aria-selected={month === item} className={month === item ? "selected" : ""} key={item} onKeyDown={(event) => chooseByArrow(event, months, item, (next) => { setMonth(next); setDay(Math.min(day, new Date(year, next, 0).getDate())); })} onClick={() => { setMonth(item); setDay(Math.min(day, new Date(year, item, 0).getDate())); }}>{item}월</button>)}</div></div>
      <div><span>일</span><div className="birthdate-column" role="listbox" aria-label="출생 일">{days.map((item) => <button type="button" role="option" aria-selected={safeDay === item} className={safeDay === item ? "selected" : ""} key={item} onKeyDown={(event) => chooseByArrow(event, days, item, setDay)} onClick={() => setDay(item)}>{item}일</button>)}</div></div>
      <button type="button" className="button full" onClick={apply}>생년월일 적용</button>
    </div>}
  </fieldset>;
}

export function TodoSchedulePicker({
  day,
  time,
  onDayChange,
  onTimeChange,
}: {
  day: string;
  time: string;
  onDayChange: (value: string) => void;
  onTimeChange: (value: string) => void;
}) {
  const selected = new Date(`${day}T12:00:00`);
  const [open, setOpen] = useState<"date" | "time" | null>(null);
  const [view, setView] = useState(() => new Date(selected.getFullYear(), selected.getMonth(), 1, 12));
  const [draftHour, draftMinute = "00"] = time.split(":");
  const [hour, setHour] = useState(draftHour);
  const [minute, setMinute] = useState(minutes.includes(draftMinute) ? draftMinute : "00");
  const days = useMemo(() => calendarDays(view), [view]);
  const today = localDateKey();

  const moveOption = (event: KeyboardEvent<HTMLButtonElement>, values: string[], current: string, apply: (value: string) => void) => {
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
    event.preventDefault();
    const offset = event.key === "ArrowDown" ? 1 : -1;
    const next = (values.indexOf(current) + offset + values.length) % values.length;
    apply(values[next]);
    event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>("button")[next]?.focus();
  };
  const moveCalendarFocus = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const offsets: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
    const offset = offsets[event.key];
    if (!offset) return;
    event.preventDefault();
    const next = Math.min(days.length - 1, Math.max(0, index + offset));
    event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>("button")[next]?.focus();
  };

  return (
    <fieldset className="schedule-picker">
      <legend>언제 할까요?</legend>
      <div className="schedule-triggers">
        <button type="button" className={open === "date" ? "active" : ""} aria-expanded={open === "date"} onClick={() => setOpen(open === "date" ? null : "date")}>
          <span><CalendarDays aria-hidden /> 날짜</span><b>{day === today ? "오늘" : day}</b>
        </button>
        <button type="button" className={open === "time" ? "active" : ""} aria-expanded={open === "time"} onClick={() => setOpen(open === "time" ? null : "time")}>
          <span><Clock3 aria-hidden /> 시간</span><b>{time}</b>
        </button>
      </div>
      {open === "date" && (
        <div className="picker-panel calendar-picker" aria-label="날짜 선택">
          <header><button type="button" onClick={() => setView(new Date(view.getFullYear(), view.getMonth() - 1, 1, 12))} aria-label="이전 달"><ChevronLeft /></button><strong>{view.getFullYear()}년 {view.getMonth() + 1}월</strong><button type="button" onClick={() => setView(new Date(view.getFullYear(), view.getMonth() + 1, 1, 12))} aria-label="다음 달"><ChevronRight /></button></header>
          <div className="calendar-weekdays" aria-hidden>{weekdays.map((item) => <span key={item}>{item}</span>)}</div>
          <div className="calendar-grid">
            {days.map((item, index) => {
              const key = localDateKey(item);
              return <button type="button" key={key} className={`${monthKey(item) !== monthKey(view) ? "outside" : ""} ${key === day ? "selected" : ""} ${key === today ? "today" : ""}`} aria-label={item.toLocaleDateString("ko-KR", { year: "numeric", month: "long", day: "numeric", weekday: "long" })} aria-pressed={key === day} onKeyDown={(event) => moveCalendarFocus(event, index)} onClick={() => { onDayChange(key); setOpen(null); }}>{item.getDate()}</button>;
            })}
          </div>
          <button type="button" className="calendar-today" onClick={() => { const now = new Date(); setView(new Date(now.getFullYear(), now.getMonth(), 1, 12)); onDayChange(today); setOpen(null); }}>오늘로 이동</button>
        </div>
      )}
      {open === "time" && (
        <div className="picker-panel time-picker" aria-label="시간 선택">
          <div><span>시</span><div className="time-column" role="listbox" aria-label="시 선택">{hours.map((item) => <button type="button" role="option" aria-selected={hour === item} className={hour === item ? "selected" : ""} key={item} onKeyDown={(event) => moveOption(event, hours, item, setHour)} onClick={() => setHour(item)}>{item}시</button>)}</div></div>
          <div><span>분</span><div className="time-column" role="listbox" aria-label="분 선택">{minutes.map((item) => <button type="button" role="option" aria-selected={minute === item} className={minute === item ? "selected" : ""} key={item} onKeyDown={(event) => moveOption(event, minutes, item, setMinute)} onClick={() => setMinute(item)}>{item}분</button>)}</div></div>
          <button type="button" className="button full" onClick={() => { onTimeChange(`${hour}:${minute}`); setOpen(null); }}>시간 적용</button>
        </div>
      )}
    </fieldset>
  );
}

export function CategoryPicker({ value, categoryId, categories, onChange, onCategoryChange }: { value: string; categoryId?: string; categories?: TodoCategoryDto[]; onChange: (value: string) => void; onCategoryChange?: (id: string) => void }) {
  const tones = ["aqua", "blush", "aqua", "butter", "aqua", "blush", "aqua", "butter"];
  const managed = categories !== undefined;
  const options = managed ? categories : TODO_CATEGORIES.map((name, index) => ({ id: name, name, baseCategory: name, icon: "tag", color: tones[index], position: index, isDefault: true } satisfies TodoCategoryDto));
  return <fieldset className="category-picker"><legend>카테고리</legend><div className="category-grid">{options.map((item, index) => { const Icon = categoryIcons[item.baseCategory as keyof typeof categoryIcons] ?? categoryIcons.생활; const selected = categoryId ? categoryId === item.id : value === item.name || value === item.baseCategory; return <button type="button" key={item.id} className={`category-option tone-${index % 8 + 1} category-tone-${item.color} ${selected ? "selected" : ""}`} aria-pressed={selected} onClick={() => { onChange(item.baseCategory); onCategoryChange?.(managed ? item.id : ""); }}><Icon aria-hidden /><span>{item.name}</span>{item.name !== item.baseCategory && <small>{item.baseCategory}</small>}</button>; })}</div>{managed && options.length === 0 && <p className="form-error">카테고리 관리에서 사용할 항목을 하나 이상 켜주세요.</p>}</fieldset>;
}

export function RepeatPicker({ value, onChange }: { value: RepeatPreset; onChange: (value: RepeatPreset) => void }) {
  return <fieldset className="repeat-picker"><legend><Repeat2 aria-hidden /> 반복</legend><div>{REPEAT_OPTIONS.map((item) => <button type="button" key={item.value || "none"} className={value === item.value ? "selected" : ""} aria-pressed={value === item.value} onClick={() => onChange(item.value)}>{item.label}</button>)}</div></fieldset>;
}
