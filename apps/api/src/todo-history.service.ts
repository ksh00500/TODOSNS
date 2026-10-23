import { BadRequestException, Injectable, UnauthorizedException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "./prisma.service";
import { TodoHistoryQueryDto } from "./dtos";
import { historyWindow, TodoHistoryCursor } from "./todo-history";

const historySelect = {
  id: true, title: true, notes: true, dueDate: true, completedAt: true,
  visibility: true, repeatRule: true, category: true, categoryId: true,
  sourceTodoId: true, seriesId: true, occurrenceKey: true,
  categoryRef: { select: { id: true, name: true, baseCategory: true, icon: true, color: true, position: true, isDefault: true, archivedAt: true } },
} satisfies Prisma.TodoSelect;

@Injectable()
export class TodoHistoryService {
  constructor(private readonly prisma: PrismaService) {}

  async list(userId: string, query: TodoHistoryQueryDto) {
    if(typeof userId !== "string" || !userId) throw new UnauthorizedException("로그인이 필요해요.");
    const limit = query.limit ?? 20;
    if(!Number.isInteger(limit) || limit < 1 || limit > 50) throw new BadRequestException("페이지 크기는 1~50 사이의 정수로 입력해주세요.");
    const codec = new TodoHistoryCursor(process.env.JWT_ACCESS_SECRET);
    return this.prisma.$transaction(async (tx) => {
      const user = await tx.user.findFirst({ where: { id: userId, suspendedAt: null, deletionRequestedAt: null }, select: { timezone: true } });
      if(!user) throw new UnauthorizedException("로그인 상태를 다시 확인해주세요.");
      const window = historyWindow(query, user.timezone);
      const scope = { ...window, userId, limit };
      const after = query.cursor === undefined ? null : codec.decode(query.cursor, scope);
      const where = { userId, deletedAt: null, completedAt: { gte: window.start, lt: window.end } } satisfies Prisma.TodoWhereInput;
      const rows = await tx.todo.findMany({
        where: { ...where, ...(after ? { OR: [ { completedAt: { lt: after.completedAt } }, { completedAt: after.completedAt, id: { lt: after.id } } ] } : {}) },
        orderBy: [{ completedAt: "desc" }, { id: "desc" }], take: limit + 1, select: historySelect,
      });
      const total = await tx.todo.count({ where });
      const page = rows.slice(0, limit);
      const last = page.at(-1);
      return {
        items: page.map((row) => ({ ...row, dueDate: row.dueDate.toISOString(), completedAt: row.completedAt!.toISOString(),
          categoryRef: row.categoryRef ? { ...row.categoryRef, archivedAt: row.categoryRef.archivedAt?.toISOString() ?? null } : null })),
        nextCursor: rows.length > limit && last ? codec.encode({ completedAt: last.completedAt!, id: last.id }, scope) : null,
        total, timezone: window.timezone, fromDate: window.fromDate, toDate: window.toDate,
      };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
  }
}
