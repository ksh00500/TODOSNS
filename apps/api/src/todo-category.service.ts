import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { PageDto, CreateTodoCategoryDto, UpdateTodoCategoryDto } from "./dtos";
import { Prisma } from "@prisma/client";
import { PrismaService } from "./prisma.service";

export const TODO_CATEGORY_DEFAULTS = [
  { name: "생활", baseCategory: "생활", icon: "home", color: "aqua" },
  { name: "건강", baseCategory: "건강", icon: "heart", color: "blush" },
  { name: "운동", baseCategory: "운동", icon: "activity", color: "aqua" },
  { name: "공부", baseCategory: "공부", icon: "graduation", color: "butter" },
  { name: "독서", baseCategory: "독서", icon: "book", color: "aqua" },
  { name: "마음", baseCategory: "마음", icon: "brain", color: "blush" },
  { name: "커리어", baseCategory: "커리어", icon: "briefcase", color: "aqua" },
  { name: "취미", baseCategory: "취미", icon: "palette", color: "butter" },
] as const;

export const TODO_BASE_CATEGORIES = new Set(TODO_CATEGORY_DEFAULTS.map((item) => item.baseCategory));

@Injectable()
export class TodoCategoryService {
  constructor(private readonly prisma: PrismaService) {}

  async list(userId: string, includeArchived = false) {
    await this.ensureDefaults(userId);
    const rows = await this.prisma.todoCategory.findMany({
      where: { userId, archivedAt: includeArchived ? undefined : null },
      orderBy: [{ archivedAt: "asc" }, { position: "asc" }, { createdAt: "asc" }],
      include: { _count: { select: { todos: { where: { deletedAt: null } } } } },
    });
    return rows.map(({ _count, ...row }) => ({ ...row, todoCount: _count.todos }));
  }

  async listTodos(userId: string, id: string, page: PageDto, rawStatus = "ALL") {
    await this.ensureDefaults(userId);
    const category = await this.prisma.todoCategory.findFirst({ where: { id, userId } });
    if (!category) throw new NotFoundException("카테고리를 찾을 수 없어요.");
    if (!new Set(["ALL", "OPEN", "DONE"]).has(rawStatus)) throw new BadRequestException("TODO 상태 필터를 확인해주세요.");
    const status = rawStatus as "ALL" | "OPEN" | "DONE";
    const categoryWhere = {
      userId,
      deletedAt: null,
      OR: [
        { categoryId: id },
        ...(category.isDefault ? [{ categoryId: null, category: category.name }] : []),
      ],
    };
    const cursor = this.decodeTodoCursor(page.cursor);
    const statusWhere = status === "OPEN" ? { completedAt: null } : status === "DONE" ? { completedAt: { not: null } } : {};
    const rows = await this.prisma.todo.findMany({
      where: { ...categoryWhere, ...statusWhere, ...(cursor ? { AND: [this.todoCursorWhere(cursor, status)] } : {}) },
      orderBy: status === "OPEN"
        ? [{ dueDate: "asc" as const }, { id: "asc" as const }]
        : [{ completedAt: { sort: "asc" as const, nulls: "first" as const } }, { dueDate: "asc" as const }, { id: "asc" as const }],
      take: page.limit + 1,
      include: { categoryRef: true },
    });
    const [total, open, done] = await Promise.all([
      this.prisma.todo.count({ where: categoryWhere }),
      this.prisma.todo.count({ where: { ...categoryWhere, completedAt: null } }),
      this.prisma.todo.count({ where: { ...categoryWhere, completedAt: { not: null } } }),
    ]);
    const items = rows.slice(0, page.limit);
    const last = items.at(-1);
    return { items, counts: { all: total, open, done }, nextCursor: rows.length > page.limit && last ? this.encodeTodoCursor(last.completedAt, last.dueDate, last.id) : null };
  }

  async create(userId: string, dto: CreateTodoCategoryDto) {
    await this.ensureDefaults(userId);
    if (!TODO_BASE_CATEGORIES.has(dto.baseCategory as typeof TODO_CATEGORY_DEFAULTS[number]["baseCategory"])) throw new BadRequestException("기준 카테고리를 확인해주세요.");
    const active = await this.prisma.todoCategory.count({ where: { userId, archivedAt: null } });
    if (active >= 12) throw new BadRequestException("사용 중인 카테고리는 최대 12개까지 만들 수 있어요.");
    const name = dto.name.trim();
    const duplicate = await this.prisma.todoCategory.findFirst({ where: { userId, name } });
    if (duplicate) throw new ConflictException("이미 같은 이름의 카테고리가 있어요.");
    const position = (await this.prisma.todoCategory.aggregate({ where: { userId, archivedAt: null }, _max: { position: true } }))._max.position ?? -1;
    return this.prisma.todoCategory.create({ data: { userId, name, baseCategory: dto.baseCategory, icon: dto.icon, color: dto.color, position: position + 1 } });
  }

