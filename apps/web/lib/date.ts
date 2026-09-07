const partsInZone = (date: Date, timeZone: string) => {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", fractionalSecondDigits: 3, hourCycle: "h23" }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value ?? 0);
  return { year: value("year"), month: value("month"), day: value("day"), hour: value("hour"), minute: value("minute"), second: value("second"), millisecond: value("fractionalSecond") };
};

const zonedDate = (year: number, month: number, day: number, hour: number, minute: number, second: number, millisecond: number, timeZone: string) => {
  const desiredUtc = Date.UTC(year, month - 1, day, hour, minute, second, millisecond);
  let candidate = new Date(desiredUtc);
  for (let index = 0; index < 3; index += 1) {
    const actual = partsInZone(candidate, timeZone);
    const actualUtc = Date.UTC(actual.year, actual.month - 1, actual.day, actual.hour, actual.minute, actual.second, actual.millisecond);
    candidate = new Date(candidate.getTime() + desiredUtc - actualUtc);
  }
  return candidate;
};

export const localDateKey = (date = new Date(), timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone) => {
  const parts = partsInZone(date, timeZone);
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
};

export const dayRange = (key: string, timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone) => {
  const [year, month, day] = key.split("-").map(Number);
  return { from: zonedDate(year, month, day, 0, 0, 0, 0, timeZone).toISOString(), to: zonedDate(year, month, day, 23, 59, 59, 999, timeZone).toISOString() };
};

export const monthRange = (key: string, timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone) => {
  const [year, month] = key.split("-").map(Number);
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return { from: zonedDate(year, month, 1, 0, 0, 0, 0, timeZone).toISOString(), to: zonedDate(year, month, lastDay, 23, 59, 59, 999, timeZone).toISOString() };
};

export const koreanDate = (key: string) => new Date(`${key}T12:00:00Z`).toLocaleDateString("ko-KR", { timeZone: "UTC", month: "long", day: "numeric", weekday: "long" });
export const weekOf = (key: string) => { const current = new Date(`${key}T12:00:00Z`); const day = current.getUTCDay(); const monday = new Date(current); monday.setUTCDate(current.getUTCDate() - (day === 0 ? 6 : day - 1)); return Array.from({ length: 7 }, (_, index) => { const date = new Date(monday); date.setUTCDate(monday.getUTCDate() + index); return date; }); };
