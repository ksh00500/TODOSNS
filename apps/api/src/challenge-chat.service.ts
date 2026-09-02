import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { ChatModerationActionType, ChatNotificationLevel, ChatReactionType, ChallengeKind, ConversationKind, MessageKind, NotificationType, Prisma, Role } from "@prisma/client";
import { ChatEvents } from "./chat.events";
import { CreateChallengeChatMessageDto, MuteChatMemberDto, PageDto } from "./dtos";
import { MediaService } from "./media.service";
import { PrismaService } from "./prisma.service";

const messageInclude = {
  sender: { select: { id: true, nickname: true, handle: true, avatarUrl: true, avatarMedia: true, lifetimePower: true } },
  replyTo: { include: { sender: { select: { nickname: true } } } },
  media: { where: { status: "READY" }, orderBy: { messageOrder: "asc" } },
  reactions: { include: { user: { select: { id: true, nickname: true, handle: true, avatarUrl: true } } } },
} satisfies Prisma.MessageInclude;

type ChatMessageRow = Prisma.MessageGetPayload<{ include: typeof messageInclude }>;
type JwtRole = string;

const rankOf = (power: number) => power >= 5000 ? "별구름" : power >= 2000 ? "노을구름" : power >= 800 ? "뭉게구름" : power >= 300 ? "솜구름" : power >= 100 ? "조각구름" : "구름씨앗";
const isPrivileged = (role: JwtRole) => role === Role.ADMIN || role === Role.MODERATOR;

@Injectable()
export class ChallengeChatService {
  constructor(private readonly prisma: PrismaService, private readonly media: MediaService, private readonly events: ChatEvents) {}

  async chat(userId: string, role: JwtRole, challengeId: string, page: PageDto) {
    const context = await this.context(userId, challengeId);
    const cursor = this.decodeCursor(page.cursor);
    const rows = await this.prisma.message.findMany({
      where: { conversationId: context.room.id, ...(cursor ? { OR: [{ createdAt: { lt: cursor.createdAt } }, { createdAt: cursor.createdAt, id: { lt: cursor.id } }] } : {}) },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: page.limit + 1,
      include: messageInclude,
    });
    const hasMore = rows.length > page.limit;
    const visible = rows.slice(0, page.limit);
    const oldest = visible[visible.length - 1];
    const blocked = await this.blockedIds(userId);
    return {
      room: await this.summary(context, userId),
      items: await Promise.all(visible.reverse().map((item) => this.serialize(item, userId, role, context, blocked))),
      nextCursor: hasMore && oldest ? this.encodeCursor(oldest.createdAt, oldest.id) : null,
    };
  }

  async summaryForChallenge(userId: string, challengeId: string) {
    const context = await this.context(userId, challengeId);
    return this.summary(context, userId);
  }

  async send(userId: string, role: JwtRole, challengeId: string, dto: CreateChallengeChatMessageDto) {
    const context = await this.context(userId, challengeId);
    await this.assertWritable(context, userId);
    const body = dto.body?.trim() || null;
    const mediaIds = dto.mediaIds ?? [];
    if (!body && mediaIds.length === 0) throw new BadRequestException("메시지나 사진을 하나 이상 입력해주세요.");
    if (mediaIds.length > 4 || new Set(mediaIds).size !== mediaIds.length) throw new BadRequestException("사진은 메시지마다 최대 4장까지 올릴 수 있어요.");
    await Promise.all(mediaIds.map((id) => this.media.readyOwned(userId, id)));
    const replyTo = dto.replyToId ? await this.prisma.message.findFirst({ where: { id: dto.replyToId, conversationId: context.room.id, deletedAt: null, hiddenAt: null }, select: { id: true, senderId: true } }) : null;
    if (dto.replyToId && !replyTo) throw new BadRequestException("답장할 메시지를 찾을 수 없어요.");
    const message = await this.prisma.message.create({ data: { conversationId: context.room.id, senderId: userId, body, replyToId: replyTo?.id }, include: messageInclude });
    try { await this.media.attachToMessage(userId, mediaIds, message.id); }
    catch (error) { await this.prisma.message.delete({ where: { id: message.id } }).catch(() => undefined); throw error; }
    await this.prisma.conversation.update({ where: { id: context.room.id }, data: { updatedAt: new Date() } });
    const fresh = await this.prisma.message.findUniqueOrThrow({ where: { id: message.id }, include: messageInclude });
    const serialized = await this.serialize(fresh, userId, role, context, new Set());
    await this.notifyMembers(context, fresh, replyTo?.senderId ?? null);
    this.events.publish({ conversationId: context.room.id, type: "message.created", payload: serialized });
    return serialized;
  }

