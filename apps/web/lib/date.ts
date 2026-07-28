export const localDateKey = (date = new Date()) => {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
};

export const dayRange = (key: string) => ({ from: new Date(`${key}T00:00:00`).toISOString(), to: new Date(`${key}T23:59:59.999`).toISOString() });
export const monthRange = (key: string) => { const date = new Date(`${key}T12:00:00`); const from = new Date(date.getFullYear(), date.getMonth(), 1); const to = new Date(date.getFullYear(), date.getMonth() + 1, 0, 23, 59, 59, 999); return { from: from.toISOString(), to: to.toISOString() }; };
export const koreanDate = (key: string) => new Date(`${key}T12:00:00`).toLocaleDateString("ko-KR", { month: "long", day: "numeric", weekday: "long" });
export const weekOf = (key: string) => { const current = new Date(`${key}T12:00:00`); const day = current.getDay(); const monday = new Date(current); monday.setDate(current.getDate() - (day === 0 ? 6 : day - 1)); return Array.from({ length: 7 }, (_, index) => { const date = new Date(monday); date.setDate(monday.getDate() + index); return date; }); };
