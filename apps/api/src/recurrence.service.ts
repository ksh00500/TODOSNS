import { BadRequestException, Injectable } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { Prisma, TodoSeries } from "@prisma/client";
import { PrismaService } from "./prisma.service";
import { CreateTodoDto, UpdateTodoDto } from "./dtos";

const DAY_MS = 86_400_000;
const HORIZON_DAYS = 60;
const WEEKDAY_CODES = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"] as const;

type LocalParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

@Injectable()
export class RecurrenceService {
  constructor(private readonly prisma: PrismaService) {}

  normalizeRule(rule: string) {
    const normalized =
      rule === "DAILY"
        ? "FREQ=DAILY"
        : rule === "WEEKDAYS"
          ? "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR"
          : rule === "WEEKENDS"
            ? "FREQ=WEEKLY;BYDAY=SA,SU"
            : rule === "WEEKLY"
              ? "FREQ=WEEKLY"
              : rule.trim().toUpperCase();
    if (!/^FREQ=(DAILY|WEEKLY)(;BYDAY=(MO|TU|WE|TH|FR|SA|SU)(,(MO|TU|WE|TH|FR|SA|SU))*)?$/.test(normalized)) {
      throw new BadRequestException("지원하지 않는 반복 설정이에요.");
    }
    return normalized;
  }

  async createSeries(userId: string, timezone: string, dto: CreateTodoDto) {
    return this.prisma.$transaction((tx) => this.createSeriesInTransaction(tx, userId, timezone, dto));
  }

  async createSeriesInTransaction(tx: Prisma.TransactionClient, userId: string, timezone: string, dto: CreateTodoDto, sourceTodoId?: string) {
    const repeatRule = this.normalizeRule(dto.repeatRule!);
    const series = await tx.todoSeries.create({
      data: {
        userId,
        title: dto.title,
        notes: dto.notes,
        category: dto.category,
        visibility: dto.visibility,
        repeatRule,
        timezone,
        startAt: new Date(dto.dueDate),
      },
    });
    await this.materialize(tx, series, new Date(Date.now() + HORIZON_DAYS * DAY_MS));
    const first = await tx.todo.findFirstOrThrow({
      where: { seriesId: series.id, deletedAt: null },
      orderBy: { dueDate: "asc" },
    });
    return sourceTodoId
      ? tx.todo.update({ where: { id: first.id }, data: { sourceTodoId } })
      : first;
  }