  async update(userId: string, id: string, dto: UpdateTodoCategoryDto) {
    const category = await this.prisma.todoCategory.findFirst({ where: { id, userId } });
    if (!category) throw new NotFoundException("카테고리를 찾을 수 없어요.");
    if (dto.baseCategory && !TODO_BASE_CATEGORIES.has(dto.baseCategory as typeof TODO_CATEGORY_DEFAULTS[number]["baseCategory"])) throw new BadRequestException("기준 카테고리를 확인해주세요.");
    if (category.isDefault && (dto.name || dto.baseCategory || dto.icon || dto.color)) throw new BadRequestException("기본 카테고리는 이름과 기준을 바꿀 수 없어요.");
    if (dto.archived === false) {
      const active = await this.prisma.todoCategory.count({ where: { userId, archivedAt: null } });
      if (active >= 12) throw new BadRequestException("사용 중인 카테고리는 최대 12개까지 둘 수 있어요.");
    }
    if (dto.archived === true && !category.archivedAt) {
      const active = await this.prisma.todoCategory.count({ where: { userId, archivedAt: null } });
      if (active <= 1) throw new BadRequestException("TODO를 만들려면 카테고리를 하나 이상 남겨주세요.");
    }
    const { archived, ...changes } = dto;
    return this.prisma.todoCategory.update({ where: { id }, data: { ...changes, name: changes.name?.trim(), archivedAt: archived === undefined ? undefined : archived ? new Date() : null } });
  }

  async reorder(userId: string, ids: string[]) {
    const uniqueIds = [...new Set(ids)];
    const owned = await this.prisma.todoCategory.count({ where: { userId, id: { in: uniqueIds }, archivedAt: null } });
    if (owned !== uniqueIds.length) throw new BadRequestException("카테고리 순서를 확인해주세요.");
    await this.prisma.$transaction(uniqueIds.map((id, position) => this.prisma.todoCategory.update({ where: { id }, data: { position } })));
    return this.list(userId);
  }

  async ensureDefaults(userId: string) {
    await this.prisma.todoCategory.createMany({ data: TODO_CATEGORY_DEFAULTS.map((item, position) => ({ userId, ...item, position, isDefault: true })), skipDuplicates: true });
    const [unassignedTodo, unassignedSeries] = await Promise.all([
      this.prisma.todo.findFirst({ where: { userId, categoryId: null }, select: { id: true } }),
      this.prisma.todoSeries.findFirst({ where: { userId, categoryId: null }, select: { id: true } }),
    ]);
    if (!unassignedTodo && !unassignedSeries) return;
    const defaults = await this.prisma.todoCategory.findMany({ where: { userId, isDefault: true }, select: { id: true, baseCategory: true } });
    await this.prisma.$transaction(defaults.flatMap((category) => [
      ...(unassignedTodo ? [this.prisma.todo.updateMany({ where: { userId, categoryId: null, category: category.baseCategory }, data: { categoryId: category.id } })] : []),
      ...(unassignedSeries ? [this.prisma.todoSeries.updateMany({ where: { userId, categoryId: null, category: category.baseCategory }, data: { categoryId: category.id } })] : []),
    ]));
  }

  async resolve(userId: string, categoryId?: string | null, fallback = "생활", allowArchived = false, client: Prisma.TransactionClient = this.prisma) {
    if (categoryId) {
      const category = await client.todoCategory.findFirst({ where: { id: categoryId, userId, archivedAt: allowArchived ? undefined : null } });
      if (!category) throw new BadRequestException("사용할 수 있는 카테고리를 선택해주세요.");
      return { category: category.baseCategory, categoryId: category.id };
    }
    return { category: fallback, categoryId: null };
  }

  private encodeTodoCursor(completedAt: Date | null, dueDate: Date, id: string) {
    return Buffer.from(JSON.stringify({ completedAt: completedAt?.toISOString() ?? null, dueDate: dueDate.toISOString(), id })).toString("base64url");
  }

  private decodeTodoCursor(value?: string) {
    if (!value) return null;
    try {
      const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as { completedAt: string | null; dueDate: string; id: string };
      const completedAt = parsed.completedAt ? new Date(parsed.completedAt) : null;
      const dueDate = new Date(parsed.dueDate);
      if (!parsed.id || Number.isNaN(dueDate.getTime()) || completedAt && Number.isNaN(completedAt.getTime())) throw new Error();
      return { completedAt, dueDate, id: parsed.id };
    } catch {
      throw new BadRequestException("잘못된 카테고리 TODO 목록 요청이에요.");
    }
  }

  private todoCursorWhere(cursor: { completedAt: Date | null; dueDate: Date; id: string }, status: "ALL" | "OPEN" | "DONE") {
    const afterDueDate = { OR: [{ dueDate: { gt: cursor.dueDate } }, { dueDate: cursor.dueDate, id: { gt: cursor.id } }] };
    if (status === "OPEN") return afterDueDate;
    if (cursor.completedAt === null) return { OR: [{ completedAt: null, ...afterDueDate }, { completedAt: { not: null } }] };
    return { OR: [{ completedAt: { gt: cursor.completedAt } }, { completedAt: cursor.completedAt, ...afterDueDate }] };
  }
}