  async update(userId: string, role: JwtRole, messageId: string, bodyInput: string) {
    const message = await this.ownedMessage(userId, messageId);
    const context = await this.contextByConversation(userId, message.conversationId);
    await this.assertWritable(context, userId);
    if (Date.now() - message.createdAt.getTime() > 5 * 60_000) throw new ConflictException("메시지는 보낸 뒤 5분 동안만 수정할 수 있어요.");
    const body = bodyInput.trim() || null;
    const mediaCount = await this.prisma.media.count({ where: { messageId, status: "READY" } });
    if (!body && mediaCount === 0) throw new BadRequestException("내용이 없는 메시지는 저장할 수 없어요.");
    await this.prisma.$transaction([
      this.prisma.messageRevision.create({ data: { messageId, body: message.body } }),
      this.prisma.message.update({ where: { id: messageId }, data: { body, editedAt: new Date() } }),
    ]);
    const fresh = await this.prisma.message.findUniqueOrThrow({ where: { id: messageId }, include: messageInclude });
    const serialized = await this.serialize(fresh, userId, role, context, new Set());
    this.events.publish({ conversationId: context.room.id, type: "message.updated", payload: serialized });
    return serialized;
  }

  async remove(userId: string, messageId: string) {
    const message = await this.ownedMessage(userId, messageId);
    await this.contextByConversation(userId, message.conversationId);
    await this.prisma.message.update({ where: { id: messageId }, data: { deletedAt: new Date() } });
    this.events.publish({ conversationId: message.conversationId, type: "message.deleted", payload: { id: messageId } });
    return { ok: true };
  }

  async revisions(userId: string, messageId: string) {
    const message = await this.prisma.message.findUnique({ where: { id: messageId }, select: { id: true, conversationId: true, body: true, deletedAt: true, hiddenAt: true, editedAt: true } });
    if (!message) throw new NotFoundException("메시지를 찾을 수 없어요.");
    await this.contextByConversation(userId, message.conversationId);
    if (message.deletedAt || message.hiddenAt) throw new ForbiddenException("삭제되거나 숨겨진 메시지의 수정 기록은 볼 수 없어요.");
    const revisions = await this.prisma.messageRevision.findMany({ where: { messageId }, orderBy: { createdAt: "asc" } });
    return [...revisions, ...(message.editedAt ? [{ id: `${message.id}-current`, messageId, body: message.body, createdAt: message.editedAt }] : [])];
  }

  async toggleReaction(userId: string, role: JwtRole, messageId: string, type: ChatReactionType) {
    const message = await this.prisma.message.findUnique({ where: { id: messageId }, select: { conversationId: true, deletedAt: true, hiddenAt: true } });
    if (!message) throw new NotFoundException("메시지를 찾을 수 없어요.");
    const context = await this.contextByConversation(userId, message.conversationId);
    await this.assertWritable(context, userId);
    if (message.deletedAt || message.hiddenAt) throw new ConflictException("이 메시지에는 반응할 수 없어요.");
    const key = { messageId_userId_type: { messageId, userId, type } };
    const current = await this.prisma.messageReaction.findUnique({ where: key });
    if (current) await this.prisma.messageReaction.delete({ where: key });
    else await this.prisma.messageReaction.create({ data: { messageId, userId, type } });
    const fresh = await this.prisma.message.findUniqueOrThrow({ where: { id: messageId }, include: messageInclude });
    const serialized = await this.serialize(fresh, userId, role, context, new Set());
    this.events.publish({ conversationId: message.conversationId, type: "reaction.updated", payload: serialized });
    return serialized.reactions;
  }

