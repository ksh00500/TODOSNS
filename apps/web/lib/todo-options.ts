export const TODO_CATEGORIES = ["생활", "건강", "운동", "공부", "독서", "마음", "커리어", "취미"] as const;

export type TodoCategory = (typeof TODO_CATEGORIES)[number];
export type RepeatPreset = "" | "DAILY" | "WEEKDAYS" | "WEEKENDS" | "WEEKLY";

export const REPEAT_OPTIONS: ReadonlyArray<{ value: RepeatPreset; label: string }> = [
  { value: "", label: "반복 안 함" },
  { value: "DAILY", label: "매일" },
  { value: "WEEKDAYS", label: "평일" },
  { value: "WEEKENDS", label: "주말" },
  { value: "WEEKLY", label: "매주" },
];

export function toRepeatPreset(rule?: string | null): RepeatPreset {
  if (!rule) return "";
  const normalized = rule.toUpperCase();
  if (normalized.includes("BYDAY=SA,SU")) return "WEEKENDS";
  if (normalized.includes("BYDAY=MO,TU,WE,TH,FR")) return "WEEKDAYS";
  if (normalized.includes("FREQ=DAILY")) return "DAILY";
  return "WEEKLY";
}
