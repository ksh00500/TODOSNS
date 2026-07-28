import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { ChallengeKind, NotificationType, Prisma, ReportTarget, RequestStatus, RewardStatus, VerificationMode, Visibility } from "@prisma/client";
import { PrismaService } from "./prisma.service";
import { MediaService } from "./media.service";
import { CheckInDto, CloneTodoDto, CloneTodoListDto, CompleteTodoDto, CreateChallengeDto, CreatePostDto, CreateReportDto, CreateTodoDto, CreateTodoListDto, PageDto, SearchDto, SendMessageDto, UpdateProfileDto, UpdateTodoDto, UpdateTodoListDto } from "./dtos";
import { RecurrenceService } from "./recurrence.service";

const COMMUNITY_CHALLENGE_COST = 500;
export const rankOf = (power: number) => power >= 5000 ? "별구름" : power >= 2000 ? "노을구름" : power >= 800 ? "뭉게구름" : power >= 300 ? "솜구름" : power >= 100 ? "조각구름" : "구름씨앗";

const postRelations = (viewerId: string | null) => ({
  author: { select: { id: true, nickname: true, handle: true, avatarUrl: true, avatarMedia: true, lifetimePower: true } },
  todos: { include: { todo: { include: { _count: { select: { copies: { where: { deletedAt: null } } } } } } }, orderBy: { order: "asc" as const } },
  todoList: { include: { items: { include: { todo: true }, orderBy: { order: "asc" as const } }, _count: { select: { copies: true } } } },
  media: { where: { status: "READY" as const }, orderBy: { createdAt: "asc" as const }, take: 1 },
  _count: { select: { cheers: true, comments: { where: { hiddenAt: null } } } },
  cheers: { where: { userId: viewerId ?? "__guest__" }, select: { userId: true } },
}) satisfies Prisma.PostInclude;

type PostRow = Prisma.PostGetPayload<{ include: ReturnType<typeof postRelations> }>;

@Injectable()
export class MungsilService {
  constructor(private readonly prisma: PrismaService, private readonly media: MediaService, private readonly recurrence: RecurrenceService) {}

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
    const [user, completedCount, receivedCheers, copiedCount] = await Promise.all([
      this.prisma.user.findUniqueOrThrow({ where: { id: userId }, include: { avatarMedia: true, _count: { select: { followers: true, following: true, posts: { where: { hiddenAt: null } } } } } }),
      this.prisma.todo.count({ where: { userId, completedAt: { not: null }, deletedAt: null } }),
      this.prisma.cheer.count({ where: { post: { authorId: userId, hiddenAt: null } } }),
      this.prisma.todo.count({ where: { sourceTodo: { userId }, deletedAt: null } }),
    ]);
    const avatarUrl = user.avatarMedia ? await this.media.viewUrl(user.avatarMedia.thumbnailKey ?? user.avatarMedia.objectKey) : user.avatarUrl;
    return { ...user, avatarMedia: undefined, avatarUrl, passwordHash: undefined, rank: rankOf(user.lifetimePower), stats: { completedCount, receivedCheers, copiedCount } };
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