  async reactionUsers(userId: string, messageId: string, type: ChatReactionType) {
    const message = await this.prisma.message.findUnique({ where: { id: messageId }, select: { conversationId: true } });
    if (!message) throw new NotFoundException("메시지를 찾을 수 없어요.");
    await this.contextByConversation(userId, message.conversationId);
    return this.prisma.messageReaction.findMany({ where: { messageId, type }, orderBy: { createdAt: "asc" }, select: { user: { select: { id: true, nickname: true, handle: true, avatarUrl: true } } } });
  }

  async markRead(userId: string, challengeId: string, messageId: string) {
    const context = await this.context(userId, challengeId);
    const message = await this.prisma.message.findFirst({ where: { id: messageId, conversationId: context.room.id }, select: { id: true, createdAt: true } });
    if (!message) throw new BadRequestException("읽은 위치를 찾을 수 없어요.");
    if (!context.member.lastReadAt || context.member.lastReadAt < message.createdAt) {
      await this.prisma.conversationMember.update({ where: { conversationId_userId: { conversationId: context.room.id, userId } }, data: { lastReadAt: message.createdAt, lastReadMessageId: message.id } });
    }
    await this.prisma.notification.updateMany({ where: { userId, chatConversationId: context.room.id }, data: { readAt: new Date(), unreadCount: 0 } });
    return { ok: true };
  }

  async settings(userId: string, challengeId: string, notificationLevel: ChatNotificationLevel) {
    const context = await this.context(userId, challengeId);
    await this.prisma.conversationMember.update({ where: { conversationId_userId: { conversationId: context.room.id, userId } }, data: { notificationLevel } });
    return { notificationLevel };
  }

  async members(userId: string, challengeId: string, page: PageDto) {
    const context = await this.context(userId, challengeId);
    const rows = await this.prisma.conversationMember.findMany({ where: { conversationId: context.room.id }, orderBy: [{ joinedAt: "asc" }, { userId: "asc" }], take: page.limit, include: { user: { select: { id: true, nickname: true, handle: true, avatarUrl: true, avatarMedia: true, lifetimePower: true } } } });
    const now = new Date();
    const mutes = await this.prisma.conversationMute.findMany({ where: { conversationId: context.room.id, userId: { in: rows.map((row) => row.userId) }, revokedAt: null, expiresAt: { gt: now } }, orderBy: { createdAt: "desc" } });
    return { items: await Promise.all(rows.map(async (row) => ({ user: await this.userSummary(row.user), joinedAt: row.joinedAt, mutedUntil: mutes.find((mute) => mute.userId === row.userId)?.expiresAt ?? null, canModerate: context.challenge.kind === ChallengeKind.COMMUNITY && context.challenge.creatorId === userId && row.userId !== userId }))), nextCursor: null };
  }

