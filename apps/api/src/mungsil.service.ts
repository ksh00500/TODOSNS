import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { ChallengeKind, NotificationType, Prisma, ReportTarget, RequestStatus, VerificationMode, Visibility } from "@prisma/client";
import { PrismaService } from "./prisma.service";
import { MediaService } from "./media.service";
import { CheckInDto, CloneTodoDto, CloneTodoListDto, CompleteTodoDto, CreateChallengeDto, CreatePostDto, CreateReportDto, CreateTodoDto, CreateTodoListDto, PageDto, SendMessageDto, UpdateProfileDto, UpdateTodoDto, UpdateTodoListDto } from "./dtos";

const COMMUNITY_CHALLENGE_COST = 500;
export const rankOf = (power: number) => power >= 5000 ? "별구름" : power >= 2000 ? "노을구름" : power >= 800 ? "뭉게구름" : power >= 300 ? "솜구름" : power >= 100 ? "조각구름" : "구름씨앗";

const postRelations = (viewerId: string | null) => ({
  author: { select: { id: true, nickname: true, handle: true, avatarUrl: true, lifetimePower: true } },
  todos: { include: { todo: { include: { _count: { select: { copies: true } } } } }, orderBy: { order: "asc" as const } },
  todoList: { include: { items: { include: { todo: true }, orderBy: { order: "asc" as const } }, _count: { select: { copies: true } } } },
  _count: { select: { cheers: true, comments: true } },
  cheers: { where: { userId: viewerId ?? "__guest__" }, select: { userId: true } },
}) satisfies Prisma.PostInclude;

type PostRow = Prisma.PostGetPayload<{ include: ReturnType<typeof postRelations> }>;

@Injectable()
export class MungsilService {
  constructor(private readonly prisma: PrismaService, private readonly media: MediaService) {}

  private async reward(userId: string, amount: number, reason: string, referenceId: string, dailyCap?: number) {
    const start = new Date(); start.setHours(0, 0, 0, 0);
    if (dailyCap) {
      const count = await this.prisma.pointLedger.count({ where: { userId, reason, createdAt: { gte: start } } });
      if (count >= dailyCap) return false;
    }
    await this.prisma.$transaction([
      this.prisma.pointLedger.create({ data: { userId, amount, reason, referenceId } }),
      this.prisma.user.update({ where: { id: userId }, data: { availablePoints: { increment: amount }, lifetimePower: { increment: Math.max(amount, 0) }, recentVitality: { increment: Math.max(amount, 0) } } }),
    ]);
    return true;
  }

