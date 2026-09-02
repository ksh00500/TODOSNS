import { Injectable } from "@nestjs/common";
import { EventEmitter } from "node:events";

export type ChatRealtimeEvent = {
  conversationId: string;
  type: "message.created" | "message.updated" | "message.deleted" | "reaction.updated" | "room.closed";
  payload: unknown;
};

@Injectable()
export class ChatEvents extends EventEmitter {
  publish(event: ChatRealtimeEvent) { this.emit("room-event", event); }
}
