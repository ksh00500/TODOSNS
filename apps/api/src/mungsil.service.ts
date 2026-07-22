import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { ChallengeKind, NotificationType, Prisma, ReportTarget, RequestStatus, VerificationMode, Visibility } from "@prisma/client";
import { PrismaService } from "./prisma.service";
import { CheckInDto, CloneTodoDto, CompleteTodoDto, CreateChallengeDto, CreatePostDto, CreateReportDto, CreateTodoDto, PageDto, SendMessageDto, UpdateTodoDto } from "./dtos";

const COMMUNITY_CHALLENGE_COST = 500;
export const rankOf = (power: number) => power >= 5000 ? "별구름" : power >= 2000 ? "노을구름" : power >= 800 ? "뭉게구름" : power >= 300 ? "솜구름" : power >= 100 ? "조각구름" : "구름씨앗";

@Injectable()
export class MungsilService {
  constructor(private readonly prisma: PrismaService) {}

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

  createTodo(userId: string, dto: CreateTodoDto) { return this.prisma.todo.create({ data: { ...dto, userId, dueDate: new Date(dto.dueDate), kind: dto.repeatRule ? "ROUTINE" : "SINGLE" } }); }
  listTodos(userId: string, from?: string, to?: string) { return this.prisma.todo.findMany({ where: { userId, deletedAt: null, dueDate: { gte: from ? new Date(from) : undefined, lte: to ? new Date(to) : undefined } }, orderBy: [{ completedAt: "asc" }, { dueDate: "asc" }] }); }

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
    const source = await this.prisma.todo.findFirst({ where: { id: sourceId, deletedAt: null } });
    if (!source) throw new NotFoundException("TODO를 찾을 수 없어요.");
    const todo = await this.prisma.todo.create({ data: { userId, sourceTodoId: source.id, title: dto.title ?? source.title, notes: dto.notes ?? source.notes, category: dto.category ?? source.category, dueDate: dto.dueDate ? new Date(dto.dueDate) : new Date(), repeatRule: dto.keepRepeat ? (dto.repeatRule ?? source.repeatRule) : null, kind: dto.keepRepeat && source.repeatRule ? "ROUTINE" : "SINGLE", visibility: dto.visibility ?? Visibility.PRIVATE } });
    if (source.userId !== userId) await this.reward(source.userId, 5, "UNIQUE_COPY", todo.id, 3);
    return todo;
  }

  async createPost(userId: string, dto: CreatePostDto) {
    const todo = await this.ownTodo(userId, dto.todoId);
    if (!todo.completedAt) throw new BadRequestException("완료한 TODO만 공유할 수 있어요.");
    const post = await this.prisma.post.create({ data: { authorId: userId, caption: dto.caption, mediaKey: dto.mediaKey, visibility: dto.visibility, todos: { create: { todoId: todo.id } } }, include: { todos: { include: { todo: true } }, author: true } });
    await this.reward(userId, 5, "SHARE", post.id, 2);
    return post;
  }

  async feed(userId: string, page: PageDto, mode = "mix") {
    const blocked = await this.prisma.block.findMany({ where: { OR: [{ blockerId: userId }, { blockedId: userId }] } });
    const hiddenIds = blocked.map((b) => b.blockerId === userId ? b.blockedId : b.blockerId);
    const orderBy: Prisma.PostOrderByWithRelationInput[] = mode === "recent" ? [{ createdAt: "desc" }] : [{ cheers: { _count: "desc" } }, { createdAt: "desc" }];
    const rows = await this.prisma.post.findMany({ take: page.limit + 1, cursor: page.cursor ? { id: page.cursor } : undefined, skip: page.cursor ? 1 : 0, where: { hiddenAt: null, visibility: Visibility.PUBLIC, authorId: { notIn: hiddenIds } }, orderBy, include: { author: { select: { id: true, nickname: true, handle: true, avatarUrl: true, lifetimePower: true } }, todos: { include: { todo: true } }, _count: { select: { cheers: true, comments: true } }, cheers: { where: { userId }, select: { userId: true } } } });
    const nextCursor = rows.length > page.limit ? rows[page.limit].id : null;
    return { items: rows.slice(0, page.limit).map((p) => ({ ...p, cheered: p.cheers.length > 0, rank: rankOf(p.author.lifetimePower) })), nextCursor };
  }

  async toggleCheer(userId: string, postId: string) {
    const existing = await this.prisma.cheer.findUnique({ where: { userId_postId: { userId, postId } } });
    if (existing) { await this.prisma.cheer.delete({ where: { userId_postId: { userId, postId } } }); return { cheered: false }; }
    const post = await this.prisma.post.findUniqueOrThrow({ where: { id: postId } });
    await this.prisma.cheer.create({ data: { userId, postId } });
    if (post.authorId !== userId) { await this.reward(userId, 1, "SOCIAL", postId, 5); await this.notify(post.authorId, NotificationType.CHEER, "응원을 받았어요", "누군가 회원님의 완료를 응원했어요.", postId); }
    return { cheered: true };
  }

  async comment(userId: string, postId: string, body: string) {
    const post = await this.prisma.post.findUniqueOrThrow({ where: { id: postId } });
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

  async joinChallenge(userId: string, challengeId: string) { return this.prisma.challengeParticipant.upsert({ where: { challengeId_userId: { challengeId, userId } }, create: { challengeId, userId }, update: {} }); }

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
  private async assertMember(userId: string, conversationId: string) { const found = await this.prisma.conversationMember.findUnique({ where: { conversationId_userId: { conversationId, userId } } }); if (!found) throw new ForbiddenException("대화에 참여할 수 없어요."); }
  private async createConversation(a: string, b: string) { const existing = await this.prisma.conversation.findFirst({ where: { AND: [{ members: { some: { userId: a } } }, { members: { some: { userId: b } } }] }, include: { members: true } }); if (existing?.members.length === 2) return existing; return this.prisma.conversation.create({ data: { members: { create: [{ userId: a }, { userId: b }] } }, include: { members: true } }); }
  private notify(userId: string, type: NotificationType, title: string, body: string, referenceId?: string) { return this.prisma.notification.create({ data: { userId, type, title, body, referenceId } }); }
}