  async profile(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, include: { _count: { select: { followers: true, following: true, posts: true } } } });
    return { ...user, passwordHash: undefined, refreshTokenHash: undefined, rank: rankOf(user.lifetimePower) };
  }
  async updateProfile(userId: string, dto: UpdateProfileDto) { const user = await this.prisma.user.update({ where: { id: userId }, data: dto }); return { ...user, passwordHash: undefined, refreshTokenHash: undefined, rank: rankOf(user.lifetimePower) }; }

  createTodo(userId: string, dto: CreateTodoDto) { return this.prisma.todo.create({ data: { ...dto, userId, dueDate: new Date(dto.dueDate), kind: dto.repeatRule ? "ROUTINE" : "SINGLE" } }); }
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
    return this.prisma.$transaction(async (tx) => {
      const list = await tx.todoList.create({ data: { userId, sourceTodoListId: source.id, title: dto.title ?? source.title, description: source.description, visibility: Visibility.PRIVATE } });
      for (const item of source.items) {
        const todo = await tx.todo.create({ data: { userId, sourceTodoId: item.todo.id, title: item.todo.title, notes: item.todo.notes, category: item.todo.category, dueDate: baseDate, repeatRule: item.todo.repeatRule, kind: item.todo.repeatRule ? "ROUTINE" : "SINGLE", visibility: Visibility.PRIVATE } });
        await tx.todoListItem.create({ data: { listId: list.id, todoId: todo.id, order: item.order } });
      }
      return tx.todoList.findUniqueOrThrow({ where: { id: list.id }, include: { items: { include: { todo: true }, orderBy: { order: "asc" } }, _count: { select: { copies: true } } } });
    });
  }

  async updateTodo(userId: string, todoId: string, dto: UpdateTodoDto) {
    await this.ownTodo(userId, todoId);
    return this.prisma.todo.update({ where: { id: todoId }, data: { ...dto, dueDate: dto.dueDate ? new Date(dto.dueDate) : undefined, kind: dto.repeatRule ? "ROUTINE" : undefined } });
  }

  async removeTodo(userId: string, todoId: string) { await this.ownTodo(userId, todoId); return this.prisma.todo.update({ where: { id: todoId }, data: { deletedAt: new Date() } }); }

  async completeTodo(userId: string, todoId: string, dto: CompleteTodoDto) {
    const todo = await this.ownTodo(userId, todoId);
    if (!todo.completedAt) { await this.prisma.todo.update({ where: { id: todoId }, data: { completedAt: new Date() } }); await this.reward(userId, 10, "TODO_COMPLETE", todoId, 5); }
    const post = dto.share ? await this.createPost(userId, { todoId, caption: dto.caption, mediaKey: dto.mediaKey, visibility: dto.visibility }) : null;
    return { todo: await this.prisma.todo.findUniqueOrThrow({ where: { id: todoId } }), post, sharePrompt: !dto.share };
  }

  async cloneTodo(userId: string, sourceId: string, dto: CloneTodoDto) {
    const source = await this.readableTodo(userId, sourceId);
    const todo = await this.prisma.todo.create({ data: { userId, sourceTodoId: source.id, title: dto.title ?? source.title, notes: dto.notes ?? source.notes, category: dto.category ?? source.category, dueDate: dto.dueDate ? new Date(dto.dueDate) : new Date(), repeatRule: dto.keepRepeat ? (dto.repeatRule ?? source.repeatRule) : null, kind: dto.keepRepeat && source.repeatRule ? "ROUTINE" : "SINGLE", visibility: dto.visibility ?? Visibility.PRIVATE } });
    if (source.userId !== userId) await this.reward(source.userId, 5, "UNIQUE_COPY", todo.id, 3);
    return todo;
  }

  async createPost(userId: string, dto: CreatePostDto) {
    if (Boolean(dto.todoId) === Boolean(dto.todoListId)) throw new BadRequestException("TODO 또는 TODO 리스트 하나를 선택해주세요.");
    if (dto.mediaKey && !dto.mediaKey.startsWith(`uploads/${userId}/`)) throw new ForbiddenException("내가 업로드한 사진만 사용할 수 있어요.");
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
    const post = await this.prisma.post.create({ data: { authorId: userId, caption: dto.caption, mediaKey: dto.mediaKey, visibility: dto.visibility, todoListId: dto.todoListId, todos: todoId ? { create: { todoId } } : undefined }, include: postRelations(userId) });
    await this.reward(userId, 5, "SHARE", post.id, 2);
    return this.serializePost(post);
  }

  async feed(userId: string | null, page: PageDto, mode = "mix", category = "전체") {
    const blocked = userId ? await this.prisma.block.findMany({ where: { OR: [{ blockerId: userId }, { blockedId: userId }] } }) : [];
    const hiddenIds = blocked.map((b) => b.blockerId === userId ? b.blockedId : b.blockerId);
    const orderBy: Prisma.PostOrderByWithRelationInput[] = mode === "recent" ? [{ createdAt: "desc" }] : [{ cheers: { _count: "desc" } }, { createdAt: "desc" }];
    const visibility: Prisma.PostWhereInput[] = [{ visibility: Visibility.PUBLIC }];
    if (userId) visibility.push({ authorId: userId }, { visibility: Visibility.FOLLOWERS, author: { followers: { some: { followerId: userId } } } });
    const categoryFilter: Prisma.PostWhereInput | undefined = category && category !== "전체" ? { OR: [{ todos: { some: { todo: { category } } } }, { todoList: { items: { some: { todo: { category } } } } }] } : undefined;
    const rows = await this.prisma.post.findMany({ take: page.limit + 1, cursor: page.cursor ? { id: page.cursor } : undefined, skip: page.cursor ? 1 : 0, where: { hiddenAt: null, authorId: { notIn: hiddenIds }, author: { suspendedAt: null, deletionRequestedAt: null }, OR: visibility, AND: categoryFilter }, orderBy, include: postRelations(userId) });
    const nextCursor = rows.length > page.limit ? rows[page.limit].id : null;
    return { items: await Promise.all(rows.slice(0, page.limit).map((post) => this.serializePost(post))), nextCursor };
  }

  async postDetail(postId: string, userId: string | null) { return this.serializePost(await this.readablePost(postId, userId)); }

  async postComments(postId: string, userId: string | null) {
    await this.readablePost(postId, userId);
    return this.prisma.comment.findMany({ where: { postId, hiddenAt: null }, orderBy: { createdAt: "asc" }, include: { author: { select: { id: true, nickname: true, handle: true, avatarUrl: true, lifetimePower: true } } } });
  }

  async publicProfile(handle: string) {
    const user = await this.prisma.user.findFirst({ where: { handle, suspendedAt: null, deletionRequestedAt: null }, select: { id: true, nickname: true, handle: true, avatarUrl: true, bio: true, lifetimePower: true, recentVitality: true, _count: { select: { followers: true, following: true, posts: true } } } });
    if (!user) throw new NotFoundException("사용자를 찾을 수 없어요.");
    return { ...user, rank: rankOf(user.lifetimePower) };
  }

  publicChallenges() { return this.prisma.challenge.findMany({ where: { hiddenAt: null, endsAt: { gte: new Date() } }, orderBy: [{ kind: "asc" }, { startsAt: "asc" }], include: { _count: { select: { participants: true, checkIns: true } } } }); }

  async toggleCheer(userId: string, postId: string) {
    await this.readablePost(postId, userId);
    const existing = await this.prisma.cheer.findUnique({ where: { userId_postId: { userId, postId } } });
    if (existing) { await this.prisma.cheer.delete({ where: { userId_postId: { userId, postId } } }); return { cheered: false }; }
    const post = await this.prisma.post.findUniqueOrThrow({ where: { id: postId } });
    await this.prisma.cheer.create({ data: { userId, postId } });
    if (post.authorId !== userId) { await this.reward(userId, 1, "SOCIAL", postId, 5); await this.notify(post.authorId, NotificationType.CHEER, "응원을 받았어요", "누군가 회원님의 완료를 응원했어요.", postId); }
    return { cheered: true };
  }

  async comment(userId: string, postId: string, body: string) {
    const post = await this.readablePost(postId, userId);
    const comment = await this.prisma.comment.create({ data: { authorId: userId, postId, body }, include: { author: { select: { id: true, nickname: true, handle: true } } } });
    if (post.authorId !== userId) { await this.reward(userId, 1, "SOCIAL", comment.id, 5); await this.notify(post.authorId, NotificationType.COMMENT, "댓글이 달렸어요", body.slice(0, 60), postId); }
    return comment;
  }

  async listChallenges(userId: string) { return this.prisma.challenge.findMany({ where: { hiddenAt: null, endsAt: { gte: new Date() } }, orderBy: [{ kind: "asc" }, { startsAt: "asc" }], include: { _count: { select: { participants: true, checkIns: true } }, participants: { where: { userId }, select: { userId: true } } } }); }

  async createChallenge(userId: string, role: string, dto: CreateChallengeDto) {
    const start = new Date(dto.startsAt), end = new Date(dto.endsAt);
    if (end <= start) throw new BadRequestException("종료일은 시작일보다 뒤여야 해요.");
    if (dto.kind === ChallengeKind.OFFICIAL && !["ADMIN", "MODERATOR"].includes(role)) throw new ForbiddenException("공식 챌린지는 운영자만 만들 수 있어요.");
    if (dto.kind === ChallengeKind.COMMUNITY) {
      const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
      if (user.availablePoints < COMMUNITY_CHALLENGE_COST) throw new BadRequestException("커뮤니티 챌린지 생성에는 500 포인트가 필요해요.");
    }
    return this.prisma.$transaction(async (tx) => {
      const challenge = await tx.challenge.create({ data: { creatorId: userId, title: dto.title, description: dto.description, kind: dto.kind, verificationMode: dto.verificationMode, startsAt: start, endsAt: end, pointCost: dto.kind === ChallengeKind.COMMUNITY ? COMMUNITY_CHALLENGE_COST : 0, rewardLabel: dto.rewardLabel, rewardTerms: dto.rewardTerms } });
      if (dto.kind === ChallengeKind.COMMUNITY) { await tx.pointLedger.create({ data: { userId, amount: -COMMUNITY_CHALLENGE_COST, reason: "CREATE_CHALLENGE", referenceId: challenge.id } }); await tx.user.update({ where: { id: userId }, data: { availablePoints: { decrement: COMMUNITY_CHALLENGE_COST } } }); }
      return challenge;
    });
  }

  async joinChallenge(userId: string, challengeId: string) { const challenge = await this.prisma.challenge.findFirst({ where: { id: challengeId, hiddenAt: null, startsAt: { lte: new Date() }, endsAt: { gte: new Date() } } }); if (!challenge) throw new BadRequestException("현재 참여할 수 없는 챌린지예요."); return this.prisma.challengeParticipant.upsert({ where: { challengeId_userId: { challengeId, userId } }, create: { challengeId, userId }, update: {} }); }

  async checkIn(userId: string, challengeId: string, dto: CheckInDto) {
    const challenge = await this.prisma.challenge.findUniqueOrThrow({ where: { id: challengeId } });
    const now = new Date(); if (now < challenge.startsAt || now > challenge.endsAt) throw new BadRequestException("인증 가능한 기간이 아니에요.");
    if (challenge.verificationMode === VerificationMode.REQUIRED_PHOTO && !dto.mediaKey) throw new BadRequestException("사진 인증이 필요해요.");
    await this.joinChallenge(userId, challengeId);
    const date = new Date(); date.setHours(0, 0, 0, 0);
    return this.prisma.challengeCheckIn.upsert({ where: { challengeId_userId_checkInDate: { challengeId, userId, checkInDate: date } }, create: { challengeId, userId, checkInDate: date, note: dto.note, mediaKey: dto.mediaKey }, update: { note: dto.note, mediaKey: dto.mediaKey } });
  }

  async toggleFollow(userId: string, targetId: string) { if (userId === targetId) throw new BadRequestException("자기 자신은 팔로우할 수 없어요."); const key = { followerId_followingId: { followerId: userId, followingId: targetId } }; const found = await this.prisma.follow.findUnique({ where: key }); if (found) { await this.prisma.follow.delete({ where: key }); return { following: false }; } await this.prisma.follow.create({ data: { followerId: userId, followingId: targetId } }); await this.notify(targetId, NotificationType.FOLLOW, "새 팔로워가 생겼어요", "새로운 구름이 함께 떠오르기 시작했어요.", userId); return { following: true }; }

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

  notifications(userId: string) { return this.prisma.notification.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, take: 50 }); }
  readNotifications(userId: string) { return this.prisma.notification.updateMany({ where: { userId, readAt: null }, data: { readAt: new Date() } }); }
  async report(userId: string, dto: CreateReportDto) { const refs: Prisma.ReportUncheckedCreateInput = { reporterId: userId, targetType: dto.targetType, targetId: dto.targetId, reason: dto.reason }; if (dto.targetType === ReportTarget.POST) refs.postRefId = dto.targetId; if (dto.targetType === ReportTarget.COMMENT) refs.commentRefId = dto.targetId; if (dto.targetType === ReportTarget.MESSAGE) refs.messageRefId = dto.targetId; if (dto.targetType === ReportTarget.CHALLENGE) refs.challengeRefId = dto.targetId; return this.prisma.report.create({ data: refs }); }
  adminReports() { return this.prisma.report.findMany({ orderBy: { createdAt: "desc" }, include: { reporter: { select: { id: true, nickname: true, handle: true } } } }); }
  async resolveReport(adminId: string, id: string, status: "RESOLVED" | "DISMISSED" | "REVIEWING", resolution: string) { return this.prisma.report.update({ where: { id }, data: { resolverId: adminId, status, resolution } }); }

  private async ownTodo(userId: string, todoId: string) { const todo = await this.prisma.todo.findFirst({ where: { id: todoId, userId, deletedAt: null } }); if (!todo) throw new NotFoundException("TODO를 찾을 수 없어요."); return todo; }
  private async readableTodo(userId: string, todoId: string) { const todo = await this.prisma.todo.findFirst({ where: { id: todoId, deletedAt: null, OR: [{ userId }, { visibility: Visibility.PUBLIC }, { postLinks: { some: { post: { hiddenAt: null, OR: [{ visibility: Visibility.PUBLIC }, { visibility: Visibility.FOLLOWERS, author: { followers: { some: { followerId: userId } } } }] } } } }] } }); if (!todo) throw new NotFoundException("TODO를 찾을 수 없어요."); return todo; }
  private async ownTodoList(userId: string, id: string) { const list = await this.prisma.todoList.findFirst({ where: { id, userId } }); if (!list) throw new NotFoundException("TODO 리스트를 찾을 수 없어요."); return list; }
  private async readableTodoList(userId: string, id: string) { const list = await this.prisma.todoList.findFirst({ where: { id, OR: [{ userId }, { visibility: Visibility.PUBLIC }, { visibility: Visibility.FOLLOWERS, user: { followers: { some: { followerId: userId } } } }, { posts: { some: { hiddenAt: null, OR: [{ visibility: Visibility.PUBLIC }, { visibility: Visibility.FOLLOWERS, author: { followers: { some: { followerId: userId } } } }] } } }] }, include: { items: { include: { todo: true }, orderBy: { order: "asc" } } } }); if (!list) throw new NotFoundException("TODO 리스트를 찾을 수 없어요."); return list; }
  private async readablePost(postId: string, userId: string | null) {
    const visibility: Prisma.PostWhereInput[] = [{ visibility: Visibility.PUBLIC }];
    if (userId) visibility.push({ authorId: userId }, { visibility: Visibility.FOLLOWERS, author: { followers: { some: { followerId: userId } } } });
    const post = await this.prisma.post.findFirst({ where: { id: postId, hiddenAt: null, OR: visibility }, include: postRelations(userId) });
    if (!post) throw new NotFoundException("게시물을 찾을 수 없어요.");
    return post;
  }
  private async serializePost(post: PostRow) {
    return {
      id: post.id,
      author: { ...post.author, cloudRank: rankOf(post.author.lifetimePower) },
      caption: post.caption,
      mediaUrl: post.mediaKey ? await this.media.viewUrl(post.mediaKey) : null,
      todos: post.todos.map(({ todo }) => ({ id: todo.id, title: todo.title, notes: todo.notes, category: todo.category, dueDate: todo.dueDate, completedAt: todo.completedAt, visibility: todo.visibility, repeatRule: todo.repeatRule, sourceTodoId: todo.sourceTodoId })),
      todoList: post.todoList ? { id: post.todoList.id, title: post.todoList.title, description: post.todoList.description, visibility: post.todoList.visibility, sourceTodoListId: post.todoList.sourceTodoListId, items: post.todoList.items.map((item) => ({ order: item.order, todo: item.todo })) } : null,
      cheerCount: post._count.cheers,
      commentCount: post._count.comments,
      copyCount: post.todoList?._count.copies ?? post.todos.reduce((sum, link) => sum + link.todo._count.copies, 0),
      createdAt: post.createdAt,
      cheered: post.cheers.length > 0,
    };
  }
  private async assertMember(userId: string, conversationId: string) { const found = await this.prisma.conversationMember.findUnique({ where: { conversationId_userId: { conversationId, userId } } }); if (!found) throw new ForbiddenException("대화에 참여할 수 없어요."); }
  private async createConversation(a: string, b: string) { const existing = await this.prisma.conversation.findFirst({ where: { AND: [{ members: { some: { userId: a } } }, { members: { some: { userId: b } } }] }, include: { members: true } }); if (existing?.members.length === 2) return existing; return this.prisma.conversation.create({ data: { members: { create: [{ userId: a }, { userId: b }] } }, include: { members: true } }); }
  private notify(userId: string, type: NotificationType, title: string, body: string, referenceId?: string) { return this.prisma.notification.create({ data: { userId, type, title, body, referenceId } }); }
}
