import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { ChatReactionType, ConversationKind, MessageKind, NotificationType, Prisma, RequestStatus } from "@prisma/client";
import { ChatEvents } from "./chat.events";
import { CreateChallengeChatMessageDto, PageDto } from "./dtos";
import { MediaService } from "./media.service";
import { PrismaService } from "./prisma.service";

const directMessageInclude = {
  sender: { select: { id: true, nickname: true, handle: true, avatarUrl: true, avatarMedia: true, lifetimePower: true } },
  replyTo: { include: { sender: { select: { nickname: true } } } },
  media: { where: { status: "READY" }, orderBy: { messageOrder: "asc" } },
  reactions: true,
} satisfies Prisma.MessageInclude;

type DirectMessageRow = Prisma.MessageGetPayload<{ include: typeof directMessageInclude }>;
type DirectUser = { id: string; nickname: string; handle: string; avatarUrl: string | null; avatarMedia?: { objectKey: string; thumbnailKey: string | null } | null; lifetimePower: number };

const rankOf = (power: number) => power >= 5000 ? "별구름" : power >= 2000 ? "노을구름" : power >= 800 ? "뭉게구름" : power >= 300 ? "솜구름" : power >= 100 ? "조각구름" : "구름씨앗";

@Injectable()
export class DirectChatService {
  constructor(private readonly prisma: PrismaService, private readonly media: MediaService, private readonly events: ChatEvents) {}