  async setHidden(actorId: string, role: JwtRole, messageId: string, hidden: boolean, reason: string) {
    const message = await this.prisma.message.findUnique({ where: { id: messageId }, include: { conversation: { include: { challenge: true } } } });
    if (!message) throw new NotFoundException("메시지를 찾을 수 없어요.");
    if (message.conversation.challenge) this.assertModerator(actorId, role, message.conversation.challenge);
    else if (message.conversation.kind !== ConversationKind.DIRECT || !isPrivileged(role)) throw new ForbiddenException("이 메시지를 관리할 권한이 없어요.");
    if (message.senderId === actorId) throw new BadRequestException("내 메시지는 삭제 기능을 이용해주세요.");
    const now = new Date();
    const operations: Prisma.PrismaPromise<unknown>[] = [
      this.prisma.message.update({ where: { id: messageId }, data: hidden ? { hiddenAt: now, hiddenById: actorId, hiddenReason: reason.trim() } : { hiddenAt: null, hiddenById: null, hiddenReason: null } }),
      this.prisma.chatModerationAction.create({ data: { conversationId: message.conversationId, actorId, targetUserId: message.senderId, messageId, type: hidden ? ChatModerationActionType.HIDE_MESSAGE : ChatModerationActionType.RESTORE_MESSAGE, reason: reason.trim() } }),
    ];
    if (isPrivileged(role)) operations.push(this.prisma.adminAuditLog.create({ data: { adminId: actorId, action: hidden ? "CHAT_MESSAGE_HIDDEN" : "CHAT_MESSAGE_RESTORED", targetType: "MESSAGE", targetId: messageId, summary: reason.trim(), metadata: { conversationId: message.conversationId } } }));
    await this.prisma.$transaction(operations);
    if (message.senderId) await this.prisma.notification.create({ data: { userId: message.senderId, type: NotificationType.SYSTEM, title: hidden ? "대화 메시지가 숨김 처리됐어요" : "대화 메시지가 복구됐어요", body: reason.trim(), targetType: message.conversation.challenge ? "CHALLENGE_CHAT" : "DIRECT_MESSAGE", targetId: message.conversation.challenge?.id ?? message.conversation.id } });
    this.events.publish({ conversationId: message.conversationId, type: hidden ? "message.deleted" : "message.updated", payload: { id: messageId, hidden } });
    return { ok: true };
  }

  async mute(actorId: string, role: JwtRole, challengeId: string, targetUserId: string, dto: MuteChatMemberDto) {
    const context = isPrivileged(role) ? await this.moderationContext(challengeId) : await this.context(actorId, challengeId);
    this.assertModerator(actorId, role, context.challenge);
    if (actorId === targetUserId) throw new BadRequestException("자신을 채팅 차단할 수 없어요.");
    const member = await this.prisma.conversationMember.findUnique({ where: { conversationId_userId: { conversationId: context.room.id, userId: targetUserId } } });
    if (!member) throw new NotFoundException("대화방 참여자를 찾을 수 없어요.");
    const expiresAt = new Date(Date.now() + dto.durationHours * 3600_000);
    const [mute] = await this.prisma.$transaction([
      this.prisma.conversationMute.create({ data: { conversationId: context.room.id, userId: targetUserId, mutedById: actorId, reason: dto.reason.trim(), expiresAt } }),
      this.prisma.chatModerationAction.create({ data: { conversationId: context.room.id, actorId, targetUserId, type: ChatModerationActionType.MUTE_MEMBER, reason: dto.reason.trim(), metadata: { expiresAt: expiresAt.toISOString() } } }),
      ...(isPrivileged(role) ? [this.prisma.adminAuditLog.create({ data: { adminId: actorId, action: "CHAT_MEMBER_MUTED", targetType: "USER", targetId: targetUserId, summary: dto.reason.trim(), metadata: { conversationId: context.room.id, expiresAt: expiresAt.toISOString() } } })] : []),
    ]);
    await this.prisma.notification.create({ data: { userId: targetUserId, type: NotificationType.SYSTEM, title: "대화방 채팅이 잠시 제한됐어요", body: `${dto.reason.trim()} · ${expiresAt.toLocaleString("ko-KR")}까지`, targetType: "CHALLENGE_CHAT", targetId: challengeId } });
    return mute;
  }

