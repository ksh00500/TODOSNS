import { JwtService } from "@nestjs/jwt";
import { ConnectedSocket, MessageBody, OnGatewayConnection, SubscribeMessage, WebSocketGateway, WebSocketServer } from "@nestjs/websockets";
import type { Server, Socket } from "socket.io";
import { SendMessageDto } from "./dtos";
import { MungsilService } from "./mungsil.service";

@WebSocketGateway({ namespace: "/chat", cors: { origin: (process.env.WEB_ORIGIN ?? "http://localhost:3000").split(","), credentials: true } })
export class ChatGateway implements OnGatewayConnection {
  @WebSocketServer() server!: Server;
  constructor(private readonly jwt: JwtService, private readonly service: MungsilService) {}
  handleConnection(socket: Socket) { try { const token = String(socket.handshake.auth?.token ?? ""); socket.data.user = this.jwt.verify(token, { secret: process.env.JWT_ACCESS_SECRET }); } catch { socket.disconnect(true); } }
  @SubscribeMessage("join") async join(@ConnectedSocket() socket: Socket, @MessageBody() conversationId: string) { await this.service.messages(socket.data.user.sub, conversationId); await socket.join(conversationId); return { ok: true }; }
  @SubscribeMessage("message") async message(@ConnectedSocket() socket: Socket, @MessageBody() payload: { conversationId: string; body: string }) { const dto = new SendMessageDto(); dto.body = payload.body; const message = await this.service.sendMessage(socket.data.user.sub, payload.conversationId, dto); this.server.to(payload.conversationId).emit("message", message); return message; }
}