  async start(userId: string, receiverId: string) {
    if (userId === receiverId) throw new BadRequestException("자기 자신에게 메시지를 보낼 수 없어요.");
    const receiver = await this.prisma.user.findFirst({ where: { id: receiverId, deletionRequestedAt: null, suspendedAt: null }, select: { id: true } });
    if (!receiver) throw new NotFoundException("사용자를 찾을 수 없어요.");
    await this.assertNotBlocked(userId, receiverId);

    const existing = await this.findConversation(userId, receiverId);
    if (existing) return { kind: "CONVERSATION" as const, conversationId: existing.id };

    const reverse = await this.prisma.messageRequest.findUnique({ where: { senderId_receiverId: { senderId: receiverId, receiverId: userId } } });
    if (reverse?.status === RequestStatus.PENDING) {
      await this.prisma.messageRequest.update({ where: { id: reverse.id }, data: { status: RequestStatus.ACCEPTED } });
      const conversation = await this.createConversation(userId, receiverId);
      return { kind: "CONVERSATION" as const, conversationId: conversation.id };
    }

    const mutual = await this.prisma.follow.count({ where: { OR: [{ followerId: userId, followingId: receiverId }, { followerId: receiverId, followingId: userId }] } });
    if (mutual === 2) {
      const conversation = await this.createConversation(userId, receiverId);
      return { kind: "CONVERSATION" as const, conversationId: conversation.id };
    }

    const request = await this.prisma.messageRequest.upsert({
      where: { senderId_receiverId: { senderId: userId, receiverId } },
      create: { senderId: userId, receiverId },
      update: { status: RequestStatus.PENDING, updatedAt: new Date() },
    });
    const sender = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { nickname: true, handle: true } });
    await this.prisma.notification.create({ data: { userId: receiverId, type: NotificationType.MESSAGE, title: `${sender.nickname}님이 대화를 요청했어요`, body: "요청을 수락하면 서로 메시지를 나눌 수 있어요.", referenceId: request.id, targetType: "DIRECT_INBOX", targetId: request.id } });
    return { kind: "REQUEST" as const, requestId: request.id };
  }

  async requests(userId: string) {
    const rows = await this.prisma.messageRequest.findMany({
      where: { receiverId: userId, status: RequestStatus.PENDING, sender: { blocksInitiated: { none: { blockedId: userId } }, blocksReceived: { none: { blockerId: userId } } } },
      orderBy: { createdAt: "desc" },
      include: { sender: { select: { id: true, nickname: true, handle: true, avatarUrl: true, avatarMedia: true, lifetimePower: true } } },
    });
    return Promise.all(rows.map(async (row) => ({ id: row.id, sender: await this.userSummary(row.sender), createdAt: row.createdAt })));
  }

  async accept(userId: string, requestId: string) {
    const request = await this.prisma.messageRequest.findFirst({ where: { id: requestId, receiverId: userId, status: RequestStatus.PENDING } });
    if (!request) throw new NotFoundException("수락할 수 있는 메시지 요청을 찾지 못했어요.");
    await this.assertNotBlocked(request.senderId, request.receiverId);
    await this.prisma.messageRequest.update({ where: { id: request.id }, data: { status: RequestStatus.ACCEPTED } });
    const conversation = await this.createConversation(request.senderId, request.receiverId);
    await this.prisma.notification.create({ data: { userId: request.senderId, type: NotificationType.MESSAGE, title: "메시지 요청이 수락됐어요", body: "이제 대화를 시작해보세요.", referenceId: conversation.id, targetType: "DIRECT_MESSAGE", targetId: conversation.id, chatConversationId: conversation.id } });
    return { kind: "CONVERSATION" as const, conversationId: conversation.id };
  }

  async reject(userId: string, requestId: string) {
    const result = await this.prisma.messageRequest.updateMany({ where: { id: requestId, receiverId: userId, status: RequestStatus.PENDING }, data: { status: RequestStatus.REJECTED } });
    if (!result.count) throw new NotFoundException("거절할 수 있는 메시지 요청을 찾지 못했어요.");
    return { ok: true };
  }

  async conversations(userId: string) {
    const rows = await this.prisma.conversation.findMany({
      where: { kind: ConversationKind.DIRECT, members: { some: { userId } } },
      orderBy: { updatedAt: "desc" },
      include: {
        members: { include: { user: { select: { id: true, nickname: true, handle: true, avatarUrl: true, avatarMedia: true, lifetimePower: true } } } },
        messages: { take: 1, orderBy: [{ createdAt: "desc" }, { id: "desc" }], include: { media: { where: { status: "READY" }, select: { id: true } } } },
      },
    });
    return Promise.all(rows.flatMap((row) => {
      const me = row.members.find((member) => member.userId === userId);
      const other = row.members.find((member) => member.userId !== userId);
      if (!me || !other) return [];
      return [this.conversationSummary(userId, row.id, row.updatedAt, me.lastReadAt, other.user, row.messages[0] ?? null)];
    }));
  }

  async inbox(userId: string) {
    const [direct, challengeRooms] = await Promise.all([
      this.conversations(userId),
      this.prisma.conversation.findMany({
        where: { kind: ConversationKind.CHALLENGE, challenge: { isNot: null }, members: { some: { userId } } },
        orderBy: { updatedAt: "desc" },
        include: {
          challenge: { select: { id: true, title: true, endsAt: true, endedAt: true, _count: { select: { participants: true } } } },
          members: { where: { userId }, select: { lastReadAt: true } },
          messages: { take: 1, orderBy: [{ createdAt: "desc" }, { id: "desc" }], include: { sender: { select: { nickname: true } }, media: { where: { status: "READY" }, select: { id: true } } } },
        },
      }),
    ]);
    const directItems = direct.map((item) => ({
      id: item.id,
      kind: "DIRECT" as const,
      href: `/messages/${item.id}`,
      title: item.otherUser.nickname,
      subtitle: `@${item.otherUser.handle}`,
      avatarUrl: item.otherUser.avatarUrl,
      unreadCount: item.unreadCount,
      readOnly: false,
      lastMessage: item.lastMessage ? { ...item.lastMessage, senderNickname: null } : null,
      updatedAt: item.updatedAt,
    }));
    const challengeItems = await Promise.all(challengeRooms.flatMap((room) => {
      const challenge = room.challenge, member = room.members[0];
      if (!challenge || !member) return [];
      return [(async () => {
        const unreadCount = await this.prisma.message.count({ where: { conversationId: room.id, senderId: { not: userId }, deletedAt: null, hiddenAt: null, ...(member.lastReadAt ? { createdAt: { gt: member.lastReadAt } } : {}) } });
        const last = room.messages[0];
        return {
          id: room.id,
          kind: "CHALLENGE" as const,
          href: `/challenges/${challenge.id}/chat`,
          title: challenge.title,
          subtitle: `참여자 ${challenge._count.participants.toLocaleString("ko-KR")}명`,
          avatarUrl: null,
          unreadCount,
          readOnly: Boolean(room.readOnlyAt || (challenge.endedAt ?? challenge.endsAt) <= new Date()),
          lastMessage: last ? { id: last.id, body: last.deletedAt || last.hiddenAt ? null : last.body, hasMedia: !last.deletedAt && !last.hiddenAt && last.media.length > 0, deleted: Boolean(last.deletedAt || last.hiddenAt), senderId: last.senderId, senderNickname: last.sender?.nickname ?? null, createdAt: last.createdAt } : null,
          updatedAt: room.updatedAt,
        };
      })()];
    }));
    return [...directItems, ...challengeItems].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  }

  async unreadCount(userId: string) {
    const memberships = await this.prisma.conversationMember.findMany({ where: { userId }, select: { conversationId: true, lastReadAt: true } });
    const counts = await Promise.all(memberships.map((member) => this.prisma.message.count({ where: { conversationId: member.conversationId, senderId: { not: userId }, deletedAt: null, hiddenAt: null, ...(member.lastReadAt ? { createdAt: { gt: member.lastReadAt } } : {}) } })));
    return { count: counts.reduce((sum, count) => sum + count, 0) };
  }

  async chat(userId: string, conversationId: string, page: PageDto) {
    const context = await this.context(userId, conversationId);
    const cursor = this.decodeCursor(page.cursor);
    const rows = await this.prisma.message.findMany({
      where: { conversationId, ...(cursor ? { OR: [{ createdAt: { lt: cursor.createdAt } }, { createdAt: cursor.createdAt, id: { lt: cursor.id } }] } : {}) },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: page.limit + 1,
      include: directMessageInclude,
    });
    const visible = rows.slice(0, page.limit);
    const oldest = visible[visible.length - 1];
    return {
      room: await this.roomSummary(userId, context),
      items: await Promise.all(visible.reverse().map((item) => this.serialize(item, userId, context.blocked))),
      nextCursor: rows.length > page.limit && oldest ? this.encodeCursor(oldest.createdAt, oldest.id) : null,
    };
  }

  async send(userId: string, conversationId: string, dto: CreateChallengeChatMessageDto) {
    const context = await this.context(userId, conversationId);
    if (context.blocked) throw new ForbiddenException("차단된 사용자와는 메시지를 주고받을 수 없어요.");
    const body = dto.body?.trim() || null;
    const mediaIds = dto.mediaIds ?? [];
    if (!body && mediaIds.length === 0) throw new BadRequestException("메시지나 사진을 하나 이상 입력해주세요.");
    if (mediaIds.length > 4 || new Set(mediaIds).size !== mediaIds.length) throw new BadRequestException("사진은 메시지마다 최대 4장까지 올릴 수 있어요.");
    await Promise.all(mediaIds.map((id) => this.media.readyOwned(userId, id)));
    const replyTo = dto.replyToId ? await this.prisma.message.findFirst({ where: { id: dto.replyToId, conversationId, deletedAt: null, hiddenAt: null }, select: { id: true } }) : null;
    if (dto.replyToId && !replyTo) throw new BadRequestException("답장할 메시지를 찾을 수 없어요.");
    const created = await this.prisma.message.create({ data: { conversationId, senderId: userId, body, replyToId: replyTo?.id }, include: directMessageInclude });
    try { await this.media.attachToMessage(userId, mediaIds, created.id); }
    catch (error) { await this.prisma.message.delete({ where: { id: created.id } }).catch(() => undefined); throw error; }
    await this.prisma.conversation.update({ where: { id: conversationId }, data: { updatedAt: new Date() } });
    const fresh = await this.prisma.message.findUniqueOrThrow({ where: { id: created.id }, include: directMessageInclude });
    await this.notify(context.other.userId, context.me.user.nickname, conversationId, fresh);
    const serialized = await this.serialize(fresh, userId, false);
    this.events.publish({ conversationId, type: "message.created", payload: serialized });
    return serialized;
  }

  async remove(userId: string, conversationId: string, messageId: string) {
    await this.context(userId, conversationId);
    const message = await this.prisma.message.findFirst({ where: { id: messageId, conversationId, senderId: userId, kind: MessageKind.USER, deletedAt: null } });
    if (!message) throw new NotFoundException("삭제할 수 있는 메시지를 찾지 못했어요.");
    await this.prisma.message.update({ where: { id: messageId }, data: { deletedAt: new Date() } });
    this.events.publish({ conversationId, type: "message.deleted", payload: { id: messageId } });
    return { ok: true };
  }

  async toggleReaction(userId: string, conversationId: string, messageId: string, type: ChatReactionType) {
    const context = await this.context(userId, conversationId);
    if (context.blocked) throw new ForbiddenException("차단된 사용자와는 반응을 주고받을 수 없어요.");
    const message = await this.prisma.message.findFirst({ where: { id: messageId, conversationId, deletedAt: null, hiddenAt: null } });
    if (!message) throw new NotFoundException("반응할 메시지를 찾지 못했어요.");
    const key = { messageId_userId_type: { messageId, userId, type } };
    const current = await this.prisma.messageReaction.findUnique({ where: key });
    if (current) await this.prisma.messageReaction.delete({ where: key });
    else await this.prisma.messageReaction.create({ data: { messageId, userId, type } });
    const fresh = await this.prisma.message.findUniqueOrThrow({ where: { id: messageId }, include: directMessageInclude });
    const serialized = await this.serialize(fresh, userId, false);
    this.events.publish({ conversationId, type: "reaction.updated", payload: serialized });
    return serialized.reactions;
  }

  async reactionUsers(userId: string, conversationId: string, messageId: string, type: ChatReactionType) {
    await this.context(userId, conversationId);
    const message = await this.prisma.message.findFirst({ where: { id: messageId, conversationId }, select: { id: true } });
    if (!message) throw new NotFoundException("메시지를 찾지 못했어요.");
    return this.prisma.messageReaction.findMany({ where: { messageId, type }, orderBy: { createdAt: "asc" }, select: { user: { select: { id: true, nickname: true, handle: true, avatarUrl: true } } } });
  }

  async markRead(userId: string, conversationId: string, messageId: string) {
    const context = await this.context(userId, conversationId);
    const message = await this.prisma.message.findFirst({ where: { id: messageId, conversationId }, select: { id: true, createdAt: true } });
    if (!message) throw new BadRequestException("읽은 위치를 찾을 수 없어요.");
    if (!context.me.lastReadAt || context.me.lastReadAt < message.createdAt) {
      await this.prisma.conversationMember.update({ where: { conversationId_userId: { conversationId, userId } }, data: { lastReadAt: message.createdAt, lastReadMessageId: message.id } });
    }
    await this.prisma.notification.updateMany({ where: { userId, chatConversationId: conversationId }, data: { readAt: new Date(), unreadCount: 0 } });
    return { ok: true };
  }

  private async context(userId: string, conversationId: string) {
    const room = await this.prisma.conversation.findFirst({
      where: { id: conversationId, kind: ConversationKind.DIRECT, members: { some: { userId } } },
      include: { members: { include: { user: { select: { id: true, nickname: true, handle: true, avatarUrl: true, avatarMedia: true, lifetimePower: true } } } } },
    });
    const me = room?.members.find((member) => member.userId === userId);
    const other = room?.members.find((member) => member.userId !== userId);
    if (!room || !me || !other) throw new NotFoundException("대화를 찾을 수 없어요.");
    const blocks = await this.prisma.block.findMany({ where: { OR: [{ blockerId: userId, blockedId: other.userId }, { blockerId: other.userId, blockedId: userId }] }, select: { blockerId: true } });
    return { room, me, other, blocked: blocks.length > 0, blockedByMe: blocks.some((item) => item.blockerId === userId) };
  }

  private async roomSummary(userId: string, context: Awaited<ReturnType<DirectChatService["context"]>>) {
    const unreadCount = await this.prisma.message.count({ where: { conversationId: context.room.id, senderId: { not: userId }, deletedAt: null, hiddenAt: null, ...(context.me.lastReadAt ? { createdAt: { gt: context.me.lastReadAt } } : {}) } });
    return { conversationId: context.room.id, otherUser: await this.userSummary(context.other.user), unreadCount, blocked: context.blocked, blockedByMe: context.blockedByMe, canSend: !context.blocked };
  }

  private async conversationSummary(userId: string, conversationId: string, updatedAt: Date, lastReadAt: Date | null, other: DirectUser, lastMessage: { id: string; body: string | null; senderId: string | null; deletedAt: Date | null; hiddenAt: Date | null; createdAt: Date; media: Array<{ id: string }> } | null) {
    const [unreadCount, blocks] = await Promise.all([
      this.prisma.message.count({ where: { conversationId, senderId: { not: userId }, deletedAt: null, hiddenAt: null, ...(lastReadAt ? { createdAt: { gt: lastReadAt } } : {}) } }),
      this.prisma.block.findMany({ where: { OR: [{ blockerId: userId, blockedId: other.id }, { blockerId: other.id, blockedId: userId }] }, select: { blockerId: true } }),
    ]);
    const blocked = blocks.length > 0;
    return { id: conversationId, otherUser: await this.userSummary(other), unreadCount, blocked, blockedByMe: blocks.some((item) => item.blockerId === userId), canSend: !blocked, lastMessage: lastMessage ? { id: lastMessage.id, body: lastMessage.deletedAt || lastMessage.hiddenAt ? null : lastMessage.body, hasMedia: !lastMessage.deletedAt && !lastMessage.hiddenAt && lastMessage.media.length > 0, deleted: Boolean(lastMessage.deletedAt || lastMessage.hiddenAt), senderId: lastMessage.senderId, createdAt: lastMessage.createdAt } : null, updatedAt };
  }

  private async serialize(item: DirectMessageRow, viewerId: string, blocked: boolean) {
    const unavailable = Boolean(item.deletedAt || item.hiddenAt);
    return {
      id: item.id,
      kind: item.kind,
      body: unavailable ? null : item.body,
      sender: item.sender ? await this.userSummary(item.sender) : null,
      replyTo: item.replyTo ? { id: item.replyTo.id, body: item.replyTo.deletedAt || item.replyTo.hiddenAt ? null : item.replyTo.body, senderNickname: item.replyTo.sender?.nickname ?? null, deleted: Boolean(item.replyTo.deletedAt || item.replyTo.hiddenAt) } : null,
      media: unavailable ? [] : await Promise.all(item.media.map(async (media) => ({ id: media.id, url: await this.media.viewUrl(media.objectKey), thumbnailUrl: media.thumbnailKey ? await this.media.viewUrl(media.thumbnailKey) : null, width: media.width, height: media.height }))),
      reactions: unavailable ? [] : Object.values(ChatReactionType).map((type) => ({ type, count: item.reactions.filter((reaction) => reaction.type === type).length, mine: item.reactions.some((reaction) => reaction.type === type && reaction.userId === viewerId) })).filter((reaction) => reaction.count > 0),
      links: unavailable ? [] : this.links(item.body),
      deletedAt: item.deletedAt,
      hiddenAt: item.hiddenAt,
      blocked: blocked && item.senderId !== viewerId,
      canDelete: item.senderId === viewerId && item.kind === MessageKind.USER && !item.deletedAt,
      createdAt: item.createdAt,
    };
  }

  private async createConversation(a: string, b: string) {
    const existing = await this.findConversation(a, b);
    if (existing) return existing;
    const now = new Date();
    return this.prisma.conversation.create({ data: { kind: ConversationKind.DIRECT, members: { create: [{ userId: a, lastReadAt: now }, { userId: b, lastReadAt: now }] } } });
  }

  private async findConversation(a: string, b: string) {
    const rows = await this.prisma.conversation.findMany({ where: { kind: ConversationKind.DIRECT, AND: [{ members: { some: { userId: a } } }, { members: { some: { userId: b } } }] }, include: { members: { select: { userId: true } } }, take: 5 });
    return rows.find((row) => row.members.length === 2 && row.members.some((member) => member.userId === a) && row.members.some((member) => member.userId === b)) ?? null;
  }

  private async assertNotBlocked(a: string, b: string) {
    const blocked = await this.prisma.block.count({ where: { OR: [{ blockerId: a, blockedId: b }, { blockerId: b, blockedId: a }] } });
    if (blocked) throw new ForbiddenException("메시지를 보낼 수 없는 사용자예요.");
  }

  private async notify(receiverId: string, senderNickname: string, conversationId: string, message: DirectMessageRow) {
    const preview = message.body?.slice(0, 80) || (message.media.length ? "사진을 보냈어요." : "새 메시지가 있어요.");
    await this.prisma.notification.upsert({
      where: { userId_chatConversationId: { userId: receiverId, chatConversationId: conversationId } },
      create: { userId: receiverId, type: NotificationType.MESSAGE, title: `${senderNickname}님의 메시지`, body: preview, referenceId: conversationId, targetType: "DIRECT_MESSAGE", targetId: conversationId, chatConversationId: conversationId, unreadCount: 1 },
      update: { title: `${senderNickname}님의 메시지`, body: preview, referenceId: conversationId, targetId: conversationId, readAt: null, unreadCount: { increment: 1 }, createdAt: new Date() },
    });
  }

  private async userSummary(user: DirectUser) {
    return { id: user.id, nickname: user.nickname, handle: user.handle, avatarUrl: user.avatarMedia ? await this.media.viewUrl(user.avatarMedia.thumbnailKey ?? user.avatarMedia.objectKey) : user.avatarUrl, lifetimePower: user.lifetimePower, cloudRank: rankOf(user.lifetimePower) };
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