  async unmute(actorId: string, role: JwtRole, challengeId: string, targetUserId: string, reason: string) {
    const context = isPrivileged(role) ? await this.moderationContext(challengeId) : await this.context(actorId, challengeId);
    this.assertModerator(actorId, role, context.challenge);
    await this.prisma.$transaction([
      this.prisma.conversationMute.updateMany({ where: { conversationId: context.room.id, userId: targetUserId, revokedAt: null, expiresAt: { gt: new Date() } }, data: { revokedAt: new Date() } }),
      this.prisma.chatModerationAction.create({ data: { conversationId: context.room.id, actorId, targetUserId, type: ChatModerationActionType.UNMUTE_MEMBER, reason: reason.trim() } }),
      ...(isPrivileged(role) ? [this.prisma.adminAuditLog.create({ data: { adminId: actorId, action: "CHAT_MEMBER_UNMUTED", targetType: "USER", targetId: targetUserId, summary: reason.trim(), metadata: { conversationId: context.room.id } } })] : []),
    ]);
    return { ok: true };
  }

  async adminReportedContext(reportId: string) {
    const report = await this.prisma.report.findFirst({ where: { id: reportId, targetType: "MESSAGE" }, include: { message: { include: messageInclude } } });
    if (!report?.message) throw new NotFoundException("신고된 메시지를 찾을 수 없어요.");
    const before = await this.prisma.message.findMany({ where: { conversationId: report.message.conversationId, createdAt: { lt: report.message.createdAt } }, orderBy: { createdAt: "desc" }, take: 3, include: messageInclude });
    const after = await this.prisma.message.findMany({ where: { conversationId: report.message.conversationId, createdAt: { gt: report.message.createdAt } }, orderBy: { createdAt: "asc" }, take: 3, include: messageInclude });
    const revisions = await this.prisma.messageRevision.findMany({ where: { messageId: report.message.id }, orderBy: { createdAt: "asc" } });
    const items = await Promise.all([...before.reverse(), report.message, ...after].map(async (item) => ({
      id: item.id,
      body: item.body,
      sender: item.sender && { id: item.sender.id, nickname: item.sender.nickname, handle: item.sender.handle },
      deletedAt: item.deletedAt,
      hiddenAt: item.hiddenAt,
      createdAt: item.createdAt,
      media: await Promise.all(item.media.map(async (entry) => ({
        id: entry.id,
        url: await this.media.viewUrl(entry.objectKey),
        thumbnailUrl: entry.thumbnailKey ? await this.media.viewUrl(entry.thumbnailKey) : null,
      }))),
    })));
    return { reportId, targetMessageId: report.message.id, items, revisions };
  }

  async createSystemMessage(challengeId: string, systemKey: string, body: string, createdAt = new Date()) {
    const room = await this.prisma.conversation.findUnique({ where: { challengeId } });
    if (!room) return;
    const result = await this.prisma.message.create({ data: { conversationId: room.id, kind: MessageKind.SYSTEM, systemKey, body, createdAt } }).catch((error: unknown) => {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return null;
      throw error;
    });
    if (result) this.events.publish({ conversationId: room.id, type: "message.created", payload: { id: result.id, kind: result.kind, body: result.body, createdAt: result.createdAt } });
  }

  async closeRoom(challengeId: string, endedAt: Date) {
    const room = await this.prisma.conversation.findUnique({ where: { challengeId } });
    if (!room) return;
    await this.prisma.conversation.update({ where: { id: room.id }, data: { readOnlyAt: endedAt, purgeAt: new Date(endedAt.getTime() + 90 * 86_400_000) } });
    await this.createSystemMessage(challengeId, `CHALLENGE_ENDED_${endedAt.toISOString()}`, "챌린지가 종료됐어요. 대화는 90일 동안 읽을 수 있어요.", endedAt);
    this.events.publish({ conversationId: room.id, type: "room.closed", payload: { readOnlyAt: endedAt } });
  }

