import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { createHash, randomBytes } from "node:crypto";
import { ChallengeKind, CheckInStatus, ConversationKind, NotificationType, Prisma, ReportTarget, RequestStatus, RewardStatus, VerificationMode, VerificationVoteVerdict, Visibility } from "@prisma/client";
import { PrismaService } from "./prisma.service";
import { MediaService } from "./media.service";
import { AdminContentQueryDto, AdminUserQueryDto, CheckInDto, CloneTodoDto, CloneTodoListDto, CloneTodoListRepeatMode, CompleteTodoDto, CreateChallengeDto, CreateInviteCodeDto, CreatePostDto, CreateReportDto, CreateTodoCategoryDto, CreateTodoDto, CreateTodoListDto, PageDto, SearchDto, SendMessageDto, UpdateChallengeDto, UpdateProfileDto, UpdateTodoCategoryDto, UpdateTodoDto, UpdateTodoListDto, VerificationQueueDto, VerificationVoteDto } from "./dtos";
import { RecurrenceService } from "./recurrence.service";
import { challengeLeaderboard, challengeTotalDays, PEER_VERIFICATION, peerVerificationDecision, peerVoteVerdict } from "./challenge-policy";
import { ChallengeChatService } from "./challenge-chat.service";

const COMMUNITY_CHALLENGE_COST = 500;
const TODO_CATEGORY_DEFAULTS = [
  { name: "생활", baseCategory: "생활", icon: "home", color: "aqua" },
  { name: "건강", baseCategory: "건강", icon: "heart", color: "blush" },
  { name: "운동", baseCategory: "운동", icon: "activity", color: "aqua" },
  { name: "공부", baseCategory: "공부", icon: "graduation", color: "butter" },
  { name: "독서", baseCategory: "독서", icon: "book", color: "aqua" },
  { name: "마음", baseCategory: "마음", icon: "brain", color: "blush" },
  { name: "커리어", baseCategory: "커리어", icon: "briefcase", color: "aqua" },
  { name: "취미", baseCategory: "취미", icon: "palette", color: "butter" },
] as const;
const TODO_BASE_CATEGORIES = new Set(TODO_CATEGORY_DEFAULTS.map((item) => item.baseCategory));
const DEFAULT_VERIFICATION_CRITERIA = [
  "사진만 보고 오늘 실천을 완료했다고 판단할 수 있나요?",
  "사진이 챌린지 주제와 맞나요?",
  "재사용하거나 조작한 흔적 없이 자연스러운 인증인가요?",
];
export const rankOf = (power: number) => power >= 5000 ? "별구름" : power >= 2000 ? "노을구름" : power >= 800 ? "뭉게구름" : power >= 300 ? "솜구름" : power >= 100 ? "조각구름" : "구름씨앗";
export const cloneListRepeatRule = (mode: CloneTodoListRepeatMode, sourceRule: string | null, overrideRule?: string | null) => mode === CloneTodoListRepeatMode.NONE ? null : mode === CloneTodoListRepeatMode.CUSTOM && overrideRule !== undefined ? overrideRule : sourceRule;
export const normalizeHashtags = (values: string[]) => {
  const normalized = values.map((value) => value.normalize("NFKC").trim().replace(/^#+/, "").toLocaleLowerCase("ko"));
  if (normalized.some((value) => !value || value.length > 30 || !/^[\p{L}\p{N}_]+$/u.test(value))) {
    throw new BadRequestException("해시태그는 글자, 숫자, 밑줄만 사용할 수 있어요.");
  }
  return [...new Set(normalized)].slice(0, 5);
};

const captionHashtags = (caption?: string) => [...(caption ?? "").matchAll(/(?:^|\s)#([\p{L}\p{N}_]{1,30})/gu)].map((match) => match[1]);

const postRelations = (viewerId: string | null) => ({
  author: { select: { id: true, nickname: true, handle: true, avatarUrl: true, avatarMedia: true, lifetimePower: true } },
  todos: { include: { todo: { include: { categoryRef: true, _count: { select: { copies: { where: { deletedAt: null } } } } } } }, orderBy: { order: "asc" as const } },
  todoList: { include: { items: { include: { todo: { include: { categoryRef: true } } }, orderBy: { order: "asc" as const } }, _count: { select: { copies: true } } } },
  media: { where: { status: "READY" as const }, orderBy: { createdAt: "asc" as const }, take: 1 },
  tags: { include: { tag: true }, orderBy: { tag: { name: "asc" as const } } },
  _count: { select: { cheers: true, comments: { where: { hiddenAt: null } } } },
  cheers: { where: { userId: viewerId ?? "__guest__" }, select: { userId: true } },
}) satisfies Prisma.PostInclude;

type PostRow = Prisma.PostGetPayload<{ include: ReturnType<typeof postRelations> }>;

@Injectable()
export class MungsilService {
  constructor(private readonly prisma: PrismaService, private readonly media: MediaService, private readonly recurrence: RecurrenceService, private readonly chat: ChallengeChatService) {}

  private async reward(userId: string, amount: number, reason: string, referenceId: string, dailyCap?: number) {
    if (dailyCap) {
      const { start, end } = await this.userDayWindow(userId);
      const count = await this.prisma.pointLedger.count({ where: { userId, reason, createdAt: { gte: start, lt: end } } });
      if (count >= dailyCap) return false;
    }
    try {
      await this.prisma.$transaction([
        this.prisma.pointLedger.create({ data: { userId, amount, reason, referenceId } }),
        this.prisma.user.update({ where: { id: userId }, data: { availablePoints: { increment: amount }, lifetimePower: { increment: Math.max(amount, 0) }, recentVitality: { increment: Math.max(amount, 0) } } }),
      ]);
      return true;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return false;
      throw error;
    }
  }

  async profile(userId: string) {
    const [user, completedCount, receivedCheers, copiedCount, earnedTitles] = await Promise.all([
      this.prisma.user.findUniqueOrThrow({ where: { id: userId }, include: { avatarMedia: true, _count: { select: { followers: true, following: true, posts: { where: { hiddenAt: null } } } } } }),
      this.prisma.todo.count({ where: { userId, completedAt: { not: null }, deletedAt: null } }),
      this.prisma.cheer.count({ where: { post: { authorId: userId, hiddenAt: null } } }),
      this.prisma.todo.count({ where: { sourceTodo: { userId }, deletedAt: null } }),
      this.prisma.challengeParticipant.findMany({ where: { userId, titleAwarded: { not: null } }, orderBy: { completedAt: "desc" }, take: 12, select: { titleAwarded: true, finalRank: true, challenge: { select: { id: true, title: true } } } }),
    ]);
    const avatarUrl = user.avatarMedia ? await this.media.viewUrl(user.avatarMedia.thumbnailKey ?? user.avatarMedia.objectKey) : user.avatarUrl;
    return { ...user, avatarMedia: undefined, avatarUrl, passwordHash: undefined, rank: rankOf(user.lifetimePower), stats: { completedCount, receivedCheers, copiedCount }, earnedTitles };
  }
  async updateProfile(userId: string, dto: UpdateProfileDto) {
    const { avatarMediaId, onboardingCompleted, ...changes } = dto;
    if (changes.timezone) {
      try { new Intl.DateTimeFormat("ko-KR", { timeZone: changes.timezone }).format(); }
      catch { throw new BadRequestException("올바른 시간대를 선택해주세요."); }
    }
    if (avatarMediaId) await this.media.setAvatar(userId, avatarMediaId);
    await this.prisma.user.update({ where: { id: userId }, data: { ...changes, onboardingCompletedAt: onboardingCompleted ? new Date() : undefined } });
    return this.profile(userId);
  }

  async listTodoCategories(userId: string, includeArchived = false) {
    await this.ensureTodoCategories(userId);
    const rows = await this.prisma.todoCategory.findMany({
      where: { userId, archivedAt: includeArchived ? undefined : null },
      orderBy: [{ archivedAt: "asc" }, { position: "asc" }, { createdAt: "asc" }],
      include: { _count: { select: { todos: { where: { deletedAt: null } } } } },
    });
    return rows.map(({ _count, ...row }) => ({ ...row, todoCount: _count.todos }));
  }

  async listTodoCategoryTodos(userId: string, id: string) {
    await this.ensureTodoCategories(userId);
    const category = await this.prisma.todoCategory.findFirst({ where: { id, userId } });
    if (!category) throw new NotFoundException("카테고리를 찾을 수 없어요.");
    return this.prisma.todo.findMany({
      where: {
        userId,
        deletedAt: null,
        OR: [
          { categoryId: id },
          ...(category.isDefault ? [{ categoryId: null, category: category.name }] : []),
        ],
      },
      orderBy: [{ completedAt: "asc" }, { dueDate: "asc" }],
      include: { categoryRef: true },
    });
  }

  async createTodoCategory(userId: string, dto: CreateTodoCategoryDto) {
    await this.ensureTodoCategories(userId);
    if (!TODO_BASE_CATEGORIES.has(dto.baseCategory as typeof TODO_CATEGORY_DEFAULTS[number]["baseCategory"])) throw new BadRequestException("기준 카테고리를 확인해주세요.");
    const active = await this.prisma.todoCategory.count({ where: { userId, archivedAt: null } });
    if (active >= 12) throw new BadRequestException("사용 중인 카테고리는 최대 12개까지 만들 수 있어요.");
    const name = dto.name.trim();
    const duplicate = await this.prisma.todoCategory.findFirst({ where: { userId, name } });
    if (duplicate) throw new ConflictException("이미 같은 이름의 카테고리가 있어요.");
    const position = (await this.prisma.todoCategory.aggregate({ where: { userId, archivedAt: null }, _max: { position: true } }))._max.position ?? -1;
    return this.prisma.todoCategory.create({ data: { userId, name, baseCategory: dto.baseCategory, icon: dto.icon, color: dto.color, position: position + 1 } });
  }

  async updateTodoCategory(userId: string, id: string, dto: UpdateTodoCategoryDto) {
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

  async reorderTodoCategories(userId: string, ids: string[]) {
    const uniqueIds = [...new Set(ids)];
    const owned = await this.prisma.todoCategory.count({ where: { userId, id: { in: uniqueIds }, archivedAt: null } });
    if (owned !== uniqueIds.length) throw new BadRequestException("카테고리 순서를 확인해주세요.");
    await this.prisma.$transaction(uniqueIds.map((id, position) => this.prisma.todoCategory.update({ where: { id }, data: { position } })));
    return this.listTodoCategories(userId);
  }

  async createTodo(userId: string, dto: CreateTodoDto) {
    const { todoListId, ...todoInput } = dto;
    if (todoListId) await this.ownTodoList(userId, todoListId);
    const category = await this.resolveTodoCategory(userId, todoInput.categoryId, todoInput.category);
    todoInput.category = category.category;
    todoInput.categoryId = category.categoryId;
    let todo;
    if (todoInput.repeatRule) {
      const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { timezone: true } });
      todo = await this.recurrence.createSeries(userId, user.timezone, todoInput);
    } else {
      todo = await this.prisma.todo.create({ data: { ...todoInput, userId, dueDate: new Date(todoInput.dueDate), kind: "SINGLE" } });
    }
    if (todoListId) await this.setTodoListMembership(userId, todo, todoListId);
    return this.prisma.todo.findUniqueOrThrow({ where: { id: todo.id }, include: { categoryRef: true } });
  }
  listTodos(userId: string, from?: string, to?: string) { return this.prisma.todo.findMany({ where: { userId, deletedAt: null, dueDate: { gte: from ? new Date(from) : undefined, lte: to ? new Date(to) : undefined } }, orderBy: [{ completedAt: "asc" }, { dueDate: "asc" }], include: { categoryRef: true } }); }

  listTodoLists(userId: string) { return this.prisma.todoList.findMany({ where: { userId }, orderBy: { updatedAt: "desc" }, include: { items: { include: { todo: { include: { categoryRef: true } } }, orderBy: { order: "asc" } }, _count: { select: { copies: true } } } }); }

  async createTodoList(userId: string, dto: CreateTodoListDto) {
    const todoIds = [...new Set(dto.todoIds)];
    const owned = await this.prisma.todo.findMany({ where: { id: { in: todoIds }, userId, deletedAt: null }, select: { id: true, seriesId: true } });
    if (owned.length !== todoIds.length) throw new ForbiddenException("내 TODO만 리스트에 담을 수 있어요.");
    const seriesIds = owned.flatMap((todo) => todo.seriesId ? [todo.seriesId] : []);
    const grouped = await this.prisma.todoListItem.findFirst({ where: { list: { userId }, OR: [{ todoId: { in: todoIds } }, ...(seriesIds.length ? [{ todo: { seriesId: { in: seriesIds } } }] : [])] } });
    if (grouped) throw new BadRequestException("이미 다른 루틴 그룹에 담긴 TODO가 있어요.");
    return this.prisma.todoList.create({ data: { userId, title: dto.title, description: dto.description, visibility: dto.visibility, items: { create: todoIds.map((todoId, order) => ({ todoId, order })) } }, include: { items: { include: { todo: { include: { categoryRef: true } } }, orderBy: { order: "asc" } }, _count: { select: { copies: true } } } });
  }

  async updateTodoList(userId: string, id: string, dto: UpdateTodoListDto) {
    await this.ownTodoList(userId, id);
    if (dto.todoIds) {
      const todoIds = [...new Set(dto.todoIds)];
      const owned = await this.prisma.todo.findMany({ where: { id: { in: todoIds }, userId, deletedAt: null }, select: { id: true, seriesId: true } });
      if (owned.length !== todoIds.length) throw new ForbiddenException("내 TODO만 리스트에 담을 수 있어요.");
      const seriesIds = owned.flatMap((todo) => todo.seriesId ? [todo.seriesId] : []);
      const grouped = await this.prisma.todoListItem.findFirst({ where: { list: { userId, id: { not: id } }, OR: [{ todoId: { in: todoIds } }, ...(seriesIds.length ? [{ todo: { seriesId: { in: seriesIds } } }] : [])] } });
      if (grouped) throw new BadRequestException("이미 다른 루틴 그룹에 담긴 TODO가 있어요.");
      return this.prisma.$transaction(async (tx) => {
        await tx.todoListItem.deleteMany({ where: { listId: id } });
        return tx.todoList.update({ where: { id }, data: { title: dto.title, description: dto.description, visibility: dto.visibility, items: { create: todoIds.map((todoId, order) => ({ todoId, order })) } }, include: { items: { include: { todo: { include: { categoryRef: true } } }, orderBy: { order: "asc" } }, _count: { select: { copies: true } } } });
      });
    }
    return this.prisma.todoList.update({ where: { id }, data: dto, include: { items: { include: { todo: { include: { categoryRef: true } } }, orderBy: { order: "asc" } }, _count: { select: { copies: true } } } });
  }

  async removeTodoList(userId: string, id: string) { await this.ownTodoList(userId, id); const shared = await this.prisma.post.count({ where: { todoListId: id, hiddenAt: null } }); if (shared) throw new BadRequestException("게시 중인 루틴은 삭제할 수 없어요."); await this.prisma.todoList.delete({ where: { id } }); return { ok: true }; }

  async cloneTodoList(userId: string, id: string, dto: CloneTodoListDto) {
    const source = await this.readableTodoList(userId, id);
    const baseDate = dto.dueDate ? new Date(dto.dueDate) : new Date();
    const sourceBase = source.items.reduce((minimum, item) => Math.min(minimum, item.todo.dueDate.getTime()), source.items[0]?.todo.dueDate.getTime() ?? baseDate.getTime());
    const sourceIds = new Set(source.items.map((item) => item.todo.id));
    const overrides = new Map((dto.items ?? []).map((item) => [item.sourceTodoId, item]));
    if (overrides.size !== (dto.items?.length ?? 0) || [...overrides.keys()].some((todoId) => !sourceIds.has(todoId))) {
      throw new BadRequestException("가져올 루틴의 TODO 설정을 확인해주세요.");
    }
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { timezone: true } });
    const cloned = await this.prisma.$transaction(async (tx) => {
      const list = await tx.todoList.create({ data: { userId, sourceTodoListId: source.id, title: dto.title ?? source.title, description: source.description, visibility: Visibility.PRIVATE } });
      for (const item of source.items) {
        const override = overrides.get(item.todo.id);
        const dueDate = override?.dueDate ? new Date(override.dueDate) : new Date(baseDate.getTime() + item.todo.dueDate.getTime() - sourceBase);
        const repeatRule = cloneListRepeatRule(dto.repeatMode, item.todo.repeatRule, override?.repeatRule);
        const title = override?.title ?? item.todo.title;
        const category = override?.category ?? item.todo.category;
        const todo = repeatRule
          ? await this.recurrence.createSeriesInTransaction(tx, userId, user.timezone, { title, notes: item.todo.notes ?? undefined, category, dueDate: dueDate.toISOString(), repeatRule, visibility: Visibility.PRIVATE }, item.todo.id)
          : await tx.todo.create({ data: { userId, sourceTodoId: item.todo.id, title, notes: item.todo.notes, category, dueDate, kind: "SINGLE", visibility: Visibility.PRIVATE } });
        await tx.todoListItem.create({ data: { listId: list.id, todoId: todo.id, order: item.order } });
      }
      const cloned = await tx.todoList.findUniqueOrThrow({ where: { id: list.id }, include: { items: { include: { todo: true }, orderBy: { order: "asc" } }, _count: { select: { copies: true } } } });
      if (source.userId !== userId) {
        await tx.notification.create({ data: { userId: source.userId, type: NotificationType.COPY, title: "루틴을 가져갔어요", body: "누군가 회원님의 루틴을 자신의 하루에 담았어요.", referenceId: source.id, targetType: "TODO_LIST", targetId: source.id } });
      }
      return cloned;
    });
    if (source.userId !== userId) await this.reward(source.userId, 5, "UNIQUE_LIST_COPY", cloned.id, 3);
    return cloned;
  }

  async updateTodo(userId: string, todoId: string, dto: UpdateTodoDto) {
    const todo = await this.ownTodo(userId, todoId);
    if (dto.todoListId) await this.ownTodoList(userId, dto.todoListId);
    if (dto.categoryId !== undefined) {
      const category = await this.resolveTodoCategory(userId, dto.categoryId, dto.category ?? todo.category, dto.categoryId === todo.categoryId);
      dto.category = category.category;
      dto.categoryId = category.categoryId;
    }
    let updated;
    if (todo.seriesId && dto.recurrenceScope === "FUTURE") {
      updated = await (dto.repeatRule === null
        ? this.recurrence.stopSeriesFrom(userId, todoId, dto)
        : this.recurrence.updateFuture(userId, todoId, dto));
    } else if (todo.seriesId && dto.repeatRule === null) {
      updated = await this.prisma.todo.update({
        where: { id: todoId },
        data: {
          seriesId: null,
          occurrenceKey: null,
          repeatRule: null,
          kind: "SINGLE",
          title: dto.title,
          notes: dto.notes,
          category: dto.category,
          categoryId: dto.categoryId,
          visibility: dto.visibility,
          dueDate: dto.dueDate ? new Date(dto.dueDate) : undefined,
        },
      });
    } else if (!todo.seriesId && dto.repeatRule) {
      const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { timezone: true } });
      const merged: CreateTodoDto = {
        title: dto.title ?? todo.title,
        notes: dto.notes === undefined ? todo.notes ?? undefined : dto.notes,
        category: dto.category ?? todo.category,
        categoryId: dto.categoryId === undefined ? todo.categoryId : dto.categoryId,
        dueDate: dto.dueDate ?? todo.dueDate.toISOString(),
        repeatRule: dto.repeatRule,
        visibility: dto.visibility ?? todo.visibility,
      };
      updated = await this.recurrence.convertTodo(userId, todoId, user.timezone, merged);
    } else {
      updated = await this.prisma.todo.update({
        where: { id: todoId },
        data: {
          title: dto.title,
          notes: dto.notes,
          category: dto.category,
          categoryId: dto.categoryId,
          repeatRule: dto.repeatRule,
          visibility: dto.visibility,
          dueDate: dto.dueDate ? new Date(dto.dueDate) : undefined,
        },
      });
    }
    if (dto.todoListId !== undefined) {
      await this.preserveDetachedSeriesMembership(userId, todo, updated);
      await this.setTodoListMembership(userId, updated, dto.todoListId, todo.id);
    }
    return this.prisma.todo.findUniqueOrThrow({ where: { id: updated.id }, include: { categoryRef: true } });
  }

  async removeTodo(userId: string, todoId: string) {
    await this.ownTodo(userId, todoId);
    const shared = await this.prisma.postTodo.count({ where: { todoId, post: { hiddenAt: null } } });
    if (shared) throw new BadRequestException("게시물을 먼저 삭제한 뒤 TODO를 삭제해주세요.");
    return this.prisma.todo.update({ where: { id: todoId }, data: { deletedAt: new Date() } });
  }

  async restoreTodo(userId: string, todoId: string) {
    const todo = await this.prisma.todo.findFirst({ where: { id: todoId, userId, deletedAt: { not: null } } });
    if (!todo) throw new NotFoundException("복구할 TODO를 찾을 수 없어요.");
    return this.prisma.todo.update({ where: { id: todoId }, data: { deletedAt: null } });
  }

  async endTodoSeries(userId: string, todoId: string) { return this.recurrence.endSeries(userId, todoId); }

  async completeTodo(userId: string, todoId: string, dto: CompleteTodoDto) {
    const todo = await this.ownTodo(userId, todoId);
    if (!todo.completedAt) { await this.prisma.todo.update({ where: { id: todoId }, data: { completedAt: new Date() } }); await this.reward(userId, 10, "TODO_COMPLETE", todoId, 5); }
    const post = dto.share ? await this.createPost(userId, { todoId, caption: dto.caption, mediaId: dto.mediaId, hashtags: dto.hashtags, visibility: dto.visibility }) : null;
    return { todo: await this.prisma.todo.findUniqueOrThrow({ where: { id: todoId } }), post, sharePrompt: !dto.share };
  }

  async uncompleteTodo(userId: string, todoId: string) {
    await this.ownTodo(userId, todoId);
    const shared = await this.prisma.postTodo.count({ where: { todoId, post: { hiddenAt: null } } });
    if (shared) throw new BadRequestException("게시물을 먼저 삭제한 뒤 완료를 취소해주세요.");
    return this.prisma.todo.update({ where: { id: todoId }, data: { completedAt: null } });
  }

  async cloneTodo(userId: string, sourceId: string, dto: CloneTodoDto) {
    const source = await this.readableTodo(userId, sourceId);
    if (dto.todoListId) await this.ownTodoList(userId, dto.todoListId);
    const selectedCategory = dto.categoryId ? await this.resolveTodoCategory(userId, dto.categoryId, dto.category ?? source.category) : { category: dto.category ?? source.category, categoryId: null };
    const repeatRule = dto.keepRepeat ? (dto.repeatRule ?? source.repeatRule) : null;
    const dueDate = dto.dueDate ?? new Date().toISOString();
    const todo = repeatRule
      ? await this.prisma.$transaction(async (tx) => {
          const user = await tx.user.findUniqueOrThrow({ where: { id: userId }, select: { timezone: true } });
          return this.recurrence.createSeriesInTransaction(tx, userId, user.timezone, { title: dto.title ?? source.title, notes: dto.notes ?? source.notes ?? undefined, category: selectedCategory.category, categoryId: selectedCategory.categoryId, dueDate, repeatRule, visibility: dto.visibility ?? Visibility.PRIVATE }, source.id);
        })
      : await this.prisma.todo.create({ data: { userId, sourceTodoId: source.id, title: dto.title ?? source.title, notes: dto.notes ?? source.notes, category: selectedCategory.category, categoryId: selectedCategory.categoryId, dueDate: new Date(dueDate), kind: "SINGLE", visibility: dto.visibility ?? Visibility.PRIVATE } });
    if (dto.todoListId) await this.setTodoListMembership(userId, todo, dto.todoListId);
    if (source.userId !== userId) {
      await this.reward(source.userId, 5, "UNIQUE_COPY", todo.id, 3);
      await this.notify(source.userId, NotificationType.COPY, "실천을 가져갔어요", "누군가 회원님의 TODO를 자신의 하루에 담았어요.", source.id, "TODO", source.id);
    }
    return todo;
  }

  async createPost(userId: string, dto: CreatePostDto) {
    if (Boolean(dto.todoId) === Boolean(dto.todoListId)) throw new BadRequestException("TODO 또는 TODO 리스트 하나를 선택해주세요.");
    if (dto.mediaId) await this.media.readyOwned(userId, dto.mediaId);
    let todoId: string | undefined;
    if (dto.todoId) {
      const todo = await this.ownTodo(userId, dto.todoId);
      if (!todo.completedAt) throw new BadRequestException("완료한 TODO만 게시할 수 있어요.");
      todoId = todo.id;
    }
    if (dto.todoListId) {
      const list = await this.ownTodoList(userId, dto.todoListId);
      const count = await this.prisma.todoListItem.count({ where: { listId: list.id } });
      if (!count) throw new BadRequestException("비어 있는 TODO 리스트는 게시할 수 없어요.");
    }
    const hashtags = normalizeHashtags([...(dto.hashtags ?? []), ...captionHashtags(dto.caption)]);
    const created = await this.prisma.post.create({ data: {
      authorId: userId,
      caption: dto.caption,
      visibility: dto.visibility,
      todoListId: dto.todoListId,
      todos: todoId ? { create: { todoId } } : undefined,
      tags: hashtags.length ? { create: hashtags.map((name) => ({ tag: { connectOrCreate: { where: { name }, create: { name } } } })) } : undefined,
    } });
    if (dto.mediaId) {
      try {
        await this.media.attachToPost(userId, dto.mediaId, created.id);
      } catch (error) {
        await this.prisma.post.delete({ where: { id: created.id } }).catch(() => undefined);
        throw error;
      }
    }
    const post = await this.prisma.post.findUniqueOrThrow({ where: { id: created.id }, include: postRelations(userId) });
    await this.reward(userId, 5, "SHARE", post.id, 2);
    return this.serializePost(post);
  }

  async feed(userId: string | null, page: PageDto, _mode = "mix", category = "전체") {
    const blocked = userId ? await this.prisma.block.findMany({ where: { OR: [{ blockerId: userId }, { blockedId: userId }] } }) : [];
    const hiddenIds = blocked.map((b) => b.blockerId === userId ? b.blockedId : b.blockerId);
    const visibility: Prisma.PostWhereInput[] = [{ visibility: Visibility.PUBLIC }];
    if (userId) visibility.push({ authorId: userId }, { visibility: Visibility.FOLLOWERS, author: { followers: { some: { followerId: userId } } } });
    const categoryFilter: Prisma.PostWhereInput | undefined = category && category !== "전체" ? { OR: [{ todos: { some: { todo: { category } } } }, { todoList: { items: { some: { todo: { category } } } } }] } : undefined;
    const cursor = this.decodeCursor(page.cursor);
    const cursorFilter: Prisma.PostWhereInput | undefined = cursor ? { OR: [{ createdAt: { lt: cursor.createdAt } }, { createdAt: cursor.createdAt, id: { lt: cursor.id } }] } : undefined;
    const filters = [categoryFilter, cursorFilter].filter(Boolean) as Prisma.PostWhereInput[];
    const rows = await this.prisma.post.findMany({ take: page.limit + 1, where: { hiddenAt: null, authorId: { notIn: hiddenIds }, author: { suspendedAt: null, deletionRequestedAt: null }, OR: visibility, AND: filters }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], include: postRelations(userId) });
    const visibleRows = rows.slice(0, page.limit);
    const last = visibleRows.at(-1);
    const nextCursor = rows.length > page.limit && last ? this.encodeCursor(last.createdAt, last.id) : null;
    return { items: await Promise.all(visibleRows.map((post) => this.serializePost(post))), nextCursor };
  }

  async postDetail(postId: string, userId: string | null) { return this.serializePost(await this.readablePost(postId, userId)); }

  async postComments(postId: string, userId: string | null) {
    await this.readablePost(postId, userId);
    const hiddenIds = await this.blockedUserIds(userId);
    const comments = await this.prisma.comment.findMany({ where: { postId, hiddenAt: null, authorId: { notIn: hiddenIds }, author: { suspendedAt: null, deletionRequestedAt: null } }, orderBy: { createdAt: "asc" }, include: { author: { select: { id: true, nickname: true, handle: true, avatarUrl: true, avatarMedia: true, lifetimePower: true } } } });
    return Promise.all(comments.map(async (comment) => ({ ...comment, author: await this.serializeUserSummary(comment.author) })));
  }

  async publicProfile(handle: string, viewerId: string | null) {
    const user = await this.prisma.user.findFirst({ where: { handle, suspendedAt: null, deletionRequestedAt: null }, select: { id: true, nickname: true, handle: true, avatarUrl: true, avatarMedia: true, bio: true, lifetimePower: true, recentVitality: true, _count: { select: { followers: true, following: true, posts: { where: { hiddenAt: null, visibility: Visibility.PUBLIC } } } } } });
    if (!user) throw new NotFoundException("사용자를 찾을 수 없어요.");
    if (viewerId) await this.assertNotBlocked(viewerId, user.id);
    const avatarUrl = user.avatarMedia ? await this.media.viewUrl(user.avatarMedia.thumbnailKey ?? user.avatarMedia.objectKey) : user.avatarUrl;
    return { ...user, avatarMedia: undefined, avatarUrl, rank: rankOf(user.lifetimePower) };
  }

  async publicUserPosts(handle: string, page: PageDto, viewerId: string | null) {
    const user = await this.prisma.user.findFirst({ where: { handle, suspendedAt: null, deletionRequestedAt: null }, select: { id: true } });
    if (!user) throw new NotFoundException("사용자를 찾을 수 없어요.");
    if (viewerId) await this.assertNotBlocked(viewerId, user.id);
    const cursor = this.decodeCursor(page.cursor);
    const rows = await this.prisma.post.findMany({
      take: page.limit + 1,
      where: {
        authorId: user.id,
        visibility: Visibility.PUBLIC,
        hiddenAt: null,
        ...(cursor ? { OR: [{ createdAt: { lt: cursor.createdAt } }, { createdAt: cursor.createdAt, id: { lt: cursor.id } }] } : {}),
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      include: postRelations(viewerId),
    });
    const visibleRows = rows.slice(0, page.limit);
    const last = visibleRows.at(-1);
    return {
      items: await Promise.all(visibleRows.map((post) => this.serializePost(post))),
      nextCursor: rows.length > page.limit && last ? this.encodeCursor(last.createdAt, last.id) : null,
    };
  }

  async publicSearch(query: SearchDto, viewerId: string | null) {
    const rawText = query.query.trim();
    const text = rawText.replace(/^[@#]/, "").trim();
    if (!text) throw new BadRequestException("검색어를 입력해주세요.");
    const hiddenIds = await this.blockedUserIds(viewerId);
    const publicPostWhere: Prisma.PostWhereInput = {
      visibility: Visibility.PUBLIC,
      hiddenAt: null,
      authorId: { notIn: hiddenIds },
      author: { suspendedAt: null, deletionRequestedAt: null },
    };
    const postSearch: Prisma.PostWhereInput = {
      OR: [
        { caption: { contains: text, mode: "insensitive" } },
        { tags: { some: { tag: { name: { contains: text.toLocaleLowerCase("ko"), mode: "insensitive" } } } } },
        { todos: { some: { todo: { title: { contains: text, mode: "insensitive" }, deletedAt: null } } } },
        { todos: { some: { todo: { category: { contains: text, mode: "insensitive" }, deletedAt: null } } } },
        { todoList: { title: { contains: text, mode: "insensitive" } } },
        { todoList: { description: { contains: text, mode: "insensitive" } } },
        { todoList: { items: { some: { todo: { title: { contains: text, mode: "insensitive" }, deletedAt: null } } } } },
      ],
    };
    const tagWhere: Prisma.TagWhereInput = {
      name: { contains: text.toLocaleLowerCase("ko"), mode: "insensitive" },
      posts: { some: { post: publicPostWhere } },
    };
    const challengeWhere: Prisma.ChallengeWhereInput = {
      hiddenAt: null,
      endsAt: { gte: new Date() },
      creatorId: { notIn: hiddenIds },
      creator: { suspendedAt: null, deletionRequestedAt: null },
      OR: [
        { title: { contains: text, mode: "insensitive" } },
        { description: { contains: text, mode: "insensitive" } },
        { rewardLabel: { contains: text, mode: "insensitive" } },
      ],
    };
    const singlePostWhere: Prisma.PostWhereInput = { AND: [publicPostWhere, postSearch], todoListId: null };
    const routinePostWhere: Prisma.PostWhereInput = { AND: [publicPostWhere, postSearch], todoListId: { not: null } };
    const take = Math.min(query.limit, 20);
    const [users, posts, routines, tags, challenges, userCount, postCount, routineCount, tagCount, challengeCount] = await Promise.all([
      this.prisma.user.findMany({
        where: {
          suspendedAt: null,
          deletionRequestedAt: null,
          id: { notIn: hiddenIds },
          OR: [
            { nickname: { contains: text, mode: "insensitive" } },
            { handle: { contains: text.toLowerCase(), mode: "insensitive" } },
          ],
        },
        take: Math.min(take, 8),
        orderBy: [{ lifetimePower: "desc" }, { id: "asc" }],
        select: { id: true, nickname: true, handle: true, avatarUrl: true, avatarMedia: true, lifetimePower: true },
      }),
      this.prisma.post.findMany({ where: singlePostWhere, take,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        include: postRelations(viewerId),
      }),
      this.prisma.post.findMany({ where: routinePostWhere, take, orderBy: [{ createdAt: "desc" }, { id: "desc" }], include: postRelations(viewerId) }),
      this.prisma.tag.findMany({ where: tagWhere, take: Math.min(take, 12), orderBy: { name: "asc" }, include: { _count: { select: { posts: { where: { post: publicPostWhere } } } } } }),
      this.prisma.challenge.findMany({ where: challengeWhere, take: Math.min(take, 12), orderBy: [{ startsAt: "asc" }, { id: "asc" }], include: { _count: { select: { participants: true, checkIns: true } }, participants: { where: { userId: viewerId ?? "__guest__" }, select: { userId: true } } } }),
      this.prisma.user.count({ where: { suspendedAt: null, deletionRequestedAt: null, id: { notIn: hiddenIds }, OR: [{ nickname: { contains: text, mode: "insensitive" } }, { handle: { contains: text.toLowerCase(), mode: "insensitive" } }] } }),
      this.prisma.post.count({ where: singlePostWhere }),
      this.prisma.post.count({ where: routinePostWhere }),
      this.prisma.tag.count({ where: tagWhere }),
      this.prisma.challenge.count({ where: challengeWhere }),
    ]);
    const serializedUsers = await Promise.all(users.map((user) => this.serializeUserSummary(user)));
    const counts = { users: userCount, posts: postCount, routines: routineCount, tags: tagCount, challenges: challengeCount };
    return {
      query: rawText,
      users: serializedUsers,
      posts: await Promise.all(posts.map((post) => this.serializePost(post))),
      routines: await Promise.all(routines.map((post) => this.serializePost(post))),
      tags: tags.map((tag) => ({ id: tag.id, name: tag.name, postCount: tag._count.posts })),
      challenges: challenges.map((challenge) => ({ ...challenge, joined: Array.isArray(challenge.participants) && challenge.participants.length > 0, todayCheckedIn: false, myCheckInCount: 0, successRate: 0 })),
      counts: { ...counts, all: Object.values(counts).reduce((sum, value) => sum + value, 0) },
    };
  }

  async publicSearchSuggestions(limit = 10) {
    const take = Math.min(Math.max(limit, 1), 20);
    const grouped = await this.prisma.postTag.groupBy({
      by: ["tagId"],
      where: { post: { visibility: Visibility.PUBLIC, hiddenAt: null, author: { suspendedAt: null, deletionRequestedAt: null } } },
      _count: { postId: true },
      orderBy: { _count: { postId: "desc" } },
      take,
    });
    const tags = await this.prisma.tag.findMany({ where: { id: { in: grouped.map((item) => item.tagId) } } });
    const byId = new Map(tags.map((tag) => [tag.id, tag]));
    return { trendingTags: grouped.flatMap((item) => { const tag = byId.get(item.tagId); return tag ? [{ id: tag.id, name: tag.name, postCount: item._count.postId }] : []; }) };
  }

  async publicChallenges(viewerId: string | null) {
    const hiddenIds = await this.blockedUserIds(viewerId);
    const rows = await this.prisma.challenge.findMany({ where: { hiddenAt: null, endedAt: null, endsAt: { gte: new Date() }, creatorId: { notIn: hiddenIds }, creator: { suspendedAt: null, deletionRequestedAt: null } }, orderBy: [{ kind: "asc" }, { startsAt: "asc" }], include: { creator: { select: { id: true, nickname: true, handle: true } }, _count: { select: { participants: true, checkIns: true } } } });
    return rows.map((challenge) => ({ ...challenge, joined: false, todayCheckedIn: false, myCheckInCount: 0, successRate: 0 }));
  }

  async toggleCheer(userId: string, postId: string) {
    await this.readablePost(postId, userId);
    const existing = await this.prisma.cheer.findUnique({ where: { userId_postId: { userId, postId } } });
    if (existing) { await this.prisma.cheer.delete({ where: { userId_postId: { userId, postId } } }); return { cheered: false }; }
    const post = await this.prisma.post.findUniqueOrThrow({ where: { id: postId } });
    await this.prisma.cheer.create({ data: { userId, postId } });
    if (post.authorId !== userId) { await this.reward(userId, 1, "SOCIAL", postId, 5); await this.notify(post.authorId, NotificationType.CHEER, "응원을 받았어요", "누군가 회원님의 완료를 응원했어요.", postId, "POST", postId); }
    return { cheered: true };
  }

  async comment(userId: string, postId: string, body: string) {
    const post = await this.readablePost(postId, userId);
    const comment = await this.prisma.comment.create({ data: { authorId: userId, postId, body }, include: { author: { select: { id: true, nickname: true, handle: true, avatarUrl: true, avatarMedia: true, lifetimePower: true } } } });
    if (post.authorId !== userId) { await this.reward(userId, 1, "SOCIAL", comment.id, 5); await this.notify(post.authorId, NotificationType.COMMENT, "댓글이 달렸어요", body.slice(0, 60), postId, "POST", postId); }
    return { ...comment, author: await this.serializeUserSummary(comment.author) };
  }

  async removePost(userId: string, postId: string) {
    const post = await this.prisma.post.findFirst({ where: { id: postId, authorId: userId, hiddenAt: null } });
    if (!post) throw new NotFoundException("게시물을 찾을 수 없어요.");
    await this.prisma.post.update({ where: { id: postId }, data: { hiddenAt: new Date() } });
    return { ok: true };
  }

  async removeComment(userId: string, commentId: string) {
    const comment = await this.prisma.comment.findFirst({ where: { id: commentId, authorId: userId, hiddenAt: null } });
    if (!comment) throw new NotFoundException("댓글을 찾을 수 없어요.");
    await this.prisma.comment.update({ where: { id: commentId }, data: { hiddenAt: new Date() } });
    return { ok: true };
  }

  async listChallenges(userId: string) {
    const hiddenIds = await this.blockedUserIds(userId);
    const rows = await this.prisma.challenge.findMany({
      where: { hiddenAt: null, endedAt: null, endsAt: { gte: new Date() }, creatorId: { notIn: hiddenIds }, creator: { suspendedAt: null, deletionRequestedAt: null } },
      orderBy: [{ kind: "asc" }, { startsAt: "asc" }],
      include: {
        creator: { select: { id: true, nickname: true, handle: true } },
        _count: { select: { participants: true, checkIns: true } },
        participants: { where: { userId }, select: { userId: true, joinedAt: true, rewardStatus: true, finalRank: true, titleAwarded: true, completedAt: true } },
        checkIns: { where: { userId }, select: { checkInDate: true, status: true } },
      },
    });
    const today = await this.userDate(userId);
    return Promise.all(rows.map(async (challenge) => {
      const elapsedDays = this.challengeElapsedDays(challenge.startsAt, challenge.endsAt);
      const approved = challenge.checkIns.filter((item) => item.status === CheckInStatus.APPROVED).length;
      const participant = challenge.participants[0];
      const chat = participant ? await this.chat.summaryForChallenge(userId, challenge.id).catch(() => null) : null;
      return {
        ...challenge,
        joined: Boolean(participant),
        todayCheckedIn: challenge.checkIns.some((item) => item.checkInDate.getTime() === today.getTime()),
        myCheckInCount: approved,
        successRate: elapsedDays ? Math.min(100, Math.round(approved / elapsedDays * 100)) : 0,
        myRewardStatus: participant?.rewardStatus ?? null,
        myRank: participant?.finalRank ?? null,
        titleAwarded: participant?.titleAwarded ?? null,
        chatUnreadCount: chat?.unreadCount ?? 0,
        chatReadOnly: chat?.readOnly ?? false,
        chatPurgeAt: chat?.purgeAt ?? null,
      };
    }));
  }

  async pastChallenges(userId: string) {
    const now = new Date();
    const rows = await this.prisma.challenge.findMany({ where: { hiddenAt: null, participants: { some: { userId } }, OR: [{ endedAt: { not: null } }, { endsAt: { lt: now } }], chat: { purgeAt: { gt: now }, members: { some: { userId } } } }, orderBy: [{ endedAt: "desc" }, { endsAt: "desc" }], include: { creator: { select: { id: true, nickname: true, handle: true } }, _count: { select: { participants: true, checkIns: true } } } });
    return Promise.all(rows.map(async (challenge) => { const chat = await this.chat.summaryForChallenge(userId, challenge.id); return { ...challenge, joined: true, chatUnreadCount: chat.unreadCount, chatReadOnly: true, chatPurgeAt: chat.purgeAt }; }));
  }

  async challengeDetail(challengeId: string, userId: string | null) {
    const challenge = await this.prisma.challenge.findFirst({
      where: { id: challengeId, hiddenAt: null, creator: { suspendedAt: null, deletionRequestedAt: null } },
      include: { creator: { select: { id: true, nickname: true, handle: true } }, _count: { select: { participants: true, checkIns: true } } },
    });
    if (!challenge) throw new NotFoundException("챌린지를 찾을 수 없어요.");
    if (userId) await this.assertNotBlocked(userId, challenge.creator.id);
    const [participant, checkIns] = userId ? await Promise.all([
      this.prisma.challengeParticipant.findUnique({ where: { challengeId_userId: { challengeId, userId } }, select: { joinedAt: true, rewardStatus: true, finalRank: true, titleAwarded: true, completedAt: true } }),
      this.prisma.challengeCheckIn.findMany({ where: { challengeId, userId }, orderBy: { checkInDate: "desc" }, include: { media: { where: { status: "READY" }, take: 1 } } }),
    ]) : [null, []];
    const today = userId ? await this.userDate(userId) : null;
    const elapsedDays = this.challengeElapsedDays(challenge.startsAt, challenge.endsAt);
    const approved = checkIns.filter((item) => item.status === CheckInStatus.APPROVED).length;
    const chat = userId && participant ? await this.chat.summaryForChallenge(userId, challengeId).catch(() => null) : null;
    return {
      ...challenge,
      participants: participant ? [participant] : [],
      joined: Boolean(participant),
      todayCheckedIn: today ? checkIns.some((item) => item.checkInDate.getTime() === today.getTime()) : false,
      myCheckInCount: approved,
      successRate: elapsedDays ? Math.min(100, Math.round(approved / elapsedDays * 100)) : 0,
      myRewardStatus: participant?.rewardStatus ?? null,
      myRank: participant?.finalRank ?? null,
      titleAwarded: participant?.titleAwarded ?? null,
      chatUnreadCount: chat?.unreadCount ?? 0,
      chatReadOnly: chat?.readOnly ?? false,
      chatPurgeAt: chat?.purgeAt ?? null,
      checkIns: await Promise.all(checkIns.map(async (item) => {
        const validVotes = await this.prisma.challengeVerificationVote.count({ where: { checkInId: item.id, attempt: item.attempt, verdict: { in: [VerificationVoteVerdict.APPROVE, VerificationVoteVerdict.RETRY] } } });
        return { id: item.id, checkInDate: item.checkInDate, note: item.note, status: item.status, reviewNote: item.reviewNote, attempt: item.attempt, reviewSize: item.reviewSize, validVotes, reverifyUsed: item.reverifyUsed, retryUntil: item.retryUntil, mediaUrl: item.media[0] ? await this.media.viewUrl(item.media[0].thumbnailKey ?? item.media[0].objectKey) : null };
      })),
    };
  }

  async createChallenge(userId: string, role: string, dto: CreateChallengeDto) {
    const start = new Date(dto.startsAt), end = new Date(dto.endsAt);
    if (end <= start) throw new BadRequestException("종료일은 시작일보다 뒤여야 해요.");
    if (dto.kind === ChallengeKind.OFFICIAL && !["ADMIN", "MODERATOR"].includes(role)) throw new ForbiddenException("공식 챌린지는 운영자만 만들 수 있어요.");
    const verificationCriteria = this.verificationCriteria(dto.verificationMode, dto.verificationCriteria);
    if (dto.kind === ChallengeKind.OFFICIAL && dto.rewardLabel?.trim() && dto.verificationMode === VerificationMode.CHECK) throw new BadRequestException("보상이 있는 공식 챌린지는 참여자 사진 인증을 사용해주세요.");
    if (dto.kind === ChallengeKind.COMMUNITY) {
      const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
      if (user.availablePoints < COMMUNITY_CHALLENGE_COST) throw new BadRequestException("커뮤니티 챌린지 생성에는 500 포인트가 필요해요.");
    }
    const challenge = await this.prisma.$transaction(async (tx) => {
      if (dto.kind === ChallengeKind.COMMUNITY) {
        const charged = await tx.user.updateMany({ where: { id: userId, availablePoints: { gte: COMMUNITY_CHALLENGE_COST } }, data: { availablePoints: { decrement: COMMUNITY_CHALLENGE_COST } } });
        if (charged.count !== 1) throw new BadRequestException("커뮤니티 챌린지 생성에는 500 포인트가 필요해요.");
      }
      const community = dto.kind === ChallengeKind.COMMUNITY;
      const challenge = await tx.challenge.create({ data: { creatorId: userId, title: dto.title, description: dto.description, kind: dto.kind, verificationMode: dto.verificationMode, verificationCriteria, minimumParticipants: PEER_VERIFICATION.minimumParticipants, startsAt: start, endsAt: end, pointCost: community ? COMMUNITY_CHALLENGE_COST : 0, completionThreshold: dto.completionThreshold, rewardLabel: dto.rewardLabel, rewardTerms: dto.rewardTerms, firstPlaceTitle: dto.firstPlaceTitle, secondPlaceTitle: dto.secondPlaceTitle, thirdPlaceTitle: dto.thirdPlaceTitle, participants: community ? { create: { userId } } : undefined, chat: { create: { kind: ConversationKind.CHALLENGE, purgeAt: new Date(end.getTime() + 90 * 86_400_000), members: community ? { create: { userId, lastReadAt: new Date() } } : undefined } } } });
      if (dto.kind === ChallengeKind.COMMUNITY) await tx.pointLedger.create({ data: { userId, amount: -COMMUNITY_CHALLENGE_COST, reason: "CREATE_CHALLENGE", referenceId: challenge.id } });
      return challenge;
    });
    if (start <= new Date()) await this.chat.createSystemMessage(challenge.id, "CHALLENGE_STARTED", "챌린지가 시작됐어요. 서로에게 도움이 되는 팁과 경험을 나눠보세요.", start);
    return challenge;
  }

  async updateChallenge(userId: string, role: string, challengeId: string, dto: UpdateChallengeDto) {
    const challenge = await this.prisma.challenge.findFirst({ where: { id: challengeId, hiddenAt: null }, include: { _count: { select: { checkIns: true } } } });
    if (!challenge) throw new NotFoundException("챌린지를 찾을 수 없어요.");
    const privileged = ["ADMIN", "MODERATOR"].includes(role);
    if (challenge.creatorId !== userId && !privileged) throw new ForbiddenException("챌린지 작성자만 수정할 수 있어요.");
    if (challenge.kind === ChallengeKind.OFFICIAL && !privileged) throw new ForbiddenException("공식 챌린지는 운영자만 수정할 수 있어요.");
    if (challenge._count.checkIns > 0 && ((dto.startsAt && new Date(dto.startsAt).getTime() !== challenge.startsAt.getTime()) || dto.verificationMode && dto.verificationMode !== challenge.verificationMode)) throw new BadRequestException("인증이 시작된 뒤에는 시작일과 인증 방식을 바꿀 수 없어요.");
    const startsAt = dto.startsAt ? new Date(dto.startsAt) : challenge.startsAt;
    const endsAt = dto.endsAt ? new Date(dto.endsAt) : challenge.endsAt;
    if (endsAt <= startsAt) throw new BadRequestException("종료일은 시작일보다 뒤여야 해요.");
    const nextMode = dto.verificationMode ?? challenge.verificationMode;
    const verificationCriteria = dto.verificationMode || dto.verificationCriteria ? this.verificationCriteria(nextMode, dto.verificationCriteria ?? challenge.verificationCriteria) : undefined;
    if (challenge.kind === ChallengeKind.OFFICIAL && (dto.rewardLabel ?? challenge.rewardLabel)?.trim() && nextMode === VerificationMode.CHECK) throw new BadRequestException("보상이 있는 공식 챌린지는 참여자 사진 인증을 사용해주세요.");
    const updated = await this.prisma.challenge.update({ where: { id: challengeId }, data: { title: dto.title, description: dto.description, startsAt: dto.startsAt ? startsAt : undefined, endsAt: dto.endsAt ? endsAt : undefined, verificationMode: dto.verificationMode, verificationCriteria, completionThreshold: dto.completionThreshold, rewardLabel: dto.rewardLabel, rewardTerms: dto.rewardTerms, firstPlaceTitle: dto.firstPlaceTitle, secondPlaceTitle: dto.secondPlaceTitle, thirdPlaceTitle: dto.thirdPlaceTitle, chat: dto.endsAt ? { update: { purgeAt: new Date(endsAt.getTime() + 90 * 86_400_000) } } : undefined } });
    if (dto.startsAt || dto.endsAt || dto.verificationMode || dto.verificationCriteria) await this.chat.createSystemMessage(challengeId, `CHALLENGE_UPDATED_${Date.now()}`, "챌린지 일정 또는 인증 기준이 변경됐어요. 상세 내용을 확인해주세요.");
    return updated;
  }

  async removeChallenge(userId: string, role: string, challengeId: string) {
    const challenge = await this.prisma.challenge.findFirst({ where: { id: challengeId, hiddenAt: null, endedAt: null }, include: { participants: { select: { userId: true } } } });
    if (!challenge) throw new NotFoundException("챌린지를 찾을 수 없어요.");
    const privileged = ["ADMIN", "MODERATOR"].includes(role);
    if (challenge.creatorId !== userId && !privileged) throw new ForbiddenException("챌린지 작성자만 종료할 수 있어요.");
    if (challenge.kind === ChallengeKind.OFFICIAL && !privileged) throw new ForbiddenException("공식 챌린지는 운영자만 종료할 수 있어요.");
    const endedAt = new Date();
    await this.prisma.$transaction(async (tx) => {
      await tx.challenge.update({ where: { id: challengeId }, data: { endedAt } });
      if (challenge.participants.length) await tx.notification.createMany({ data: challenge.participants.filter((item) => item.userId !== userId).map((item) => ({ userId: item.userId, type: NotificationType.CHALLENGE, title: "챌린지가 종료됐어요", body: "운영 사정으로 참여 중인 챌린지가 종료됐어요.", referenceId: challengeId, targetType: "CHALLENGE", targetId: challengeId })) });
    });
    await this.chat.closeRoom(challengeId, endedAt);
    return { ok: true };
  }

  async joinChallenge(userId: string, challengeId: string) {
    const challenge = await this.prisma.challenge.findFirst({ where: { id: challengeId, hiddenAt: null, endedAt: null, startsAt: { lte: new Date() }, endsAt: { gte: new Date() }, creator: { suspendedAt: null, deletionRequestedAt: null } }, select: { id: true, creatorId: true, startsAt: true, chat: { select: { id: true } } } });
    if (!challenge) throw new BadRequestException("현재 참여할 수 없는 챌린지예요.");
    await this.assertNotBlocked(userId, challenge.creatorId);
    const participant = await this.prisma.$transaction(async (tx) => {
      const participant = await tx.challengeParticipant.upsert({ where: { challengeId_userId: { challengeId, userId } }, create: { challengeId, userId }, update: {} });
      if (challenge.chat) await tx.conversationMember.upsert({ where: { conversationId_userId: { conversationId: challenge.chat.id, userId } }, create: { conversationId: challenge.chat.id, userId, lastReadAt: new Date() }, update: {} });
      return participant;
    });
    await this.chat.createSystemMessage(challengeId, "CHALLENGE_STARTED", "챌린지가 시작됐어요. 서로에게 도움이 되는 팁과 경험을 나눠보세요.", challenge.startsAt);
    return participant;
  }

  async leaveChallenge(userId: string, challengeId: string) {
    const participant = await this.prisma.challengeParticipant.findUnique({ where: { challengeId_userId: { challengeId, userId } } });
    if (!participant) return { joined: false };
    const checkIns = await this.prisma.challengeCheckIn.findMany({ where: { challengeId, userId }, select: { id: true } });
    const room = await this.prisma.conversation.findUnique({ where: { challengeId }, select: { id: true } });
    await this.prisma.$transaction([this.prisma.media.updateMany({ where: { checkInId: { in: checkIns.map((item) => item.id) } }, data: { checkInId: null } }), this.prisma.challengeCheckIn.deleteMany({ where: { challengeId, userId } }), ...(room ? [this.prisma.conversationMember.deleteMany({ where: { conversationId: room.id, userId } })] : []), this.prisma.challengeParticipant.delete({ where: { challengeId_userId: { challengeId, userId } } })]);
    return { joined: false };
  }

  async checkIn(userId: string, challengeId: string, dto: CheckInDto) {
    const challenge = await this.prisma.challenge.findFirst({ where: { id: challengeId, hiddenAt: null, endedAt: null, creator: { suspendedAt: null, deletionRequestedAt: null } } });
    if (!challenge) throw new NotFoundException("챌린지를 찾을 수 없어요.");
    await this.assertNotBlocked(userId, challenge.creatorId);
    const now = new Date();
    if (now < challenge.startsAt || now > challenge.endsAt) throw new BadRequestException("인증 가능한 기간이 아니에요.");
    const peerPhoto = challenge.verificationMode === VerificationMode.PEER_PHOTO || challenge.verificationMode === VerificationMode.REQUIRED_PHOTO;
    if (peerPhoto && !dto.mediaId) throw new BadRequestException("참여자 인증을 받을 사진이 필요해요.");
    if (dto.mediaId) await this.media.readyOwned(userId, dto.mediaId);
    await this.joinChallenge(userId, challengeId);
    if (peerPhoto) {
      const participantCount = await this.prisma.challengeParticipant.count({ where: { challengeId, user: { emailVerifiedAt: { not: null }, suspendedAt: null, deletionRequestedAt: null } } });
      if (participantCount < challenge.minimumParticipants) throw new BadRequestException(`사진 인증은 참여자 ${challenge.minimumParticipants}명부터 시작할 수 있어요.`);
    }
    const date = await this.userDate(userId);
    const existing = await this.prisma.challengeCheckIn.findUnique({ where: { challengeId_userId_checkInDate: { challengeId, userId, checkInDate: date } } });
    if (existing) throw new ConflictException("오늘은 이미 인증했어요.");
    const checkIn = await this.prisma.challengeCheckIn.create({ data: { challengeId, userId, checkInDate: date, note: dto.note, status: peerPhoto ? CheckInStatus.PENDING : CheckInStatus.APPROVED, verified: !peerPhoto, ...PEER_VERIFICATION.firstReview } });
    if (dto.mediaId) {
      try { await this.media.attachToCheckIn(userId, dto.mediaId, checkIn.id); }
      catch (error) { await this.prisma.challengeCheckIn.delete({ where: { id: checkIn.id } }).catch(() => undefined); throw error; }
    }
    return checkIn;
  }

  async verificationQueue(userId: string, query: VerificationQueueDto) {
    const reviewer = await this.prisma.user.findFirst({ where: { id: userId, emailVerifiedAt: { not: null }, suspendedAt: null, deletionRequestedAt: null }, select: { id: true } });
    if (!reviewer) throw new ForbiddenException("이메일 인증을 마친 참여자만 사진 인증을 도울 수 있어요.");
    const candidates = await this.prisma.challengeCheckIn.findMany({
      where: {
        status: CheckInStatus.PENDING,
        hiddenAt: null,
        userId: { not: userId },
        ...(query.challengeId ? { challengeId: query.challengeId } : {}),
        challenge: { hiddenAt: null, verificationMode: VerificationMode.PEER_PHOTO, participants: { some: { userId } } },
        user: { suspendedAt: null, deletionRequestedAt: null, blocksInitiated: { none: { blockedId: userId } }, blocksReceived: { none: { blockerId: userId } } },
      },
      orderBy: { submittedAt: "asc" },
      take: 100,
      include: {
        challenge: { select: { id: true, title: true, verificationCriteria: true, minimumParticipants: true, participants: { where: { user: { emailVerifiedAt: { not: null }, suspendedAt: null, deletionRequestedAt: null } }, select: { userId: true } } } },
        media: { where: { status: "READY" }, take: 1 },
        votes: { where: { voterId: userId }, select: { attempt: true } },
        _count: { select: { votes: true } },
      },
    });
    const eligible = candidates.filter((item) => item.challenge.participants.length >= item.challenge.minimumParticipants && !item.votes.some((vote) => vote.attempt === item.attempt));
    const shuffled = eligible.sort(() => Math.random() - 0.5).slice(0, query.limit);
    const contributionCount = await this.prisma.challengeVerificationVote.count({ where: { voterId: userId } });
    return {
      contributionCount,
      items: await Promise.all(shuffled.map(async (item) => ({
        checkInId: item.id,
        challenge: { id: item.challenge.id, title: item.challenge.title },
        criteria: item.challenge.verificationCriteria,
        attempt: item.attempt,
        mediaUrl: item.media[0] ? await this.media.viewUrl(item.media[0].objectKey) : null,
      }))),
    };
  }

  async voteChallengeVerification(userId: string, checkInId: string, dto: VerificationVoteDto) {
    const outcome = await this.prisma.$transaction(async (tx) => {
      const checkIn = await tx.challengeCheckIn.findUnique({
        where: { id: checkInId },
        include: { challenge: { include: { _count: { select: { participants: true } } } } },
      });
      if (!checkIn || checkIn.status !== CheckInStatus.PENDING || checkIn.hiddenAt || checkIn.challenge.hiddenAt) throw new ConflictException("이미 판정이 끝났거나 더 이상 확인할 수 없는 인증이에요.");
      if (checkIn.challenge.verificationMode !== VerificationMode.PEER_PHOTO) throw new BadRequestException("참여자 확인 대상이 아닌 인증이에요.");
      if (checkIn.userId === userId) throw new ForbiddenException("내 인증에는 투표할 수 없어요.");
      const [reviewer, blocked, eligibleParticipantCount] = await Promise.all([
        tx.user.findFirst({ where: { id: userId, emailVerifiedAt: { not: null }, suspendedAt: null, deletionRequestedAt: null }, select: { id: true } }),
        tx.block.count({ where: { OR: [{ blockerId: userId, blockedId: checkIn.userId }, { blockerId: checkIn.userId, blockedId: userId }] } }),
        tx.challengeParticipant.count({ where: { challengeId: checkIn.challengeId, user: { emailVerifiedAt: { not: null }, suspendedAt: null, deletionRequestedAt: null } } }),
      ]);
      if (!reviewer || blocked) throw new ForbiddenException("이 인증을 확인할 수 없어요.");
      const participant = await tx.challengeParticipant.findUnique({ where: { challengeId_userId: { challengeId: checkIn.challengeId, userId } }, select: { userId: true } });
      if (!participant || eligibleParticipantCount < checkIn.challenge.minimumParticipants) throw new ForbiddenException("같은 챌린지의 참여자만 사진 인증을 도울 수 있어요.");
      const expected = checkIn.challenge.verificationCriteria.map((_, index) => index);
      const received = [...new Set(dto.answers.map((item) => item.criterionIndex))].sort((a, b) => a - b);
      if (received.length !== expected.length || received.some((value, index) => value !== expected[index])) throw new BadRequestException("모든 인증 기준에 한 번씩 답해주세요.");
      const previousVote = await tx.challengeVerificationVote.findUnique({ where: { checkInId_voterId_attempt: { checkInId, voterId: userId, attempt: checkIn.attempt } }, select: { id: true } });
      if (previousVote) throw new ConflictException("이 사진에는 이미 의견을 보냈어요.");
      const currentValid = await tx.challengeVerificationVote.count({ where: { checkInId, attempt: checkIn.attempt, verdict: { in: [VerificationVoteVerdict.APPROVE, VerificationVoteVerdict.RETRY] } } });
      if (currentValid >= checkIn.reviewSize) throw new ConflictException("필요한 확인 인원이 이미 모두 참여했어요.");
      const verdict = peerVoteVerdict(dto.answers.map((item) => item.result));
      await tx.challengeVerificationVote.create({ data: { checkInId, voterId: userId, attempt: checkIn.attempt, verdict, failedCriteria: dto.answers.filter((item) => item.result === "NOT_MET").map((item) => item.criterionIndex) } });
      const counts = await tx.challengeVerificationVote.groupBy({ by: ["verdict"], where: { checkInId, attempt: checkIn.attempt }, _count: { _all: true } });
      const approvals = counts.find((item) => item.verdict === VerificationVoteVerdict.APPROVE)?._count._all ?? 0;
      const rejections = counts.find((item) => item.verdict === VerificationVoteVerdict.RETRY)?._count._all ?? 0;
      const decision = peerVerificationDecision(approvals, rejections, checkIn.approvalTarget, checkIn.rejectionTarget);
      let reviewNote: string | null = null;
      let retryUntil: Date | null = null;
      if (decision === CheckInStatus.REJECTED) {
        const failed = await tx.challengeVerificationVote.findMany({ where: { checkInId, attempt: checkIn.attempt, verdict: VerificationVoteVerdict.RETRY }, select: { failedCriteria: true } });
        const frequencies = new Map<number, number>();
        failed.flatMap((item) => item.failedCriteria).forEach((index) => frequencies.set(index, (frequencies.get(index) ?? 0) + 1));
        const top = [...frequencies].sort((left, right) => right[1] - left[1])[0]?.[0];
        reviewNote = top === undefined ? "사진이 인증 기준을 충족하는지 다시 확인해주세요." : checkIn.challenge.verificationCriteria[top];
        retryUntil = new Date(Date.now() + PEER_VERIFICATION.retryHours * 60 * 60 * 1000);
      }
      if (decision !== CheckInStatus.PENDING) {
        const updated = await tx.challengeCheckIn.updateMany({ where: { id: checkInId, attempt: checkIn.attempt, status: CheckInStatus.PENDING }, data: { status: decision, verified: decision === CheckInStatus.APPROVED, reviewedAt: new Date(), reviewNote, retryUntil } });
        if (updated.count !== 1) throw new ConflictException("다른 참여자의 투표로 방금 판정이 끝났어요.");
      }
      return { decision, approvals, rejections, challengeId: checkIn.challengeId, challengeTitle: checkIn.challenge.title, ownerId: checkIn.userId };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }).catch((error: unknown) => {
      if (error instanceof Prisma.PrismaClientKnownRequestError && ["P2002", "P2034"].includes(error.code)) throw new ConflictException("다른 참여자의 의견이 먼저 반영됐어요. 다음 사진을 확인해주세요.");
      throw error;
    });
    if (outcome.decision !== CheckInStatus.PENDING) {
      await this.notify(outcome.ownerId, NotificationType.CHALLENGE, outcome.decision === CheckInStatus.APPROVED ? "사진 인증이 통과됐어요" : "사진 인증을 다시 올려주세요", outcome.challengeTitle, outcome.challengeId, "CHALLENGE", outcome.challengeId);
    }
    const contributionCount = await this.prisma.challengeVerificationVote.count({ where: { voterId: userId } });
    return { status: outcome.decision, approvals: outcome.approvals, rejections: outcome.rejections, contributionCount };
  }

  async resubmitChallengeVerification(userId: string, checkInId: string, dto: CheckInDto) {
    if (!dto.mediaId) throw new BadRequestException("새 인증 사진을 선택해주세요.");
    await this.media.readyOwned(userId, dto.mediaId);
    const current = await this.retryableCheckIn(userId, checkInId);
    await this.media.attachToCheckIn(userId, dto.mediaId, checkInId);
    const updated = await this.prisma.challengeCheckIn.updateMany({
      where: { id: checkInId, userId, attempt: current.attempt, status: CheckInStatus.REJECTED },
      data: { note: dto.note, attempt: { increment: 1 }, ...PEER_VERIFICATION.firstReview, status: CheckInStatus.PENDING, verified: false, reviewedAt: null, reviewNote: null, retryUntil: null, submittedAt: new Date() },
    });
    if (updated.count !== 1) throw new ConflictException("인증 상태가 변경됐어요. 새로고침 후 다시 시도해주세요.");
    return this.prisma.challengeCheckIn.findUniqueOrThrow({ where: { id: checkInId } });
  }

  async reverifyChallengeVerification(userId: string, checkInId: string) {
    const current = await this.retryableCheckIn(userId, checkInId);
    if (current.reverifyUsed) throw new ConflictException("같은 사진 재검증은 한 번만 요청할 수 있어요.");
    const mediaCount = await this.prisma.media.count({ where: { checkInId, status: "READY" } });
    if (!mediaCount) throw new BadRequestException("재검증할 사진이 없어요.");
    const updated = await this.prisma.challengeCheckIn.updateMany({
      where: { id: checkInId, userId, attempt: current.attempt, status: CheckInStatus.REJECTED, reverifyUsed: false },
      data: { attempt: { increment: 1 }, ...PEER_VERIFICATION.reverify, reverifyUsed: true, status: CheckInStatus.PENDING, verified: false, reviewedAt: null, reviewNote: null, retryUntil: null, submittedAt: new Date() },
    });
    if (updated.count !== 1) throw new ConflictException("인증 상태가 변경됐어요. 새로고침 후 다시 시도해주세요.");
    return this.prisma.challengeCheckIn.findUniqueOrThrow({ where: { id: checkInId } });
  }

  private async retryableCheckIn(userId: string, checkInId: string) {
    const current = await this.prisma.challengeCheckIn.findFirst({ where: { id: checkInId, userId }, include: { challenge: { select: { verificationMode: true } } } });
    if (!current || current.challenge.verificationMode !== VerificationMode.PEER_PHOTO) throw new NotFoundException("다시 인증할 기록을 찾을 수 없어요.");
    if (current.status !== CheckInStatus.REJECTED) throw new ConflictException("다시 인증할 수 있는 상태가 아니에요.");
    if (!current.retryUntil || current.retryUntil <= new Date()) throw new BadRequestException("24시간의 다시 인증 시간이 지났어요.");
    if (current.attempt >= PEER_VERIFICATION.maxAttempts) throw new BadRequestException("오늘의 사진 인증 기회를 모두 사용했어요.");
    return current;
  }

  private verificationCriteria(mode: VerificationMode, values?: string[]) {
    if (mode !== VerificationMode.PEER_PHOTO && mode !== VerificationMode.REQUIRED_PHOTO) return [];
    const criteria = (values?.length ? values : DEFAULT_VERIFICATION_CRITERIA).map((value) => value.trim()).filter(Boolean);
    if (!criteria.length || criteria.length > 5 || criteria.some((value) => value.length < 5 || value.length > 120)) throw new BadRequestException("사진 인증 기준은 5~120자로 1~5개 입력해주세요.");
    return [...new Set(criteria)];
  }

  async challengeLeaderboard(challengeId: string, viewerId: string | null) {
    const challenge = await this.prisma.challenge.findFirst({ where: { id: challengeId, hiddenAt: null, creator: { suspendedAt: null, deletionRequestedAt: null } }, select: { id: true, startsAt: true, endsAt: true, completionThreshold: true, firstPlaceTitle: true, secondPlaceTitle: true, thirdPlaceTitle: true, creatorId: true } });
    if (!challenge) throw new NotFoundException("챌린지를 찾을 수 없어요.");
    if (viewerId) await this.assertNotBlocked(viewerId, challenge.creatorId);
    const [participants, counts] = await Promise.all([
      this.prisma.challengeParticipant.findMany({ where: { challengeId }, orderBy: { joinedAt: "asc" }, take: 500, include: { user: { select: { id: true, nickname: true, handle: true, avatarUrl: true, avatarMedia: true, lifetimePower: true } } } }),
      this.prisma.challengeCheckIn.groupBy({ by: ["userId"], where: { challengeId, status: CheckInStatus.APPROVED }, _count: { _all: true } }),
    ]);
    const byUser = new Map(counts.map((item) => [item.userId, item._count._all]));
    const elapsedDays = this.challengeElapsedDays(challenge.startsAt, challenge.endsAt) || 1;
    const ranked = challengeLeaderboard(participants.map((item) => ({ userId: item.userId, joinedAt: item.joinedAt, approvedCheckIns: byUser.get(item.userId) ?? 0 })), elapsedDays, challenge.completionThreshold, [challenge.firstPlaceTitle, challenge.secondPlaceTitle, challenge.thirdPlaceTitle]);
    const participantById = new Map(participants.map((item) => [item.userId, item]));
    return { items: await Promise.all(ranked.slice(0, 50).map(async (item) => ({ ...item, titleAwarded: participantById.get(item.userId)!.titleAwarded, user: await this.serializeUserSummary(participantById.get(item.userId)!.user) }))), myRank: viewerId ? ranked.find((item) => item.userId === viewerId)?.rank ?? null : null };
  }

  async updateChallengeReward(challengeId: string, userId: string, status: RewardStatus, adminId?: string) {
    const challenge = await this.prisma.challenge.findUnique({ where: { id: challengeId } });
    if (!challenge || challenge.kind !== ChallengeKind.OFFICIAL) throw new BadRequestException("공식 챌린지의 보상만 관리할 수 있어요.");
    const participant = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.challengeParticipant.update({ where: { challengeId_userId: { challengeId, userId } }, data: { rewardStatus: status } });
      if (adminId) await this.audit(adminId, "CHALLENGE_REWARD_UPDATED", "CHALLENGE_PARTICIPANT", `${challengeId}:${userId}`, `${challenge.title} 보상 상태를 ${status}(으)로 변경`, { status }, tx);
      return updated;
    });
    await this.notify(userId, NotificationType.CHALLENGE, status === RewardStatus.PAID ? "챌린지 보상이 지급됐어요" : "챌린지 보상 상태가 바뀌었어요", `${challenge.title} 보상 상태를 확인해주세요.`, challengeId, "CHALLENGE", challengeId);
    return participant;
  }

  async adminChallengeParticipants(challengeId: string) {
    await this.settleChallenge(challengeId);
    const challenge = await this.prisma.challenge.findUnique({ where: { id: challengeId }, select: { id: true, title: true, kind: true, rewardLabel: true, rewardTerms: true, completionThreshold: true } });
    if (!challenge || challenge.kind !== ChallengeKind.OFFICIAL) throw new BadRequestException("공식 챌린지를 선택해주세요.");
    const participants = await this.prisma.challengeParticipant.findMany({ where: { challengeId }, orderBy: [{ finalRank: "asc" }, { joinedAt: "asc" }], take: 500, include: { user: { select: { id: true, nickname: true, handle: true, email: true } } } });
    const counts = await this.prisma.challengeCheckIn.groupBy({ by: ["userId", "status"], where: { challengeId }, _count: { _all: true } });
    return { challenge, items: participants.map((item) => ({ ...item, checkInCount: counts.find((count) => count.userId === item.userId && count.status === CheckInStatus.APPROVED)?._count._all ?? 0, pendingCheckInCount: counts.find((count) => count.userId === item.userId && count.status === CheckInStatus.PENDING)?._count._all ?? 0 })) };
  }

  async adminChallengeVerificationOverview() {
    const twelveHoursAgo = new Date(Date.now() - 12 * 60 * 60 * 1000);
    const [pending, delayed, approved24h, rejected24h, peerChallenges, pendingItems] = await Promise.all([
      this.prisma.challengeCheckIn.count({ where: { status: CheckInStatus.PENDING, hiddenAt: null, challenge: { verificationMode: VerificationMode.PEER_PHOTO, hiddenAt: null } } }),
      this.prisma.challengeCheckIn.count({ where: { status: CheckInStatus.PENDING, hiddenAt: null, submittedAt: { lt: twelveHoursAgo }, challenge: { verificationMode: VerificationMode.PEER_PHOTO, hiddenAt: null } } }),
      this.prisma.challengeCheckIn.count({ where: { status: CheckInStatus.APPROVED, reviewedAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) }, challenge: { verificationMode: VerificationMode.PEER_PHOTO } } }),
      this.prisma.challengeCheckIn.count({ where: { status: CheckInStatus.REJECTED, reviewedAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) }, challenge: { verificationMode: VerificationMode.PEER_PHOTO } } }),
      this.prisma.challenge.findMany({ where: { verificationMode: VerificationMode.PEER_PHOTO, hiddenAt: null }, select: { id: true, title: true, minimumParticipants: true, _count: { select: { participants: { where: { user: { emailVerifiedAt: { not: null }, suspendedAt: null, deletionRequestedAt: null } } } } } } }),
      this.prisma.challengeCheckIn.findMany({ where: { status: CheckInStatus.PENDING, hiddenAt: null, challenge: { verificationMode: VerificationMode.PEER_PHOTO, hiddenAt: null } }, orderBy: { submittedAt: "asc" }, take: 30, include: { challenge: { select: { id: true, title: true, _count: { select: { participants: { where: { user: { emailVerifiedAt: { not: null }, suspendedAt: null, deletionRequestedAt: null } } } } } } }, votes: { select: { attempt: true, verdict: true } } } }),
    ]);
    return {
      pending,
      delayed,
      approved24h,
      rejected24h,
      insufficientPools: peerChallenges.filter((item) => item._count.participants < item.minimumParticipants).map((item) => ({ id: item.id, title: item.title, participantCount: item._count.participants, required: item.minimumParticipants })),
      items: pendingItems.map((item) => {
        const votes = item.votes.filter((vote) => vote.attempt === item.attempt);
        return { id: item.id, challenge: item.challenge, attempt: item.attempt, reviewSize: item.reviewSize, validVotes: votes.filter((vote) => vote.verdict !== VerificationVoteVerdict.UNSURE).length, unsureVotes: votes.filter((vote) => vote.verdict === VerificationVoteVerdict.UNSURE).length, submittedAt: item.submittedAt };
      }),
    };
  }

  @Cron("0 5 * * * *", { timeZone: "UTC" })
  async settleEndedChallenges() {
    const challenges = await this.prisma.challenge.findMany({ where: { hiddenAt: null, endsAt: { lte: new Date() } }, select: { id: true } });
    for (const challenge of challenges) await this.settleChallenge(challenge.id);
  }

  private async settleChallenge(challengeId: string) {
    const challenge = await this.prisma.challenge.findUnique({ where: { id: challengeId }, include: { participants: true } });
    if (!challenge || challenge.endsAt > new Date()) return;
    const counts = await this.prisma.challengeCheckIn.groupBy({ by: ["userId"], where: { challengeId, status: CheckInStatus.APPROVED }, _count: { _all: true } });
    const byUser = new Map(counts.map((item) => [item.userId, item._count._all]));
    const ranked = challengeLeaderboard(challenge.participants.map((item) => ({ userId: item.userId, joinedAt: item.joinedAt, approvedCheckIns: byUser.get(item.userId) ?? 0 })), challengeTotalDays(challenge.startsAt, challenge.endsAt), challenge.completionThreshold, [challenge.firstPlaceTitle, challenge.secondPlaceTitle, challenge.thirdPlaceTitle]);
    for (const result of ranked) {
      const current = challenge.participants.find((item) => item.userId === result.userId)!;
      const unsettledReward = current.rewardStatus === RewardStatus.NOT_ELIGIBLE || current.rewardStatus === RewardStatus.ELIGIBLE;
      const rewardStatus = challenge.kind === ChallengeKind.OFFICIAL && unsettledReward
        ? result.eligible ? RewardStatus.ELIGIBLE : RewardStatus.NOT_ELIGIBLE
        : challenge.kind === ChallengeKind.COMMUNITY && result.eligible ? RewardStatus.APPROVED : current.rewardStatus;
      const completedAt = result.eligible ? current.completedAt ?? challenge.endsAt : null;
      await this.prisma.challengeParticipant.update({ where: { challengeId_userId: { challengeId, userId: result.userId } }, data: { finalRank: result.rank, titleAwarded: challenge.kind === ChallengeKind.COMMUNITY ? result.titleAwarded : null, completedAt, rewardStatus } });
      if (result.eligible && !current.completedAt) await this.notify(result.userId, NotificationType.CHALLENGE, result.titleAwarded ? `${result.titleAwarded} 칭호를 받았어요` : "챌린지를 완주했어요", challenge.title, challengeId, "CHALLENGE", challengeId);
    }
  }

  async toggleFollow(userId: string, targetId: string) {
    if (userId === targetId) throw new BadRequestException("자기 자신은 팔로우할 수 없어요.");
    const key = { followerId_followingId: { followerId: userId, followingId: targetId } };
    const found = await this.prisma.follow.findUnique({ where: key });
    if (found) {
      await this.prisma.follow.delete({ where: key });
      return { following: false };
    }
    const actor = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { handle: true } });
    await this.prisma.follow.create({ data: { followerId: userId, followingId: targetId } });
    await this.notify(targetId, NotificationType.FOLLOW, "새 팔로워가 생겼어요", "새로운 구름이 함께 떠오르기 시작했어요.", userId, "USER", actor.handle);
    return { following: true };
  }

  async followState(userId: string, targetId: string) {
    const [following, blocked, counts] = await Promise.all([
      this.prisma.follow.count({ where: { followerId: userId, followingId: targetId } }),
      this.prisma.block.count({ where: { OR: [{ blockerId: userId, blockedId: targetId }, { blockerId: targetId, blockedId: userId }] } }),
      this.prisma.user.findUnique({ where: { id: targetId }, select: { _count: { select: { followers: true, following: true } } } }),
    ]);
    if (!counts) throw new NotFoundException("사용자를 찾을 수 없어요.");
    return {
      following: following > 0,
      blocked: blocked > 0,
      followerCount: counts._count.followers,
      followingCount: counts._count.following,
    };
  }

  followers(viewerId: string, userId: string, page: PageDto) { return this.followList(viewerId, userId, "followers", page); }
  following(viewerId: string, userId: string, page: PageDto) { return this.followList(viewerId, userId, "following", page); }

  async block(userId: string, targetId: string) { if (userId === targetId) throw new BadRequestException("자기 자신은 차단할 수 없어요."); await this.prisma.$transaction([this.prisma.block.upsert({ where: { blockerId_blockedId: { blockerId: userId, blockedId: targetId } }, create: { blockerId: userId, blockedId: targetId }, update: {} }), this.prisma.follow.deleteMany({ where: { OR: [{ followerId: userId, followingId: targetId }, { followerId: targetId, followingId: userId }] } })]); return { blocked: true }; }

  async requestMessage(userId: string, receiverId: string) {
    if (userId === receiverId) throw new BadRequestException("자기 자신에게 메시지를 보낼 수 없어요.");
    const blocked = await this.prisma.block.count({ where: { OR: [{ blockerId: userId, blockedId: receiverId }, { blockerId: receiverId, blockedId: userId }] } }); if (blocked) throw new ForbiddenException("메시지를 보낼 수 없는 사용자예요.");
    const mutual = await this.prisma.follow.count({ where: { OR: [{ followerId: userId, followingId: receiverId }, { followerId: receiverId, followingId: userId }] } });
    if (mutual === 2) return this.createConversation(userId, receiverId);
    return this.prisma.messageRequest.upsert({ where: { senderId_receiverId: { senderId: userId, receiverId } }, create: { senderId: userId, receiverId }, update: { status: RequestStatus.PENDING } });
  }

  async acceptMessage(userId: string, requestId: string) { const req = await this.prisma.messageRequest.findUniqueOrThrow({ where: { id: requestId } }); if (req.receiverId !== userId) throw new ForbiddenException(); await this.prisma.messageRequest.update({ where: { id: requestId }, data: { status: RequestStatus.ACCEPTED } }); return this.createConversation(req.senderId, req.receiverId); }
  listConversations(userId: string) { return this.prisma.conversation.findMany({ where: { kind: ConversationKind.DIRECT, members: { some: { userId } } }, orderBy: { updatedAt: "desc" }, include: { members: { include: { user: { select: { id: true, nickname: true, handle: true, avatarUrl: true } } } }, messages: { take: 1, orderBy: { createdAt: "desc" } } } }); }
  async messages(userId: string, conversationId: string) {
    const conversation = await this.prisma.conversation.findFirst({ where: { id: conversationId, kind: ConversationKind.DIRECT, members: { some: { userId } } }, select: { id: true } });
    if (!conversation) throw new NotFoundException("대화를 찾을 수 없어요.");
    return this.prisma.message.findMany({ where: { conversationId, deletedAt: null }, orderBy: { createdAt: "asc" }, take: 100 });
  }
  async sendMessage(userId: string, conversationId: string, dto: SendMessageDto) {
    const conversation = await this.prisma.conversation.findFirst({ where: { id: conversationId, kind: ConversationKind.DIRECT, members: { some: { userId } } }, select: { id: true } });
    if (!conversation) throw new NotFoundException("대화를 찾을 수 없어요.");
    const message = await this.prisma.message.create({ data: { senderId: userId, conversationId, body: dto.body } });
    await this.prisma.conversation.update({ where: { id: conversationId }, data: { updatedAt: new Date() } });
    return message;
  }

  async notifications(userId: string, page: PageDto) {
    const rows = await this.prisma.notification.findMany({ where: { userId }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: page.limit + 1, ...(page.cursor ? { cursor: { id: page.cursor }, skip: 1 } : {}) });
    const items = rows.slice(0, page.limit).map((item) => ({ ...item, href: this.notificationHref(item.targetType, item.targetId) }));
    const unreadCount = await this.prisma.notification.count({ where: { userId, readAt: null } });
    return { items, nextCursor: rows.length > page.limit ? items.at(-1)?.id ?? null : null, unreadCount };
  }
  unreadNotificationCount(userId: string) { return this.prisma.notification.count({ where: { userId, readAt: null } }).then((count) => ({ count })); }
  readNotifications(userId: string) { return this.prisma.notification.updateMany({ where: { userId, readAt: null }, data: { readAt: new Date() } }); }
  async report(userId: string, dto: CreateReportDto) {
    if (dto.targetType === ReportTarget.USER) {
      if (dto.targetId === userId) throw new BadRequestException("자기 자신은 신고할 수 없어요.");
      const user = await this.prisma.user.findFirst({ where: { id: dto.targetId, deletionRequestedAt: null } });
      if (!user) throw new NotFoundException("사용자를 찾을 수 없어요.");
    } else if (dto.targetType === ReportTarget.POST) {
      await this.readablePost(dto.targetId, userId);
    } else if (dto.targetType === ReportTarget.COMMENT) {
      const comment = await this.prisma.comment.findFirst({ where: { id: dto.targetId, hiddenAt: null }, select: { postId: true } });
      if (!comment) throw new NotFoundException("댓글을 찾을 수 없어요.");
      await this.readablePost(comment.postId, userId);
    } else if (dto.targetType === ReportTarget.MESSAGE) {
      const message = await this.prisma.message.findFirst({ where: { id: dto.targetId, deletedAt: null }, select: { conversationId: true } });
      if (!message) throw new NotFoundException("메시지를 찾을 수 없어요.");
      await this.assertMember(userId, message.conversationId);
    } else if (dto.targetType === ReportTarget.CHALLENGE) {
      const challenge = await this.prisma.challenge.findFirst({ where: { id: dto.targetId, hiddenAt: null } });
      if (!challenge) throw new NotFoundException("챌린지를 찾을 수 없어요.");
    } else if (dto.targetType === ReportTarget.CHALLENGE_CHECK_IN) {
      const checkIn = await this.prisma.challengeCheckIn.findFirst({ where: { id: dto.targetId, hiddenAt: null, status: CheckInStatus.PENDING, challenge: { participants: { some: { userId } } } }, select: { userId: true } });
      if (!checkIn || checkIn.userId === userId) throw new NotFoundException("신고할 사진 인증을 찾을 수 없어요.");
    }
    const duplicate = await this.prisma.report.findFirst({ where: { reporterId: userId, targetType: dto.targetType, targetId: dto.targetId, status: { in: ["OPEN", "REVIEWING"] } } });
    if (duplicate) throw new ConflictException("이미 접수된 신고예요.");
    const refs: Prisma.ReportUncheckedCreateInput = { reporterId: userId, targetType: dto.targetType, targetId: dto.targetId, reason: dto.reason };
    if (dto.targetType === ReportTarget.POST) refs.postRefId = dto.targetId;
    if (dto.targetType === ReportTarget.COMMENT) refs.commentRefId = dto.targetId;
    if (dto.targetType === ReportTarget.MESSAGE) refs.messageRefId = dto.targetId;
    if (dto.targetType === ReportTarget.CHALLENGE) refs.challengeRefId = dto.targetId;
    if (dto.targetType === ReportTarget.CHALLENGE_CHECK_IN) refs.checkInRefId = dto.targetId;
    return this.prisma.report.create({ data: refs });
  }
  async adminOverview() {
    const since = new Date(Date.now() - 7 * 86_400_000);
    const [totalUsers, newUsers, verifiedUsers, suspendedUsers, activeSessions, completedTodos, publishedPosts, copiedTodos, openReports, pendingCheckIns, activeInvites] = await Promise.all([
      this.prisma.user.count({ where: { deletionRequestedAt: null } }),
      this.prisma.user.count({ where: { deletionRequestedAt: null, createdAt: { gte: since } } }),
      this.prisma.user.count({ where: { deletionRequestedAt: null, emailVerifiedAt: { not: null } } }),
      this.prisma.user.count({ where: { suspendedAt: { not: null }, deletionRequestedAt: null } }),
      this.prisma.session.findMany({ where: { revokedAt: null, expiresAt: { gt: new Date() }, lastUsedAt: { gte: since } }, distinct: ["userId"], select: { userId: true } }).then((items) => items.length),
      this.prisma.todo.count({ where: { completedAt: { gte: since }, deletedAt: null } }),
      this.prisma.post.count({ where: { createdAt: { gte: since }, hiddenAt: null } }),
      this.prisma.todo.count({ where: { createdAt: { gte: since }, sourceTodoId: { not: null }, deletedAt: null } }),
      this.prisma.report.count({ where: { status: { in: ["OPEN", "REVIEWING"] } } }),
      this.prisma.challengeCheckIn.count({ where: { status: CheckInStatus.PENDING, hiddenAt: null, challenge: { verificationMode: VerificationMode.PEER_PHOTO, hiddenAt: null } } }),
      this.prisma.inviteCode.findMany({ where: { disabledAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] }, select: { uses: true, maxUses: true } }).then((items) => items.filter((item) => item.uses < item.maxUses).length),
    ]);
    return { users: { total: totalUsers, newLast7Days: newUsers, verified: verifiedUsers, suspended: suspendedUsers, activeLast7Days: activeSessions }, activity: { completedTodosLast7Days: completedTodos, publishedPostsLast7Days: publishedPosts, copiedTodosLast7Days: copiedTodos }, moderation: { openReports, pendingCheckIns }, invites: { active: activeInvites } };
  }

  async adminInviteCodes() {
    const now = new Date();
    const items = await this.prisma.inviteCode.findMany({ orderBy: { createdAt: "desc" }, take: 200, select: { id: true, label: true, maxUses: true, uses: true, expiresAt: true, disabledAt: true, createdAt: true } });
    return { items: items.map((item) => ({ ...item, state: item.disabledAt ? "DISABLED" : item.expiresAt && item.expiresAt <= now ? "EXPIRED" : item.uses >= item.maxUses ? "EXHAUSTED" : "ACTIVE" })) };
  }

  async createInviteCode(adminId: string, dto: CreateInviteCodeDto) {
    const expiresAt = dto.expiresAt ? new Date(dto.expiresAt) : null;
    if (expiresAt && expiresAt <= new Date()) throw new BadRequestException("만료일은 현재보다 이후여야 해요.");
    const code = `MUNG-${randomBytes(5).toString("hex").toUpperCase()}`;
    const codeHash = createHash("sha256").update(code).digest("hex");
    const invite = await this.prisma.$transaction(async (tx) => {
      const created = await tx.inviteCode.create({ data: { codeHash, label: dto.label?.trim() || null, maxUses: dto.maxUses, expiresAt } });
      await this.audit(adminId, "INVITE_CODE_CREATED", "INVITE_CODE", created.id, `${created.label || "이름 없는 초대 코드"} 생성`, { maxUses: created.maxUses, expiresAt: created.expiresAt?.toISOString() ?? null }, tx);
      return created;
    });
    return { code, invite: { id: invite.id, label: invite.label, maxUses: invite.maxUses, uses: invite.uses, expiresAt: invite.expiresAt, disabledAt: invite.disabledAt, createdAt: invite.createdAt, state: "ACTIVE" } };
  }

  async updateInviteCode(adminId: string, id: string, disabled: boolean) {
    const current = await this.prisma.inviteCode.findUnique({ where: { id } });
    if (!current) throw new NotFoundException("초대 코드를 찾을 수 없어요.");
    if (!disabled && current.expiresAt && current.expiresAt <= new Date()) throw new BadRequestException("만료된 초대 코드는 다시 활성화할 수 없어요.");
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.inviteCode.update({ where: { id }, data: { disabledAt: disabled ? new Date() : null } });
      await this.audit(adminId, disabled ? "INVITE_CODE_DISABLED" : "INVITE_CODE_ENABLED", "INVITE_CODE", id, `${updated.label || "이름 없는 초대 코드"} ${disabled ? "중지" : "활성화"}`, undefined, tx);
      return { id: updated.id, label: updated.label, maxUses: updated.maxUses, uses: updated.uses, expiresAt: updated.expiresAt, disabledAt: updated.disabledAt, createdAt: updated.createdAt };
    });
  }

  async adminUsers(query: AdminUserQueryDto) {
    const text = query.query?.trim();
    const rows = await this.prisma.user.findMany({
      where: {
        deletionRequestedAt: null,
        ...(query.status === "ACTIVE" ? { suspendedAt: null } : query.status === "SUSPENDED" ? { suspendedAt: { not: null } } : {}),
        ...(text ? { OR: [{ nickname: { contains: text, mode: "insensitive" } }, { handle: { contains: text.toLowerCase(), mode: "insensitive" } }, { email: { contains: text.toLowerCase(), mode: "insensitive" } }] } : {}),
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: query.limit,
      select: {
        id: true,
        email: true,
        nickname: true,
        handle: true,
        role: true,
        emailVerifiedAt: true,
        suspendedAt: true,
        suspensionReason: true,
        createdAt: true,
        _count: { select: { todos: true, posts: true, sessions: { where: { revokedAt: null, expiresAt: { gt: new Date() } } } } },
      },
    });
    return { items: rows, nextCursor: null };
  }

  async updateUserSuspension(adminId: string, userId: string, suspended: boolean, reason?: string) {
    if (adminId === userId) throw new BadRequestException("자기 계정의 운영 권한 상태는 변경할 수 없어요.");
    const target = await this.prisma.user.findUnique({ where: { id: userId }, select: { id: true, nickname: true, handle: true, role: true } });
    if (!target) throw new NotFoundException("사용자를 찾을 수 없어요.");
    if (target.role !== "USER") throw new ForbiddenException("다른 운영자 계정은 정지할 수 없어요.");
    if (suspended && !reason?.trim()) throw new BadRequestException("정지 사유를 입력해주세요.");
    const now = new Date();
    const updated = await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.update({ where: { id: userId }, data: { suspendedAt: suspended ? now : null, suspensionReason: suspended ? reason!.trim() : null } });
      if (suspended) await tx.session.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: now } });
      await this.audit(adminId, suspended ? "USER_SUSPENDED" : "USER_RESTORED", "USER", userId, `${target.nickname}(@${target.handle}) ${suspended ? "정지" : "정지 해제"}`, { reason: suspended ? reason!.trim() : null }, tx);
      return user;
    });
    if (suspended) await this.notify(userId, NotificationType.SYSTEM, "계정 이용이 일시 중지됐어요", reason!.trim(), userId, "SETTINGS", undefined).catch(() => undefined);
    return updated;
  }

  async adminContent(query: AdminContentQueryDto) {
    const text = query.query?.trim();
    const hiddenFilter = query.status === "VISIBLE" ? { hiddenAt: null } : query.status === "HIDDEN" ? { hiddenAt: { not: null } } : {};
    if (query.type === "COMMENT") {
      const items = await this.prisma.comment.findMany({ where: { ...hiddenFilter, ...(text ? { OR: [{ body: { contains: text, mode: "insensitive" } }, { author: { handle: { contains: text.toLowerCase(), mode: "insensitive" } } }] } : {}) }, orderBy: { createdAt: "desc" }, take: query.limit, include: { author: { select: { id: true, nickname: true, handle: true } }, post: { select: { id: true, caption: true } }, _count: { select: { reports: true } } } });
      return { items: items.map((item) => ({ id: item.id, type: "COMMENT", preview: item.body, contextId: item.post.id, context: item.post.caption, author: item.author, hiddenAt: item.hiddenAt, createdAt: item.createdAt, reportCount: item._count.reports })), nextCursor: null };
    }
    const items = await this.prisma.post.findMany({ where: { ...hiddenFilter, ...(text ? { OR: [{ caption: { contains: text, mode: "insensitive" } }, { author: { handle: { contains: text.toLowerCase(), mode: "insensitive" } } }, { todos: { some: { todo: { title: { contains: text, mode: "insensitive" } } } } }] } : {}) }, orderBy: { createdAt: "desc" }, take: query.limit, include: { author: { select: { id: true, nickname: true, handle: true } }, todos: { include: { todo: { select: { title: true } } }, take: 1 }, _count: { select: { reports: true, comments: true, cheers: true } } } });
    return { items: items.map((item) => ({ id: item.id, type: "POST", preview: item.caption || item.todos[0]?.todo.title || "본문 없는 게시물", contextId: item.id, context: `${item._count.cheers}개 응원 · ${item._count.comments}개 댓글`, author: item.author, hiddenAt: item.hiddenAt, createdAt: item.createdAt, reportCount: item._count.reports })), nextCursor: null };
  }

  async updateAdminContentVisibility(adminId: string, rawType: string, id: string, hidden: boolean, reason?: string) {
    const type = rawType.toUpperCase();
    if (type !== "POST" && type !== "COMMENT") throw new BadRequestException("관리할 수 없는 콘텐츠 유형이에요.");
    if (hidden && !reason?.trim()) throw new BadRequestException("숨김 사유를 입력해주세요.");
    const now = new Date();
    return this.prisma.$transaction(async (tx) => {
      const target = type === "POST"
        ? await tx.post.findUnique({ where: { id }, select: { id: true, authorId: true, caption: true } })
        : await tx.comment.findUnique({ where: { id }, select: { id: true, authorId: true, body: true } });
      if (!target) throw new NotFoundException("콘텐츠를 찾을 수 없어요.");
      if (type === "POST") await tx.post.update({ where: { id }, data: { hiddenAt: hidden ? now : null } });
      else await tx.comment.update({ where: { id }, data: { hiddenAt: hidden ? now : null } });
      await this.audit(adminId, hidden ? "CONTENT_HIDDEN" : "CONTENT_RESTORED", type, id, `${type === "POST" ? "게시물" : "댓글"} ${hidden ? "숨김" : "복구"}`, { reason: hidden ? reason!.trim() : null }, tx);
      if (hidden) await tx.notification.create({ data: { userId: target.authorId, type: NotificationType.SYSTEM, title: `${type === "POST" ? "게시물" : "댓글"}이 운영 정책에 따라 숨김 처리됐어요`, body: reason!.trim(), referenceId: id, targetType: type, targetId: id } });
      return { id, type, hiddenAt: hidden ? now : null };
    });
  }

  async adminAuditLogs(page: PageDto) {
    const items = await this.prisma.adminAuditLog.findMany({ orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: page.limit, include: { admin: { select: { id: true, nickname: true, handle: true } } } });
    return { items, nextCursor: null };
  }

  async adminReports() {
    const items = await this.prisma.report.findMany({ orderBy: { createdAt: "desc" }, take: 200, include: { reporter: { select: { id: true, nickname: true, handle: true } }, post: { select: { caption: true, hiddenAt: true } }, comment: { select: { body: true, hiddenAt: true } }, message: { select: { body: true, hiddenAt: true, media: { where: { status: "READY" }, take: 1 }, conversation: { select: { challenge: { select: { title: true } } } } } }, challenge: { select: { title: true, hiddenAt: true } }, challengeCheckIn: { select: { hiddenAt: true, challenge: { select: { title: true } }, media: { where: { status: "READY" }, take: 1 } } } } });
    return { items: await Promise.all(items.map(async (item) => { const media = item.message?.media[0] ?? item.challengeCheckIn?.media[0]; return { ...item, targetPreview: item.post?.caption || item.comment?.body || item.message?.body || item.challenge?.title || (item.message ? `${item.message.conversation.challenge?.title ?? "챌린지"} 대화 메시지` : null) || (item.challengeCheckIn ? `${item.challengeCheckIn.challenge.title} 사진 인증` : null), targetMediaUrl: media ? await this.media.viewUrl(media.thumbnailKey ?? media.objectKey) : null, targetHidden: Boolean(item.post?.hiddenAt || item.comment?.hiddenAt || item.message?.hiddenAt || item.challenge?.hiddenAt || item.challengeCheckIn?.hiddenAt) }; })) };
  }

  async updateChallengeCheckInVisibility(adminId: string, checkInId: string, hidden: boolean, reason?: string) {
    const current = await this.prisma.challengeCheckIn.findUnique({ where: { id: checkInId }, include: { challenge: { select: { id: true, title: true } } } });
    if (!current) throw new NotFoundException("사진 인증을 찾을 수 없어요.");
    if (hidden && (!reason || reason.trim().length < 3)) throw new BadRequestException("숨김 사유를 3자 이상 입력해주세요.");
    const updated = await this.prisma.$transaction(async (tx) => {
      const item = await tx.challengeCheckIn.update({ where: { id: checkInId }, data: hidden ? { hiddenAt: new Date(), moderationNote: reason!.trim(), status: CheckInStatus.REJECTED, verified: false, reviewNote: "운영 정책에 따라 인증 사진이 숨김 처리됐어요.", retryUntil: null, reviewedAt: new Date() } : { hiddenAt: null, moderationNote: null, status: CheckInStatus.PENDING, verified: false, reviewNote: null, reviewedAt: null, submittedAt: new Date() } });
      await this.audit(adminId, hidden ? "CHALLENGE_CHECK_IN_HIDDEN" : "CHALLENGE_CHECK_IN_RESTORED", "CHALLENGE_CHECK_IN", checkInId, `${current.challenge.title} 인증 사진 ${hidden ? "숨김" : "복구"}`, { reason: reason ?? null }, tx);
      return item;
    });
    if (hidden) await this.notify(current.userId, NotificationType.CHALLENGE, "챌린지 인증 사진이 숨김 처리됐어요", reason!.trim(), current.challenge.id, "CHALLENGE", current.challenge.id);
    return updated;
  }

  async resolveReport(adminId: string, id: string, status: "RESOLVED" | "DISMISSED" | "REVIEWING", resolution: string) {
    return this.prisma.$transaction(async (tx) => {
      const report = await tx.report.update({ where: { id }, data: { resolverId: adminId, status, resolution } });
      await this.audit(adminId, "REPORT_STATUS_UPDATED", "REPORT", id, `신고 상태를 ${status}(으)로 변경`, { status, resolution }, tx);
      return report;
    });
  }

  private audit(adminId: string, action: string, targetType: string, targetId: string, summary?: string, metadata?: Prisma.InputJsonValue, tx: Prisma.TransactionClient = this.prisma) {
    return tx.adminAuditLog.create({ data: { adminId, action, targetType, targetId, summary, ...(metadata === undefined ? {} : { metadata }) } });
  }

  private async followList(viewerId: string, userId: string, direction: "followers" | "following", page: PageDto) {
    const blocked = await this.prisma.block.count({ where: { OR: [{ blockerId: viewerId, blockedId: userId }, { blockerId: userId, blockedId: viewerId }] } });
    if (blocked) throw new ForbiddenException("사용자 목록을 볼 수 없어요.");
    const rows = direction === "followers"
      ? await this.prisma.follow.findMany({ where: { followingId: userId }, orderBy: { createdAt: "desc" }, take: page.limit, include: { follower: { select: { id: true, nickname: true, handle: true, avatarUrl: true, avatarMedia: true, lifetimePower: true } } } })
      : await this.prisma.follow.findMany({ where: { followerId: userId }, orderBy: { createdAt: "desc" }, take: page.limit, include: { following: { select: { id: true, nickname: true, handle: true, avatarUrl: true, avatarMedia: true, lifetimePower: true } } } });
    const users = rows.map((row) => direction === "followers" && "follower" in row ? row.follower : "following" in row ? row.following : null).filter(Boolean);
    return {
      items: await Promise.all(users.map(async (user) => ({
        id: user!.id,
        nickname: user!.nickname,
        handle: user!.handle,
        lifetimePower: user!.lifetimePower,
        cloudRank: rankOf(user!.lifetimePower),
        avatarUrl: user!.avatarMedia ? await this.media.viewUrl(user!.avatarMedia.thumbnailKey ?? user!.avatarMedia.objectKey) : user!.avatarUrl,
      }))),
      nextCursor: null,
    };
  }

  private encodeCursor(createdAt: Date, id: string) {
    return Buffer.from(JSON.stringify({ createdAt: createdAt.toISOString(), id })).toString("base64url");
  }

  private decodeCursor(cursor?: string) {
    if (!cursor) return null;
    try {
      const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as { createdAt: string; id: string };
      const createdAt = new Date(parsed.createdAt);
      if (!parsed.id || Number.isNaN(createdAt.getTime())) throw new Error();
      return { createdAt, id: parsed.id };
    } catch {
      throw new BadRequestException("잘못된 페이지 요청이에요.");
    }
  }

  private notificationHref(targetType: string | null, targetId: string | null) {
    if (!targetType || !targetId) return null;
    if (targetType === "POST") return `/posts/${targetId}`;
    if (targetType === "CHALLENGE") return `/challenges/${targetId}`;
    if (targetType === "CHALLENGE_CHAT") return `/challenges/${targetId}/chat`;
    if (targetType === "DIRECT_INBOX") return "/messages";
    if (targetType === "DIRECT_MESSAGE") return `/messages/${targetId}`;
    if (targetType === "USER") return `/people/${targetId}`;
    if (targetType === "TODO") return `/todos?todo=${targetId}`;
    if (targetType === "TODO_LIST") return `/todos?list=${targetId}`;
    return null;
  }

  private async userDate(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { timezone: true } });
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone: user.timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts();
    const part = (type: string) => parts.find((item) => item.type === type)?.value;
    return new Date(`${part("year")}-${part("month")}-${part("day")}T00:00:00.000Z`);
  }

  private async userDayWindow(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { timezone: true } });
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone: user.timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts();
    const value = (type: string) => Number(parts.find((item) => item.type === type)?.value);
    const year = value("year"), month = value("month"), day = value("day");
    const start = this.zonedInstant(year, month, day, user.timezone);
    const next = new Date(Date.UTC(year, month - 1, day + 1));
    const end = this.zonedInstant(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate(), user.timezone);
    return { start, end };
  }

  private zonedInstant(year: number, month: number, day: number, timezone: string) {
    const desired = Date.UTC(year, month - 1, day);
    let candidate = new Date(desired);
    for (let index = 0; index < 2; index += 1) {
      const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(candidate);
      const value = (type: string) => Number(parts.find((item) => item.type === type)?.value);
      const actual = Date.UTC(value("year"), value("month") - 1, value("day"), value("hour"), value("minute"), value("second"));
      candidate = new Date(candidate.getTime() + desired - actual);
    }
    return candidate;
  }

  private challengeElapsedDays(startsAt: Date, endsAt: Date) {
    const now = new Date();
    if (now < startsAt) return 0;
    return Math.max(1, Math.min(Math.floor((endsAt.getTime() - startsAt.getTime()) / 86_400_000) + 1, Math.floor((now.getTime() - startsAt.getTime()) / 86_400_000) + 1));
  }

  private async preserveDetachedSeriesMembership(
    userId: string,
    before: { id: string; seriesId: string | null },
    after: { id: string; seriesId: string | null },
  ) {
    if (!before.seriesId || before.seriesId === after.seriesId) return;
    const memberships = await this.prisma.todoListItem.findMany({
      where: { todoId: before.id, list: { userId } },
      select: { listId: true, todoId: true },
    });
    if (!memberships.length) return;
    const replacement = await this.prisma.todo.findFirst({
      where: { userId, seriesId: before.seriesId, id: { not: before.id }, deletedAt: null },
      orderBy: { dueDate: "asc" },
      select: { id: true },
    });
    await this.prisma.$transaction(async (tx) => {
      for (const membership of memberships) {
        if (!replacement) {
          await tx.todoListItem.delete({ where: { listId_todoId: membership } });
          continue;
        }
        const alreadyRepresented = await tx.todoListItem.findUnique({
          where: { listId_todoId: { listId: membership.listId, todoId: replacement.id } },
        });
        if (alreadyRepresented) {
          await tx.todoListItem.delete({ where: { listId_todoId: membership } });
        } else {
          await tx.todoListItem.update({
            where: { listId_todoId: membership },
            data: { todoId: replacement.id },
          });
        }
      }
    });
  }

  private async setTodoListMembership(
    userId: string,
    todo: { id: string; seriesId: string | null },
    todoListId: string | null,
    previousTodoId?: string,
  ) {
    if (todoListId) await this.ownTodoList(userId, todoListId);
    const todoIds = [...new Set([todo.id, previousTodoId].filter((id): id is string => Boolean(id)))];
    const related: Prisma.TodoListItemWhereInput[] = [{ todoId: { in: todoIds } }];
    if (todo.seriesId) related.push({ todo: { seriesId: todo.seriesId } });
    await this.prisma.$transaction(async (tx) => {
      await tx.todoListItem.deleteMany({ where: { list: { userId }, OR: related } });
      if (!todoListId) return;
      const currentLast = await tx.todoListItem.aggregate({
        where: { listId: todoListId },
        _max: { order: true },
      });
      await tx.todoListItem.create({
        data: { listId: todoListId, todoId: todo.id, order: (currentLast._max.order ?? -1) + 1 },
      });
    });
  }

  private async ownTodo(userId: string, todoId: string) { const todo = await this.prisma.todo.findFirst({ where: { id: todoId, userId, deletedAt: null } }); if (!todo) throw new NotFoundException("TODO를 찾을 수 없어요."); return todo; }
  private async ensureTodoCategories(userId: string) {
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
  private async resolveTodoCategory(userId: string, categoryId?: string | null, fallback = "생활", allowArchived = false) {
    if (categoryId) {
      const category = await this.prisma.todoCategory.findFirst({ where: { id: categoryId, userId, archivedAt: allowArchived ? undefined : null } });
      if (!category) throw new BadRequestException("사용할 수 있는 카테고리를 선택해주세요.");
      return { category: category.baseCategory, categoryId: category.id };
    }
    return { category: fallback, categoryId: null };
  }
  private async readableTodo(userId: string, todoId: string) { const todo = await this.prisma.todo.findFirst({ where: { id: todoId, deletedAt: null, user: { suspendedAt: null, deletionRequestedAt: null }, OR: [{ userId }, { visibility: Visibility.PUBLIC }, { postLinks: { some: { post: { hiddenAt: null, OR: [{ visibility: Visibility.PUBLIC }, { visibility: Visibility.FOLLOWERS, author: { followers: { some: { followerId: userId } } } }] } } } }] } }); if (!todo) throw new NotFoundException("TODO를 찾을 수 없어요."); await this.assertNotBlocked(userId, todo.userId); return todo; }
  private async ownTodoList(userId: string, id: string) { const list = await this.prisma.todoList.findFirst({ where: { id, userId } }); if (!list) throw new NotFoundException("TODO 리스트를 찾을 수 없어요."); return list; }
  private async readableTodoList(userId: string, id: string) { const list = await this.prisma.todoList.findFirst({ where: { id, user: { suspendedAt: null, deletionRequestedAt: null }, OR: [{ userId }, { visibility: Visibility.PUBLIC }, { visibility: Visibility.FOLLOWERS, user: { followers: { some: { followerId: userId } } } }, { posts: { some: { hiddenAt: null, OR: [{ visibility: Visibility.PUBLIC }, { visibility: Visibility.FOLLOWERS, author: { followers: { some: { followerId: userId } } } }] } } }] }, include: { items: { include: { todo: true }, orderBy: { order: "asc" } } } }); if (!list) throw new NotFoundException("TODO 리스트를 찾을 수 없어요."); await this.assertNotBlocked(userId, list.userId); return list; }
  private async readablePost(postId: string, userId: string | null) {
    const visibility: Prisma.PostWhereInput[] = [{ visibility: Visibility.PUBLIC }];
    if (userId) visibility.push({ authorId: userId }, { visibility: Visibility.FOLLOWERS, author: { followers: { some: { followerId: userId } } } });
    const post = await this.prisma.post.findFirst({ where: { id: postId, hiddenAt: null, author: { suspendedAt: null, deletionRequestedAt: null }, OR: visibility }, include: postRelations(userId) });
    if (!post) throw new NotFoundException("게시물을 찾을 수 없어요.");
    if (userId) await this.assertNotBlocked(userId, post.authorId);
    return post;
  }
  private async blockedUserIds(viewerId: string | null) {
    if (!viewerId) return [];
    const rows = await this.prisma.block.findMany({ where: { OR: [{ blockerId: viewerId }, { blockedId: viewerId }] }, select: { blockerId: true, blockedId: true } });
    return rows.map((row) => row.blockerId === viewerId ? row.blockedId : row.blockerId);
  }
  private async assertNotBlocked(viewerId: string, targetId: string) {
    if (viewerId === targetId) return;
    const blocked = await this.prisma.block.count({ where: { OR: [{ blockerId: viewerId, blockedId: targetId }, { blockerId: targetId, blockedId: viewerId }] } });
    if (blocked) throw new NotFoundException("내용을 찾을 수 없어요.");
  }
  private async serializePost(post: PostRow) {
    const postMedia = post.media[0];
    const avatarUrl = post.author.avatarMedia
      ? await this.media.viewUrl(post.author.avatarMedia.thumbnailKey ?? post.author.avatarMedia.objectKey)
      : post.author.avatarUrl;
    return {
      id: post.id,
      author: { ...post.author, avatarMedia: undefined, avatarUrl, cloudRank: rankOf(post.author.lifetimePower) },
      caption: post.caption,
      mediaId: postMedia?.id ?? null,
      mediaUrl: postMedia ? await this.media.viewUrl(postMedia.objectKey) : post.mediaKey ? await this.media.viewUrl(post.mediaKey) : null,
      thumbnailUrl: postMedia?.thumbnailKey ? await this.media.viewUrl(postMedia.thumbnailKey) : null,
      hashtags: post.tags.map(({ tag }) => tag.name),
      todos: post.todos.map(({ todo }) => ({ id: todo.id, title: todo.title, notes: todo.notes, category: todo.category, categoryId: todo.categoryId, categoryRef: todo.categoryRef, dueDate: todo.dueDate, completedAt: todo.completedAt, visibility: todo.visibility, repeatRule: todo.repeatRule, sourceTodoId: todo.sourceTodoId, seriesId: todo.seriesId, occurrenceKey: todo.occurrenceKey })),
      todoList: post.todoList ? { id: post.todoList.id, title: post.todoList.title, description: post.todoList.description, visibility: post.todoList.visibility, sourceTodoListId: post.todoList.sourceTodoListId, items: post.todoList.items.map((item) => ({ order: item.order, todo: item.todo })) } : null,
      cheerCount: post._count.cheers,
      commentCount: post._count.comments,
      copyCount: post.todoList?._count.copies ?? post.todos.reduce((sum, link) => sum + link.todo._count.copies, 0),
      createdAt: post.createdAt,
      cheered: post.cheers.length > 0,
    };
  }
  private async serializeUserSummary(user: { id: string; nickname: string; handle: string; avatarUrl: string | null; avatarMedia: { objectKey: string; thumbnailKey: string | null } | null; lifetimePower: number }) {
    return {
      id: user.id,
      nickname: user.nickname,
      handle: user.handle,
      avatarUrl: user.avatarMedia ? await this.media.viewUrl(user.avatarMedia.thumbnailKey ?? user.avatarMedia.objectKey) : user.avatarUrl,
      lifetimePower: user.lifetimePower,
      cloudRank: rankOf(user.lifetimePower),
    };
  }
  private async assertMember(userId: string, conversationId: string) { const found = await this.prisma.conversationMember.findUnique({ where: { conversationId_userId: { conversationId, userId } } }); if (!found) throw new ForbiddenException("대화에 참여할 수 없어요."); }
  private async createConversation(a: string, b: string) { const existing = await this.prisma.conversation.findFirst({ where: { kind: ConversationKind.DIRECT, AND: [{ members: { some: { userId: a } } }, { members: { some: { userId: b } } }] }, include: { members: true } }); if (existing?.members.length === 2) return existing; return this.prisma.conversation.create({ data: { kind: ConversationKind.DIRECT, members: { create: [{ userId: a }, { userId: b }] } }, include: { members: true } }); }
  private notify(userId: string, type: NotificationType, title: string, body: string, referenceId?: string, targetType?: string, targetId?: string) { return this.prisma.notification.create({ data: { userId, type, title, body, referenceId, targetType, targetId } }); }
}
