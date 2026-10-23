import { BadRequestException, ServiceUnavailableException } from "@nestjs/common";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { TodoHistoryQueryDto } from "./dtos";

const DAY = 86_400_000;
const rangeError = () => new BadRequestException("기록 날짜는 YYYY-MM-DD 형식으로 1~90일 범위를 입력해주세요.");
const cursorError = () => new BadRequestException({ code: "TODO_HISTORY_CURSOR_INVALID", message: "기록 조회 조건이 바뀌었거나 페이지 정보가 올바르지 않아요. 처음부터 다시 불러와주세요." });

function calendarDay(year: number, month: number, day: number) {
  const result = new Date(0);
  result.setUTCFullYear(year, month - 1, day);
  result.setUTCHours(0, 0, 0, 0);
  return result.getTime();
}
function parseDate(value: string): number {
  if(typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith("0000")) throw rangeError();
  const result = calendarDay(Number(value.slice(0,4)), Number(value.slice(5,7)), Number(value.slice(8,10)));
  if(new Date(result).toISOString().slice(0,10) !== value) throw rangeError();
  return result;
}

export function historyWindow(query: Pick<TodoHistoryQueryDto, "fromDate" | "toDate" | "cursor">, timezone: string, now = new Date()) {
  let formatter: Intl.DateTimeFormat;
  try {
    formatter = new Intl.DateTimeFormat("en-US", { timeZone: timezone, calendar: "gregory", numberingSystem: "latn", era: "short", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
  } catch { throw new ServiceUnavailableException("계정 시간대를 확인하지 못했어요. 설정을 확인해주세요."); }
  function dayAt(instant: number) {
    const parts = formatter.formatToParts(new Date(instant));
    const value = (type: string) => parts.find((part) => part.type === type)?.value;
    const year = Number(value("year"));
    return calendarDay(value("era") === "BC" ? 1 - year : year, Number(value("month")), Number(value("day")));
  }
  // Resolve missing midnight first, then consider both offsets near a rollback.
  // A historical 00:01 rollback can briefly visit the new date and return to
  // yesterday; binary search alone can miss its first midnight.
  function startOfDay(day: number) {
    let low = day - 2 * DAY, high = day + 2 * DAY;
    while(low < high) {
      const middle = Math.floor((low + high) / 2);
      if(dayAt(middle) < day) low = middle + 1;
      else high = middle;
    }
    for(let hour = -48; hour <= 48; hour += 6) {
      const probe = day + hour * 3_600_000;
      const parts = formatter.formatToParts(new Date(probe));
      const value = (type: string) => Number(parts.find((part) => part.type === type)?.value);
      const local = dayAt(probe) + value("hour") * 3_600_000 + value("minute") * 60_000 + value("second") * 1000;
      const candidate = day - (local - probe);
      if(candidate < low && dayAt(candidate) === day) low = candidate;
    }
    return new Date(low);
  }
  if((query.fromDate === undefined) !== (query.toDate === undefined) || (query.cursor !== undefined && query.fromDate === undefined)) throw rangeError();
  const to = query.toDate === undefined ? dayAt(now.getTime()) : parseDate(query.toDate);
  const from = query.fromDate === undefined ? to - 6 * DAY : parseDate(query.fromDate);
  if(to < from || (to - from) / DAY >= 90) throw rangeError();
  return { fromDate: new Date(from).toISOString().slice(0,10), toDate: new Date(to).toISOString().slice(0,10),
    timezone: formatter.resolvedOptions().timeZone, start: startOfDay(from), end: startOfDay(to + DAY) };
}

export type HistoryScope = { userId: string; fromDate: string; toDate: string; timezone: string; limit: number; start: Date; end: Date };
type HistoryPosition = { completedAt: Date; id: string };

export class TodoHistoryCursor {
  private readonly key: Buffer;
  constructor(secret: string | undefined) {
    if(!secret) throw new ServiceUnavailableException("기록 조회 설정을 확인하지 못했어요.");
    this.key = createHmac("sha256", secret).update("mungsil:todo-history:v1").digest();
  }
  private scopeHash(scope: HistoryScope) {
    return createHash("sha256").update(JSON.stringify([scope.userId, scope.fromDate, scope.toDate, scope.timezone, scope.limit, "current-undeleted-completions:v1"])).digest("hex");
  }
  private signature(payload: string) { return createHmac("sha256", this.key).update(payload).digest(); }
  encode(position: HistoryPosition, scope: HistoryScope): string {
    const payload = Buffer.from(JSON.stringify({ v: 1, scope: this.scopeHash(scope), at: position.completedAt.toISOString(), id: position.id })).toString("base64url");
    return `${payload}.${this.signature(payload).toString("base64url")}`;
  }
  decode(cursor: string, scope: HistoryScope): HistoryPosition {
    try {
      if(typeof cursor !== "string" || cursor.length > 2048 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/.test(cursor)) throw cursorError();
      const [payload, mac] = cursor.split(".");
      const actual = Buffer.from(mac, "base64url");
      if(actual.toString("base64url") !== mac || !timingSafeEqual(actual, this.signature(payload))) throw cursorError();
      const bytes = Buffer.from(payload, "base64url");
      if(bytes.toString("base64url") !== payload) throw cursorError();
      const data: unknown = JSON.parse(bytes.toString("utf8"));
      if(!data || typeof data !== "object" || Array.isArray(data)) throw cursorError();
      const value = data as Record<string, unknown>;
      if(Object.keys(value).sort().join(",") !== "at,id,scope,v" || value.v !== 1 || value.scope !== this.scopeHash(scope) ||
          typeof value.at !== "string" || typeof value.id !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(value.id)) throw cursorError();
      const completedAt = new Date(value.at);
      if(!Number.isFinite(completedAt.getTime()) || completedAt.toISOString() !== value.at || completedAt < scope.start || completedAt >= scope.end) throw cursorError();
      return { completedAt, id: value.id };
    } catch { throw cursorError(); }
  }
}