  @Cron("0 10 3 * * *", { timeZone: "UTC" })
  async maintainRooms() {
    const now = new Date();
    const newlyStarted = await this.prisma.conversation.findMany({ where: { kind: ConversationKind.CHALLENGE, challenge: { startsAt: { lte: now }, endedAt: null }, messages: { none: { systemKey: "CHALLENGE_STARTED" } } }, include: { challenge: true }, take: 100 });
    for (const room of newlyStarted) if (room.challenge) await this.createSystemMessage(room.challenge.id, "CHALLENGE_STARTED", "챌린지가 시작됐어요. 서로에게 도움이 되는 팁과 경험을 나눠보세요.", room.challenge.startsAt);
    const toClose = await this.prisma.conversation.findMany({ where: { kind: ConversationKind.CHALLENGE, readOnlyAt: null, challenge: { OR: [{ endedAt: { lte: now } }, { endsAt: { lte: now } }] } }, include: { challenge: true }, take: 100 });
    for (const room of toClose) if (room.challenge) await this.closeRoom(room.challenge.id, room.challenge.endedAt ?? room.challenge.endsAt);
    const warningStart = new Date(now.getTime() + 6 * 86_400_000), warningEnd = new Date(now.getTime() + 7 * 86_400_000);
    const warnings = await this.prisma.conversation.findMany({ where: { kind: ConversationKind.CHALLENGE, purgeAt: { gt: warningStart, lte: warningEnd } }, include: { challenge: true, members: true }, take: 100 });
    for (const room of warnings) {
      const marker = await this.prisma.message.findUnique({ where: { conversationId_systemKey: { conversationId: room.id, systemKey: "CHAT_PURGE_WARNING" } } });
      if (!marker) {
        await this.createSystemMessage(room.challengeId!, "CHAT_PURGE_WARNING", "이 대화 기록은 7일 뒤 삭제돼요.");
        if (room.challenge) await this.prisma.notification.createMany({ data: room.members.map((member) => ({ userId: member.userId, type: NotificationType.CHALLENGE, title: "챌린지 대화 기록이 곧 삭제돼요", body: `${room.challenge!.title} 대화는 7일 뒤 삭제돼요.`, targetType: "CHALLENGE_CHAT", targetId: room.challenge!.id })) });
      }
    }
    const expired = await this.prisma.conversation.findMany({ where: { kind: ConversationKind.CHALLENGE, purgeAt: { lte: now } }, select: { id: true }, take: 50 });
    for (const room of expired) { await this.media.purgeMessageMedia(room.id); await this.prisma.conversation.delete({ where: { id: room.id } }); }
  }

  private async context(userId: string, challengeId: string) {
    const room = await this.prisma.conversation.findUnique({ where: { challengeId }, include: { challenge: true, members: { where: { userId }, take: 1 } } });
    if (!room?.challenge || !room.members[0]) throw new ForbiddenException("이 대화방은 챌린지 참여자만 볼 수 있어요.");
    return { room, challenge: room.challenge, member: room.members[0] };
  }

  private async contextByConversation(userId: string, conversationId: string) {
    const room = await this.prisma.conversation.findUnique({ where: { id: conversationId }, include: { challenge: true, members: { where: { userId }, take: 1 } } });
    if (!room?.challenge || !room.members[0]) throw new ForbiddenException("이 대화방은 챌린지 참여자만 볼 수 있어요.");
    return { room, challenge: room.challenge, member: room.members[0] };
  }

  private async moderationContext(challengeId: string) {
    const room = await this.prisma.conversation.findUnique({ where: { challengeId }, include: { challenge: true, members: { take: 0 } } });
    if (!room?.challenge) throw new NotFoundException("챌린지 대화방을 찾을 수 없어요.");
    return { room, challenge: room.challenge, member: null };
  }