  async createTodo(userId: string, dto: CreateTodoDto) {
    if (dto.repeatRule) {
      const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { timezone: true } });
      return this.recurrence.createSeries(userId, user.timezone, dto);
    }
    return this.prisma.todo.create({ data: { ...dto, userId, dueDate: new Date(dto.dueDate), kind: "SINGLE" } });
  }
  listTodos(userId: string, from?: string, to?: string) { return this.prisma.todo.findMany({ where: { userId, deletedAt: null, dueDate: { gte: from ? new Date(from) : undefined, lte: to ? new Date(to) : undefined } }, orderBy: [{ completedAt: "asc" }, { dueDate: "asc" }] }); }

  listTodoLists(userId: string) { return this.prisma.todoList.findMany({ where: { userId }, orderBy: { updatedAt: "desc" }, include: { items: { include: { todo: true }, orderBy: { order: "asc" } }, _count: { select: { copies: true } } } }); }

  async createTodoList(userId: string, dto: CreateTodoListDto) {
    const todoIds = [...new Set(dto.todoIds)];
    const owned = await this.prisma.todo.count({ where: { id: { in: todoIds }, userId, deletedAt: null } });
    if (owned !== todoIds.length) throw new ForbiddenException("내 TODO만 리스트에 담을 수 있어요.");
    return this.prisma.todoList.create({ data: { userId, title: dto.title, description: dto.description, visibility: dto.visibility, items: { create: todoIds.map((todoId, order) => ({ todoId, order })) } }, include: { items: { include: { todo: true }, orderBy: { order: "asc" } }, _count: { select: { copies: true } } } });
  }

  async updateTodoList(userId: string, id: string, dto: UpdateTodoListDto) {
    await this.ownTodoList(userId, id);
    if (dto.todoIds) {
      const todoIds = [...new Set(dto.todoIds)];
      const owned = await this.prisma.todo.count({ where: { id: { in: todoIds }, userId, deletedAt: null } });
      if (owned !== todoIds.length) throw new ForbiddenException("내 TODO만 리스트에 담을 수 있어요.");
      return this.prisma.$transaction(async (tx) => {
        await tx.todoListItem.deleteMany({ where: { listId: id } });
        return tx.todoList.update({ where: { id }, data: { title: dto.title, description: dto.description, visibility: dto.visibility, items: { create: todoIds.map((todoId, order) => ({ todoId, order })) } }, include: { items: { include: { todo: true }, orderBy: { order: "asc" } }, _count: { select: { copies: true } } } });
      });
    }
    return this.prisma.todoList.update({ where: { id }, data: dto, include: { items: { include: { todo: true }, orderBy: { order: "asc" } }, _count: { select: { copies: true } } } });
  }

  async removeTodoList(userId: string, id: string) { await this.ownTodoList(userId, id); const shared = await this.prisma.post.count({ where: { todoListId: id, hiddenAt: null } }); if (shared) throw new BadRequestException("공유 중인 루틴은 삭제할 수 없어요."); await this.prisma.todoList.delete({ where: { id } }); return { ok: true }; }

  async cloneTodoList(userId: string, id: string, dto: CloneTodoListDto) {
    const source = await this.readableTodoList(userId, id);
    const baseDate = dto.dueDate ? new Date(dto.dueDate) : new Date();
    const sourceBase = source.items.reduce((minimum, item) => Math.min(minimum, item.todo.dueDate.getTime()), source.items[0]?.todo.dueDate.getTime() ?? baseDate.getTime());
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { timezone: true } });
    const cloned = await this.prisma.$transaction(async (tx) => {
      const list = await tx.todoList.create({ data: { userId, sourceTodoListId: source.id, title: dto.title ?? source.title, description: source.description, visibility: Visibility.PRIVATE } });
      for (const item of source.items) {
        const dueDate = new Date(baseDate.getTime() + item.todo.dueDate.getTime() - sourceBase);
        const todo = item.todo.repeatRule
          ? await this.recurrence.createSeriesInTransaction(tx, userId, user.timezone, { title: item.todo.title, notes: item.todo.notes ?? undefined, category: item.todo.category, dueDate: dueDate.toISOString(), repeatRule: item.todo.repeatRule, visibility: Visibility.PRIVATE }, item.todo.id)
          : await tx.todo.create({ data: { userId, sourceTodoId: item.todo.id, title: item.todo.title, notes: item.todo.notes, category: item.todo.category, dueDate, kind: "SINGLE", visibility: Visibility.PRIVATE } });
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
    if (todo.seriesId && dto.recurrenceScope === "FUTURE") {
      return dto.repeatRule === null
        ? this.recurrence.stopSeriesFrom(userId, todoId, dto)
        : this.recurrence.updateFuture(userId, todoId, dto);
    }
    if (todo.seriesId && dto.repeatRule === null) {
      return this.prisma.todo.update({
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
    }
    if (!todo.seriesId && dto.repeatRule) {
      const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { timezone: true } });
      const merged: CreateTodoDto = {
        title: dto.title ?? todo.title,
        notes: dto.notes === undefined ? todo.notes ?? undefined : dto.notes,
        category: dto.category ?? todo.category,
        dueDate: dto.dueDate ?? todo.dueDate.toISOString(),
        repeatRule: dto.repeatRule,
        visibility: dto.visibility ?? todo.visibility,
      };
      return this.recurrence.convertTodo(userId, todoId, user.timezone, merged);
    }
    return this.prisma.todo.update({
      where: { id: todoId },
      data: {
        title: dto.title,
        notes: dto.notes,
        category: dto.category,
        repeatRule: dto.repeatRule,
        visibility: dto.visibility,
        dueDate: dto.dueDate ? new Date(dto.dueDate) : undefined,
      },
    });
  }

  async removeTodo(userId: string, todoId: string) {
    await this.ownTodo(userId, todoId);
    const shared = await this.prisma.postTodo.count({ where: { todoId, post: { hiddenAt: null } } });
    if (shared) throw new BadRequestException("공유한 게시물을 먼저 삭제한 뒤 TODO를 삭제해주세요.");
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
    const post = dto.share ? await this.createPost(userId, { todoId, caption: dto.caption, mediaId: dto.mediaId, visibility: dto.visibility }) : null;
    return { todo: await this.prisma.todo.findUniqueOrThrow({ where: { id: todoId } }), post, sharePrompt: !dto.share };
  }

  async uncompleteTodo(userId: string, todoId: string) {
    await this.ownTodo(userId, todoId);
    const shared = await this.prisma.postTodo.count({ where: { todoId, post: { hiddenAt: null } } });
    if (shared) throw new BadRequestException("공유한 게시물을 먼저 삭제한 뒤 완료를 취소해주세요.");
    return this.prisma.todo.update({ where: { id: todoId }, data: { completedAt: null } });
  }

  async cloneTodo(userId: string, sourceId: string, dto: CloneTodoDto) {
    const source = await this.readableTodo(userId, sourceId);
    const repeatRule = dto.keepRepeat ? (dto.repeatRule ?? source.repeatRule) : null;
    const dueDate = dto.dueDate ?? new Date().toISOString();
    const todo = repeatRule
      ? await this.prisma.$transaction(async (tx) => {
          const user = await tx.user.findUniqueOrThrow({ where: { id: userId }, select: { timezone: true } });
          return this.recurrence.createSeriesInTransaction(tx, userId, user.timezone, { title: dto.title ?? source.title, notes: dto.notes ?? source.notes ?? undefined, category: dto.category ?? source.category, dueDate, repeatRule, visibility: dto.visibility ?? Visibility.PRIVATE }, source.id);
        })
      : await this.prisma.todo.create({ data: { userId, sourceTodoId: source.id, title: dto.title ?? source.title, notes: dto.notes ?? source.notes, category: dto.category ?? source.category, dueDate: new Date(dueDate), kind: "SINGLE", visibility: dto.visibility ?? Visibility.PRIVATE } });
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
      if (!todo.completedAt) throw new BadRequestException("완료한 TODO만 공유할 수 있어요.");
      todoId = todo.id;
    }
    if (dto.todoListId) {
      const list = await this.ownTodoList(userId, dto.todoListId);
      const count = await this.prisma.todoListItem.count({ where: { listId: list.id } });
      if (!count) throw new BadRequestException("비어 있는 TODO 리스트는 공유할 수 없어요.");
    }
    const created = await this.prisma.post.create({ data: { authorId: userId, caption: dto.caption, visibility: dto.visibility, todoListId: dto.todoListId, todos: todoId ? { create: { todoId } } : undefined } });
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
    const text = query.query.trim();
    const hiddenIds = await this.blockedUserIds(viewerId);
    const [users, posts] = await Promise.all([
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
        take: 8,
        orderBy: [{ lifetimePower: "desc" }, { id: "asc" }],
        select: { id: true, nickname: true, handle: true, avatarUrl: true, avatarMedia: true, lifetimePower: true },
      }),
      this.prisma.post.findMany({
        where: {
          visibility: Visibility.PUBLIC,
          hiddenAt: null,
          authorId: { notIn: hiddenIds },
          author: { suspendedAt: null, deletionRequestedAt: null },
          OR: [
            { caption: { contains: text, mode: "insensitive" } },
            { todos: { some: { todo: { title: { contains: text, mode: "insensitive" }, deletedAt: null } } } },
            { todoList: { title: { contains: text, mode: "insensitive" } } },
          ],
        },
        take: Math.min(query.limit, 20),
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        include: postRelations(viewerId),
      }),
    ]);
    return {
      users: await Promise.all(users.map(async (user) => ({
        id: user.id,
        nickname: user.nickname,
        handle: user.handle,
        lifetimePower: user.lifetimePower,
        cloudRank: rankOf(user.lifetimePower),
        avatarUrl: user.avatarMedia ? await this.media.viewUrl(user.avatarMedia.thumbnailKey ?? user.avatarMedia.objectKey) : user.avatarUrl,
      }))),
      posts: await Promise.all(posts.map((post) => this.serializePost(post))),
    };
  }

  async publicChallenges(viewerId: string | null) {
    const hiddenIds = await this.blockedUserIds(viewerId);
    const rows = await this.prisma.challenge.findMany({ where: { hiddenAt: null, endsAt: { gte: new Date() }, creatorId: { notIn: hiddenIds }, creator: { suspendedAt: null, deletionRequestedAt: null } }, orderBy: [{ kind: "asc" }, { startsAt: "asc" }], include: { _count: { select: { participants: true, checkIns: true } } } });
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
    const rows = await this.prisma.challenge.findMany({ where: { hiddenAt: null, endsAt: { gte: new Date() }, creatorId: { notIn: hiddenIds }, creator: { suspendedAt: null, deletionRequestedAt: null } }, orderBy: [{ kind: "asc" }, { startsAt: "asc" }], include: { _count: { select: { participants: true, checkIns: true } }, participants: { where: { userId }, select: { userId: true, joinedAt: true, rewardStatus: true } }, checkIns: { where: { userId }, select: { checkInDate: true } } } });
    const today = await this.userDate(userId);
    return rows.map((challenge) => {
      const elapsedDays = this.challengeElapsedDays(challenge.startsAt, challenge.endsAt);
      return {
        ...challenge,
        joined: challenge.participants.length > 0,
        todayCheckedIn: challenge.checkIns.some((item) => item.checkInDate.getTime() === today.getTime()),
        myCheckInCount: challenge.checkIns.length,
        successRate: elapsedDays ? Math.min(100, Math.round(challenge.checkIns.length / elapsedDays * 100)) : 0,
      };
    });
  }

  async challengeDetail(challengeId: string, userId: string | null) {
    const challenge = await this.prisma.challenge.findFirst({
      where: { id: challengeId, hiddenAt: null, creator: { suspendedAt: null, deletionRequestedAt: null } },
      include: {
        creator: { select: { id: true, nickname: true, handle: true } },
        _count: { select: { participants: true, checkIns: true } },
      },
    });
    if (!challenge) throw new NotFoundException("챌린지를 찾을 수 없어요.");
    if (userId) await this.assertNotBlocked(userId, challenge.creator.id);
    const [participant, checkIns] = userId ? await Promise.all([
      this.prisma.challengeParticipant.findUnique({ where: { challengeId_userId: { challengeId, userId } }, select: { joinedAt: true, rewardStatus: true } }),
      this.prisma.challengeCheckIn.findMany({ where: { challengeId, userId }, orderBy: { checkInDate: "desc" }, include: { media: { where: { status: "READY" }, take: 1 } } }),
    ]) : [null, []];
    const today = userId ? await this.userDate(userId) : null;
    const elapsedDays = this.challengeElapsedDays(challenge.startsAt, challenge.endsAt);
    return {
      ...challenge,
      participants: participant ? [participant] : [],
      joined: Boolean(participant),
      todayCheckedIn: today ? checkIns.some((item) => item.checkInDate.getTime() === today.getTime()) : false,
      myCheckInCount: checkIns.length,
      successRate: elapsedDays ? Math.min(100, Math.round(checkIns.length / elapsedDays * 100)) : 0,
      checkIns: await Promise.all(checkIns.map(async (item) => ({
        id: item.id,
        checkInDate: item.checkInDate,
        note: item.note,
        mediaUrl: item.media[0] ? await this.media.viewUrl(item.media[0].thumbnailKey ?? item.media[0].objectKey) : null,
      }))),
    };
  }

  async createChallenge(userId: string, role: string, dto: CreateChallengeDto) {
    const start = new Date(dto.startsAt), end = new Date(dto.endsAt);
    if (end <= start) throw new BadRequestException("종료일은 시작일보다 뒤여야 해요.");
    if (dto.kind === ChallengeKind.OFFICIAL && !["ADMIN", "MODERATOR"].includes(role)) throw new ForbiddenException("공식 챌린지는 운영자만 만들 수 있어요.");
    if (dto.kind === ChallengeKind.COMMUNITY) {
      const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
      if (user.availablePoints < COMMUNITY_CHALLENGE_COST) throw new BadRequestException("커뮤니티 챌린지 생성에는 500 포인트가 필요해요.");
    }
    return this.prisma.$transaction(async (tx) => {
      if (dto.kind === ChallengeKind.COMMUNITY) {
        const charged = await tx.user.updateMany({ where: { id: userId, availablePoints: { gte: COMMUNITY_CHALLENGE_COST } }, data: { availablePoints: { decrement: COMMUNITY_CHALLENGE_COST } } });
        if (charged.count !== 1) throw new BadRequestException("커뮤니티 챌린지 생성에는 500 포인트가 필요해요.");
      }
      const challenge = await tx.challenge.create({ data: { creatorId: userId, title: dto.title, description: dto.description, kind: dto.kind, verificationMode: dto.verificationMode, startsAt: start, endsAt: end, pointCost: dto.kind === ChallengeKind.COMMUNITY ? COMMUNITY_CHALLENGE_COST : 0, rewardLabel: dto.rewardLabel, rewardTerms: dto.rewardTerms } });
      if (dto.kind === ChallengeKind.COMMUNITY) await tx.pointLedger.create({ data: { userId, amount: -COMMUNITY_CHALLENGE_COST, reason: "CREATE_CHALLENGE", referenceId: challenge.id } });
      return challenge;
    });
  }

  async joinChallenge(userId: string, challengeId: string) { const challenge = await this.prisma.challenge.findFirst({ where: { id: challengeId, hiddenAt: null, startsAt: { lte: new Date() }, endsAt: { gte: new Date() } } }); if (!challenge) throw new BadRequestException("현재 참여할 수 없는 챌린지예요."); return this.prisma.challengeParticipant.upsert({ where: { challengeId_userId: { challengeId, userId } }, create: { challengeId, userId }, update: {} }); }

  async leaveChallenge(userId: string, challengeId: string) {
    const participant = await this.prisma.challengeParticipant.findUnique({ where: { challengeId_userId: { challengeId, userId } } });
    if (!participant) return { joined: false };
    const checkIns = await this.prisma.challengeCheckIn.findMany({ where: { challengeId, userId }, select: { id: true } });
    await this.prisma.$transaction([
      this.prisma.media.updateMany({ where: { checkInId: { in: checkIns.map((item) => item.id) } }, data: { checkInId: null } }),
      this.prisma.challengeCheckIn.deleteMany({ where: { challengeId, userId } }),
      this.prisma.challengeParticipant.delete({ where: { challengeId_userId: { challengeId, userId } } }),
    ]);
    return { joined: false };
  }

  async checkIn(userId: string, challengeId: string, dto: CheckInDto) {
    const challenge = await this.prisma.challenge.findUniqueOrThrow({ where: { id: challengeId } });
    const now = new Date(); if (now < challenge.startsAt || now > challenge.endsAt) throw new BadRequestException("인증 가능한 기간이 아니에요.");
    if (challenge.verificationMode === VerificationMode.REQUIRED_PHOTO && !dto.mediaId) throw new BadRequestException("사진 인증이 필요해요.");
    if (dto.mediaId) await this.media.readyOwned(userId, dto.mediaId);
    await this.joinChallenge(userId, challengeId);
    const date = await this.userDate(userId);
    const existing = await this.prisma.challengeCheckIn.findUnique({ where: { challengeId_userId_checkInDate: { challengeId, userId, checkInDate: date } } });
    if (existing) throw new ConflictException("오늘은 이미 인증했어요.");
    const checkIn = await this.prisma.challengeCheckIn.create({ data: { challengeId, userId, checkInDate: date, note: dto.note } });
    if (dto.mediaId) {
      try {
        await this.media.attachToCheckIn(userId, dto.mediaId, checkIn.id);
      } catch (error) {
        await this.prisma.challengeCheckIn.delete({ where: { id: checkIn.id } }).catch(() => undefined);
        throw error;
      }
    }
    return checkIn;
  }

  async updateChallengeReward(challengeId: string, userId: string, status: RewardStatus) {
    const challenge = await this.prisma.challenge.findUnique({ where: { id: challengeId } });
    if (!challenge || challenge.kind !== ChallengeKind.OFFICIAL) throw new BadRequestException("공식 챌린지의 보상만 관리할 수 있어요.");
    return this.prisma.challengeParticipant.update({ where: { challengeId_userId: { challengeId, userId } }, data: { rewardStatus: status } });
  }

  async adminChallengeParticipants(challengeId: string) {
    const challenge = await this.prisma.challenge.findUnique({ where: { id: challengeId }, select: { id: true, title: true, kind: true, rewardLabel: true, rewardTerms: true } });
    if (!challenge || challenge.kind !== ChallengeKind.OFFICIAL) throw new BadRequestException("공식 챌린지를 선택해주세요.");
    const participants = await this.prisma.challengeParticipant.findMany({
      where: { challengeId },
      orderBy: { joinedAt: "asc" },
      take: 500,
      include: { user: { select: { id: true, nickname: true, handle: true, email: true } } },
    });
    const counts = await this.prisma.challengeCheckIn.groupBy({ by: ["userId"], where: { challengeId }, _count: { _all: true } });
    const byUser = new Map(counts.map((item) => [item.userId, item._count._all]));
    return { challenge, items: participants.map((item) => ({ ...item, checkInCount: byUser.get(item.userId) ?? 0 })) };
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
  listConversations(userId: string) { return this.prisma.conversation.findMany({ where: { members: { some: { userId } } }, orderBy: { updatedAt: "desc" }, include: { members: { include: { user: { select: { id: true, nickname: true, handle: true, avatarUrl: true } } } }, messages: { take: 1, orderBy: { createdAt: "desc" } } } }); }
  async messages(userId: string, conversationId: string) { await this.assertMember(userId, conversationId); return this.prisma.message.findMany({ where: { conversationId, deletedAt: null }, orderBy: { createdAt: "asc" }, take: 100 }); }
  async sendMessage(userId: string, conversationId: string, dto: SendMessageDto) { await this.assertMember(userId, conversationId); const message = await this.prisma.message.create({ data: { senderId: userId, conversationId, body: dto.body } }); await this.prisma.conversation.update({ where: { id: conversationId }, data: { updatedAt: new Date() } }); return message; }

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
    }
    const duplicate = await this.prisma.report.findFirst({ where: { reporterId: userId, targetType: dto.targetType, targetId: dto.targetId, status: { in: ["OPEN", "REVIEWING"] } } });
    if (duplicate) throw new ConflictException("이미 접수된 신고예요.");
    const refs: Prisma.ReportUncheckedCreateInput = { reporterId: userId, targetType: dto.targetType, targetId: dto.targetId, reason: dto.reason };
    if (dto.targetType === ReportTarget.POST) refs.postRefId = dto.targetId;
    if (dto.targetType === ReportTarget.COMMENT) refs.commentRefId = dto.targetId;
    if (dto.targetType === ReportTarget.MESSAGE) refs.messageRefId = dto.targetId;
    if (dto.targetType === ReportTarget.CHALLENGE) refs.challengeRefId = dto.targetId;
    return this.prisma.report.create({ data: refs });
  }
  async adminReports() { return { items: await this.prisma.report.findMany({ orderBy: { createdAt: "desc" }, include: { reporter: { select: { id: true, nickname: true, handle: true } } } }) }; }
  async resolveReport(adminId: string, id: string, status: "RESOLVED" | "DISMISSED" | "REVIEWING", resolution: string) { return this.prisma.report.update({ where: { id }, data: { resolverId: adminId, status, resolution } }); }

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

  private async ownTodo(userId: string, todoId: string) { const todo = await this.prisma.todo.findFirst({ where: { id: todoId, userId, deletedAt: null } }); if (!todo) throw new NotFoundException("TODO를 찾을 수 없어요."); return todo; }
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
      todos: post.todos.map(({ todo }) => ({ id: todo.id, title: todo.title, notes: todo.notes, category: todo.category, dueDate: todo.dueDate, completedAt: todo.completedAt, visibility: todo.visibility, repeatRule: todo.repeatRule, sourceTodoId: todo.sourceTodoId, seriesId: todo.seriesId, occurrenceKey: todo.occurrenceKey })),
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
  private async createConversation(a: string, b: string) { const existing = await this.prisma.conversation.findFirst({ where: { AND: [{ members: { some: { userId: a } } }, { members: { some: { userId: b } } }] }, include: { members: true } }); if (existing?.members.length === 2) return existing; return this.prisma.conversation.create({ data: { members: { create: [{ userId: a }, { userId: b }] } }, include: { members: true } }); }
  private notify(userId: string, type: NotificationType, title: string, body: string, referenceId?: string, targetType?: string, targetId?: string) { return this.prisma.notification.create({ data: { userId, type, title, body, referenceId, targetType, targetId } }); }
}
