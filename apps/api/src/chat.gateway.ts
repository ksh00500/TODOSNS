import { JwtService } from "@nestjs/jwt";
import { ConnectedSocket, MessageBody, OnGatewayConnection, OnGatewayDisconnect, SubscribeMessage, WebSocketGateway, WebSocketServer } from "@nestjs/websockets";
import type { Server, Socket } from "socket.io";
import { ChatAccessRevocation, ChatEvents, ChatRealtimeEvent } from "./chat.events";
import { PrismaService } from "./prisma.service";

type SocketUser = { sub: string; sid: string; exp?: number };
type ChatSocket = Socket & { data: { user?: SocketUser; expiryTimer?: NodeJS.Timeout } };

@WebSocketGateway({ namespace: "/chat", cors: { origin: (process.env.WEB_ORIGIN ?? "http://localhost:3000").split(","), credentials: true } })
export class ChatGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() server!: Server;
  private readonly roomListener = (event: ChatRealtimeEvent) => { void this.deliver(event).catch(() => undefined); };
  private readonly revocationListener = (event: ChatAccessRevocation) => { void this.revoke(event).catch(() => undefined); };

  constructor(private readonly jwt: JwtService, private readonly prisma: PrismaService, private readonly events: ChatEvents) {
    this.events.on("room-event", this.roomListener);
    this.events.on("access-revoked", this.revocationListener);
  }

  async handleConnection(socket: ChatSocket) {
    try {
      const token = String(socket.handshake.auth?.token ?? "");
      socket.data.user = this.jwt.verify<SocketUser>(token, { secret: process.env.JWT_ACCESS_SECRET });
      if (!(await this.active(socket.data.user))) throw new Error("revoked");
      const delay = socket.data.user.exp ? socket.data.user.exp * 1000 - Date.now() : 0;
      if (delay <= 0) throw new Error("expired");
      socket.data.expiryTimer = setTimeout(() => socket.disconnect(true), Math.min(delay, 2_147_483_647));
    } catch {
      socket.disconnect(true);
    }
  }

  handleDisconnect(socket: ChatSocket) {
    if (socket.data.expiryTimer) clearTimeout(socket.data.expiryTimer);
  }

  @SubscribeMessage("join")
  async join(@ConnectedSocket() socket: ChatSocket, @MessageBody() conversationId: string) {
    if (!socket.data.user || !(await this.active(socket.data.user, conversationId))) {
      socket.disconnect(true);
      return { ok: false };
    }
    await socket.join(conversationId);
    return { ok: true };
  }

  private async active(user: SocketUser, conversationId?: string) {
    const [session, membership] = await Promise.all([
      this.prisma.session.count({ where: { id: user.sid, userId: user.sub, revokedAt: null, expiresAt: { gt: new Date() }, user: { suspendedAt: null, deletionRequestedAt: null } } }),
      conversationId ? this.prisma.conversationMember.count({ where: { conversationId, userId: user.sub } }) : Promise.resolve(1),
    ]);
    return session === 1 && membership === 1;
  }

  private async deliver(event: ChatRealtimeEvent) {
    if (!this.server?.in) return;
    const sockets = await this.server.in(event.conversationId).fetchSockets();
    const payload = this.signalPayload(event);
    await Promise.all(sockets.map(async (socket) => {
      const user = socket.data.user as SocketUser | undefined;
      if (!user || !(await this.active(user, event.conversationId))) {
        await socket.leave(event.conversationId);
        return;
      }
      socket.emit(event.type, payload);
    }));
  }

  private signalPayload(event: ChatRealtimeEvent) {
    const source = event.payload && typeof event.payload === "object" ? event.payload as Record<string, unknown> : {};
    return { conversationId: event.conversationId, id: typeof source.id === "string" ? source.id : undefined };
  }

  private async revoke(event: ChatAccessRevocation) {
    const holder = this.server as unknown as { sockets?: Map<string, Socket> | { sockets?: Map<string, Socket> } };
    const sockets = holder?.sockets instanceof Map ? holder.sockets : holder?.sockets?.sockets;
    if (!sockets) return;
    await Promise.all([...sockets.values()].map(async (socket) => {
      const user = socket.data.user as SocketUser | undefined;
      if (!user) return;
      if ((event.kind === "session" && user.sid === event.sessionId) || (event.kind === "user" && user.sub === event.userId)) {
        socket.disconnect(true);
      } else if (event.kind === "membership" && user.sub === event.userId) {
        await socket.leave(event.conversationId);
      }
    }));
  }
}