  private async summary(context: Awaited<ReturnType<ChallengeChatService["context"]>>, userId: string) {
    const effectiveEnd = context.challenge.endedAt ?? context.challenge.endsAt;
    const readOnly = Boolean(context.room.readOnlyAt || effectiveEnd <= new Date());
    const [participantCount, unreadCount, mute] = await Promise.all([
      this.prisma.challengeParticipant.count({ where: { challengeId: context.challenge.id } }),
      this.prisma.message.count({ where: { conversationId: context.room.id, senderId: { not: userId }, deletedAt: null, hiddenAt: null, ...(context.member.lastReadAt ? { createdAt: { gt: context.member.lastReadAt } } : {}) } }),
      this.prisma.conversationMute.findFirst({ where: { conversationId: context.room.id, userId, revokedAt: null, expiresAt: { gt: new Date() } }, orderBy: { createdAt: "desc" } }),
    ]);
    return { challengeId: context.challenge.id, conversationId: context.room.id, title: context.challenge.title, participantCount, unreadCount, notificationLevel: context.member.notificationLevel, readOnly, purgeAt: context.room.purgeAt, canManage: context.challenge.kind === ChallengeKind.COMMUNITY && context.challenge.creatorId === userId, mutedUntil: mute?.expiresAt ?? null };
  }

  private async assertWritable(context: Awaited<ReturnType<ChallengeChatService["context"]>>, userId: string) {
    const effectiveEnd = context.challenge.endedAt ?? context.challenge.endsAt;
    if (context.room.readOnlyAt || effectiveEnd <= new Date()) throw new ConflictException("종료된 챌린지의 대화는 읽기만 할 수 있어요.");
    const mute = await this.prisma.conversationMute.findFirst({ where: { conversationId: context.room.id, userId, revokedAt: null, expiresAt: { gt: new Date() } }, orderBy: { createdAt: "desc" } });
    if (mute) throw new ForbiddenException(`${mute.expiresAt.toLocaleString("ko-KR")}까지 이 대화방에 메시지를 보낼 수 없어요.`);
  }

  private async ownedMessage(userId: string, messageId: string) {
    const message = await this.prisma.message.findFirst({ where: { id: messageId, senderId: userId, kind: MessageKind.USER, deletedAt: null, hiddenAt: null } });
    if (!message) throw new NotFoundException("수정할 수 있는 메시지를 찾지 못했어요.");
    return message;
  }

  private assertModerator(actorId: string, role: JwtRole, challenge: { kind: ChallengeKind; creatorId: string }) {
    if (isPrivileged(role)) return;
    if (challenge.kind !== ChallengeKind.COMMUNITY || challenge.creatorId !== actorId) throw new ForbiddenException("이 대화방을 관리할 권한이 없어요.");
  }

  private async serialize(item: ChatMessageRow, viewerId: string, role: JwtRole, context: Awaited<ReturnType<ChallengeChatService["context"]>>, blockedIds: Set<string>) {
    const deleted = Boolean(item.deletedAt), hidden = Boolean(item.hiddenAt), blocked = Boolean(item.senderId && blockedIds.has(item.senderId));
    const contentVisible = !deleted && !hidden;
    const reactionTypes = Object.values(ChatReactionType);
    return {
      id: item.id,
      kind: item.kind,
      body: contentVisible ? item.body : null,
      sender: item.sender ? await this.userSummary(item.sender) : null,
      replyTo: item.replyTo ? { id: item.replyTo.id, body: item.replyTo.deletedAt || item.replyTo.hiddenAt ? null : item.replyTo.body, senderNickname: item.replyTo.sender?.nickname ?? null, deleted: Boolean(item.replyTo.deletedAt || item.replyTo.hiddenAt) } : null,
      media: contentVisible ? await Promise.all(item.media.map(async (media) => ({ id: media.id, url: await this.media.viewUrl(media.objectKey), thumbnailUrl: media.thumbnailKey ? await this.media.viewUrl(media.thumbnailKey) : null, width: media.width, height: media.height }))) : [],
      reactions: contentVisible ? reactionTypes.map((type) => ({ type, count: item.reactions.filter((reaction) => reaction.type === type).length, mine: item.reactions.some((reaction) => reaction.type === type && reaction.userId === viewerId) })).filter((reaction) => reaction.count > 0) : [],
      links: contentVisible ? this.links(item.body) : [],
      editedAt: item.editedAt,
      deletedAt: item.deletedAt,
      hiddenAt: item.hiddenAt,
      blocked,
      canEdit: item.senderId === viewerId && item.kind === MessageKind.USER && !deleted && !hidden && Date.now() - item.createdAt.getTime() <= 5 * 60_000,
      canDelete: item.senderId === viewerId && item.kind === MessageKind.USER && !deleted,
      canModerate: context.challenge.kind === ChallengeKind.COMMUNITY && context.challenge.creatorId === viewerId && item.senderId !== viewerId && !deleted,
      createdAt: item.createdAt,
    };
  }

