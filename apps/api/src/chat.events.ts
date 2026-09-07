import { Injectable } from "@nestjs/common";
import { EventEmitter } from "node:events";

export type ChatRealtimeEvent = {
  conversationId: string;
  type: "message.created" | "message.updated" | "message.deleted" | "reaction.updated" | "room.closed";
  payload: unknown;
};

export type ChatAccessRevocation =
  | { kind: "session"; sessionId: string }
  | { kind: "user"; userId: string }
  | { kind: "membership"; userId: string; conversationId: string };

@Injectable()
export class ChatEvents extends EventEmitter {
  publish(event: ChatRealtimeEvent) { this.emit("room-event", event); }
  revoke(event: ChatAccessRevocation) { this.emit("access-revoked", event); }
}
