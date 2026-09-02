import { JwtService } from "@nestjs/jwt";
import { ConnectedSocket, MessageBody, OnGatewayConnection, OnGatewayDisconnect, SubscribeMessage, WebSocketGateway, WebSocketServer } from "@nestjs/websockets";
import type { Server, Socket } from "socket.io";
import { ChatEvents, ChatRealtimeEvent } from "./chat.events";
import { PrismaService } from "./prisma.service";

@WebSocketGateway({ namespace: "/chat", cors: { origin: (process.env.WEB_ORIGIN ?? "http://localhost:3000").split(","), credentials: true } })
export class ChatGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() server!: Server;
  private readonly listener = (event: ChatRealtimeEvent) => this.server?.to(event.conversationId).emit(event.type, event.payload);
  constructor(private readonly jwt: JwtService, private readonly prisma: PrismaService, private readonly events: ChatEvents) { this.events.on("room-event", this.listener); }
  handleConnection(socket: Socket) { try { const token = String(socket.handshake.auth?.token ?? ""); socket.data.user = this.jwt.verify(token, { secret: process.env.JWT_ACCESS_SECRET }); } catch { socket.disconnect(true); } }
  handleDisconnect() { /* Socket.IO removes room membership automatically. */ }
  @SubscribeMessage("join") async join(@ConnectedSocket() socket: Socket, @MessageBody() conversationId: string) {
    const member = await this.prisma.conversationMember.findUnique({ where: { conversationId_userId: { conversationId, userId: socket.data.user.sub } } });
    if (!member) return { ok: false };
    await socket.join(conversationId);
    return { ok: true };
  }
}