  private async userSummary(user: { id: string; nickname: string; handle: string; avatarUrl: string | null; avatarMedia?: { objectKey: string; thumbnailKey: string | null } | null; lifetimePower: number }) {
    return { id: user.id, nickname: user.nickname, handle: user.handle, avatarUrl: user.avatarMedia ? await this.media.viewUrl(user.avatarMedia.thumbnailKey ?? user.avatarMedia.objectKey) : user.avatarUrl, lifetimePower: user.lifetimePower, cloudRank: rankOf(user.lifetimePower) };
  }

  private async notifyMembers(context: Awaited<ReturnType<ChallengeChatService["context"]>>, message: ChatMessageRow, replyOwnerId: string | null) {
    const members = await this.prisma.conversationMember.findMany({ where: { conversationId: context.room.id, userId: { not: message.senderId ?? undefined } } });
    const blocked = message.senderId ? await this.blockedIds(message.senderId) : new Set<string>();
    const preview = message.body?.slice(0, 80) || (message.media.length ? "사진을 보냈어요." : "새로운 소식이 있어요.");
    for (const member of members) {
      if (blocked.has(member.userId) || member.notificationLevel === ChatNotificationLevel.NONE || member.notificationLevel === ChatNotificationLevel.REPLIES && replyOwnerId !== member.userId) continue;
      await this.prisma.notification.upsert({
        where: { userId_chatConversationId: { userId: member.userId, chatConversationId: context.room.id } },
        create: { userId: member.userId, type: NotificationType.MESSAGE, title: `${context.challenge.title} 대화방`, body: preview, referenceId: context.challenge.id, targetType: "CHALLENGE_CHAT", targetId: context.challenge.id, chatConversationId: context.room.id, unreadCount: 1 },
        update: { title: `${context.challenge.title} 대화방`, body: preview, referenceId: context.challenge.id, targetId: context.challenge.id, readAt: null, unreadCount: { increment: 1 }, createdAt: new Date() },
      });
    }
  }

  private async blockedIds(userId: string) {
    const rows = await this.prisma.block.findMany({ where: { OR: [{ blockerId: userId }, { blockedId: userId }] }, select: { blockerId: true, blockedId: true } });
    return new Set(rows.map((row) => row.blockerId === userId ? row.blockedId : row.blockerId));
  }

  private links(body: string | null) {
    if (!body) return [];
    return [...new Set(body.match(/https?:\/\/[^\s<>()]+/gi) ?? [])].slice(0, 5).flatMap((url) => { try { const parsed = new URL(url); return [{ url: parsed.toString(), domain: parsed.hostname.replace(/^www\./, "") }]; } catch { return []; } });
  }

  private encodeCursor(createdAt: Date, id: string) { return Buffer.from(JSON.stringify({ createdAt: createdAt.toISOString(), id })).toString("base64url"); }
  private decodeCursor(cursor?: string) {
    if (!cursor) return null;
    try { const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as { createdAt: string; id: string }; const createdAt = new Date(parsed.createdAt); if (!parsed.id || Number.isNaN(createdAt.getTime())) throw new Error(); return { createdAt, id: parsed.id }; }
    catch { throw new BadRequestException("잘못된 대화 목록 요청이에요."); }
  }
}