  async convertTodo(userId: string, todoId: string, timezone: string, dto: CreateTodoDto) {
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.todo.findFirst({ where: { id: todoId, userId, deletedAt: null } });
      if (!existing) throw new BadRequestException("TODO를 찾을 수 없어요.");
      const created = await this.createSeriesInTransaction(tx, userId, timezone, dto, existing.sourceTodoId ?? undefined);
      await tx.todo.update({ where: { id: todoId }, data: { deletedAt: new Date() } });
      return created;
    });
  }

  async updateFuture(userId: string, todoId: string, dto: UpdateTodoDto) {
    return this.prisma.$transaction(async (tx) => {
      const occurrence = await tx.todo.findFirst({
        where: { id: todoId, userId, deletedAt: null },
        include: { series: true },
      });
      if (!occurrence?.series) throw new BadRequestException("반복 일정이 아니에요.");
      const repeatRule = dto.repeatRule
        ? this.normalizeRule(dto.repeatRule)
        : occurrence.series.repeatRule;
      const boundary = occurrence.dueDate;
      await tx.todo.updateMany({
        where: {
          seriesId: occurrence.series.id,
          dueDate: { gte: boundary },
          completedAt: null,
          deletedAt: null,
        },
        data: { deletedAt: new Date(), occurrenceKey: null },
      });
      const series = await tx.todoSeries.update({
        where: { id: occurrence.series.id },
        data: {
          title: dto.title ?? occurrence.series.title,
          notes: dto.notes === undefined ? occurrence.series.notes : dto.notes,
          category: dto.category ?? occurrence.series.category,
          visibility: dto.visibility ?? occurrence.series.visibility,
          repeatRule,
          startAt: dto.dueDate ? new Date(dto.dueDate) : boundary,
          generatedThrough: null,
          active: true,
        },
      });
      await this.materialize(tx, series, new Date(Date.now() + HORIZON_DAYS * DAY_MS));
      return tx.todo.findFirstOrThrow({
        where: { seriesId: series.id, dueDate: { gte: series.startAt }, deletedAt: null },
        orderBy: { dueDate: "asc" },
      });
    });
  }

  async endSeries(userId: string, todoId: string) {
    return this.prisma.$transaction(async (tx) => {
      const occurrence = await tx.todo.findFirst({
        where: { id: todoId, userId, deletedAt: null },
      });
      if (!occurrence?.seriesId) throw new BadRequestException("반복 일정이 아니에요.");
      await tx.todoSeries.update({
        where: { id: occurrence.seriesId },
        data: { active: false, endsAt: occurrence.dueDate },
      });
      await tx.todo.updateMany({
        where: {
          seriesId: occurrence.seriesId,
          dueDate: { gt: occurrence.dueDate },
          completedAt: null,
          deletedAt: null,
        },
        data: { deletedAt: new Date(), occurrenceKey: null },
      });
      return { ok: true };
    });
  }

  async stopSeriesFrom(userId: string, todoId: string, dto: UpdateTodoDto) {
    return this.prisma.$transaction(async (tx) => {
      const occurrence = await tx.todo.findFirst({ where: { id: todoId, userId, deletedAt: null } });
      if (!occurrence?.seriesId) throw new BadRequestException("반복 일정이 아니에요.");
      await tx.todoSeries.update({ where: { id: occurrence.seriesId }, data: { active: false, endsAt: new Date(occurrence.dueDate.getTime() - 1) } });
      await tx.todo.updateMany({ where: { seriesId: occurrence.seriesId, dueDate: { gt: occurrence.dueDate }, completedAt: null, deletedAt: null }, data: { deletedAt: new Date(), occurrenceKey: null } });
      return tx.todo.update({
        where: { id: todoId },
        data: {
          seriesId: null,
          occurrenceKey: null,
          repeatRule: null,
          kind: "SINGLE",
          title: dto.title,
          notes: dto.notes,
          category: dto.category,
          visibility: dto.visibility,
          dueDate: dto.dueDate ? new Date(dto.dueDate) : undefined,
        },
      });
    });
  }

  @Cron("0 10 0 * * *", { timeZone: "UTC" })
  async extendActiveSeries() {
    const target = new Date(Date.now() + HORIZON_DAYS * DAY_MS);
    const series = await this.prisma.todoSeries.findMany({
      where: {
        active: true,
        OR: [{ generatedThrough: null }, { generatedThrough: { lt: target } }],
      },
      take: 500,
    });
    for (const item of series) {
      await this.prisma.$transaction((tx) => this.materialize(tx, item, target));
    }
  }

  private async materialize(
    tx: Prisma.TransactionClient,
    series: TodoSeries,
    target: Date,
  ) {
    const until = series.endsAt && series.endsAt < target ? series.endsAt : target;
    const start = this.partsInZone(series.startAt, series.timezone);
    const cursor = new Date(Date.UTC(start.year, start.month - 1, start.day));
    const endParts = this.partsInZone(until, series.timezone);
    const endCursor = new Date(Date.UTC(endParts.year, endParts.month - 1, endParts.day));
    const rule = this.parseRule(series.repeatRule, series.startAt, series.timezone);
    const rows: Prisma.TodoCreateManyInput[] = [];

    while (cursor <= endCursor) {
      const weekday = WEEKDAY_CODES[cursor.getUTCDay()];
      const matches =
        rule.frequency === "DAILY" ||
        (rule.frequency === "WEEKLY" && rule.days.includes(weekday));
      if (matches) {
        const dueDate = this.zonedDate(
          cursor.getUTCFullYear(),
          cursor.getUTCMonth() + 1,
          cursor.getUTCDate(),
          start.hour,
          start.minute,
          start.second,
          series.timezone,
        );
        if (dueDate >= series.startAt && dueDate <= until) {
          rows.push({
            userId: series.userId,
            seriesId: series.id,
            occurrenceKey: `${series.id}:${dueDate.toISOString()}`,
            title: series.title,
            notes: series.notes,
            category: series.category,
            visibility: series.visibility,
            repeatRule: series.repeatRule,
            kind: "ROUTINE",
            dueDate,
          });
        }
      }
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }

    if (rows.length) await tx.todo.createMany({ data: rows, skipDuplicates: true });
    await tx.todoSeries.update({
      where: { id: series.id },
      data: { generatedThrough: until },
    });
  }

  private parseRule(rule: string, startAt: Date, timezone: string) {
    const [frequencyPart, dayPart] = rule.split(";");
    const frequency = frequencyPart.replace("FREQ=", "") as "DAILY" | "WEEKLY";
    const startWeekday = WEEKDAY_CODES[this.localWeekday(startAt, timezone)];
    const days = dayPart?.startsWith("BYDAY=")
      ? (dayPart.replace("BYDAY=", "").split(",") as Array<(typeof WEEKDAY_CODES)[number]>)
      : [startWeekday];
    return { frequency, days };
  }

  private localWeekday(date: Date, timezone: string) {
    const short = new Intl.DateTimeFormat("en-US", { timeZone: timezone, weekday: "short" }).format(date);
    return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(short);
  }

  private partsInZone(date: Date, timezone: string): LocalParts {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    }).formatToParts(date);
    const value = (type: Intl.DateTimeFormatPartTypes) =>
      Number(parts.find((part) => part.type === type)?.value ?? 0);
    return {
      year: value("year"),
      month: value("month"),
      day: value("day"),
      hour: value("hour"),
      minute: value("minute"),
      second: value("second"),
    };
  }

  private zonedDate(
    year: number,
    month: number,
    day: number,
    hour: number,
    minute: number,
    second: number,
    timezone: string,
  ) {
    const desiredUtc = Date.UTC(year, month - 1, day, hour, minute, second);
    let candidate = new Date(desiredUtc);
    for (let index = 0; index < 2; index += 1) {
      const actual = this.partsInZone(candidate, timezone);
      const actualUtc = Date.UTC(
        actual.year,
        actual.month - 1,
        actual.day,
        actual.hour,
        actual.minute,
        actual.second,
      );
      candidate = new Date(candidate.getTime() + desiredUtc - actualUtc);
    }
    return candidate;
  }
}
