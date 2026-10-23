import { Body, Controller, Get, Injectable, Logger, NotFoundException, Param, Post, ServiceUnavailableException, UseGuards } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { IsString, IsUUID, Length } from "class-validator";
import { GoogleAuth } from "google-auth-library";
import { createHash } from "node:crypto";
import { PrismaService } from "./prisma.service";
import { CurrentUser, JwtAuthGuard } from "./auth";

class DeviceDto {
  @IsUUID() installationId!: string;
  @IsString() @Length(20, 4096) token!: string;
}
class RemoveDeviceDto { @IsUUID() installationId!: string; }
type PushUser = { sub: string; sid: string };
type Delivery = { token: string; userId: string; notificationId: string; eventId: string };

@Injectable()
export class FcmSender {
  private readonly auth = new GoogleAuth({ scopes: ["https://www.googleapis.com/auth/firebase.messaging"] });
  async send(delivery: Delivery): Promise<"sent" | "invalid" | "retry"> {
    const project = process.env.FIREBASE_PROJECT_ID;
    if (!project || !/^[a-z][a-z0-9-]{4,62}$/.test(project)) return "retry";
    const client = await this.auth.getClient();
    try {
      await client.request({
        url: `https://fcm.googleapis.com/v1/projects/${project}/messages:send`, method: "POST", timeout: 10_000, retry: false,
        data: { message: { token: delivery.token,
          data: { userId: delivery.userId, notificationId: delivery.notificationId, eventId: delivery.eventId },
          android: { priority: "HIGH", ttl: "3600s", collapse_key: "mungsil-activity" },
        } },
      });
      return "sent";
    } catch (error) {
      const response = (error as { response?: { data?: { error?: { details?: { errorCode?: string }[] } } } }).response;
      // Only explicit token expiry permits removal, never an arbitrary 400/403.
      return response?.data?.error?.details?.some((detail) => detail.errorCode === "UNREGISTERED") ? "invalid" : "retry";
    }
  }
}

@Injectable()
export class PushService {
  private readonly logger = new Logger(PushService.name);
  private busy = false;
  constructor(private readonly prisma: PrismaService, private readonly sender: FcmSender) {}
  enabled() { return process.env.PUSH_ENABLED === "true" && Boolean(process.env.FIREBASE_PROJECT_ID); }

  async register(user: PushUser, dto: DeviceDto) {
    if (!this.enabled()) throw new ServiceUnavailableException("푸시 알림이 아직 준비되지 않았어요.");
    const tokenHash = createHash("sha256").update(dto.token).digest("hex");
    await this.prisma.$transaction(async (tx) => {
      const previous = await tx.pushDevice.findUnique({ where: { id: dto.installationId } });
      await tx.pushDevice.deleteMany({ where: { tokenHash, id: { not: dto.installationId } } });
      const reset = previous?.sessionId !== user.sid;
      await tx.pushDevice.upsert({ where: { id: dto.installationId },
        create: { id: dto.installationId, token: dto.token, tokenHash, sessionId: user.sid },
        update: { token: dto.token, tokenHash, sessionId: user.sid, ...(reset ? { cursorAt: new Date(), cursorId: "", failures: 0, nextAttemptAt: new Date() } : {}) },
      });
    });
    return { registered: true };
  }

  async remove(user: PushUser, installationId: string) {
    await this.prisma.pushDevice.deleteMany({ where: { id: installationId, sessionId: user.sid, session: { userId: user.sub } } });
    return { removed: true };
  }

  async notification(user: PushUser, id: string) {
    const row = await this.prisma.notification.findFirst({ where: { id, userId: user.sub, readAt: null }, select: { id: true } });
    if (!row) throw new NotFoundException("확인할 새 알림이 없어요.");
    return { id: row.id };
  }

  @Cron("*/10 * * * * *")
  async dispatch() {
    if (!this.enabled() || this.busy) return;
    this.busy = true;
    try {
      const now = new Date();
      await this.prisma.pushDevice.deleteMany({ where: { session: { OR: [{ revokedAt: { not: null } }, { expiresAt: { lte: now } }, { user: { OR: [{ suspendedAt: { not: null } }, { deletionRequestedAt: { not: null } }] } }] } } });
      const devices = await this.prisma.pushDevice.findMany({ where: { nextAttemptAt: { lte: now } }, orderBy: [{ nextAttemptAt: "asc" }, { id: "asc" }], take: 20 });
      await Promise.all(devices.map(async (device) => {
        const lease = new Date(Date.now() + 300_000);
        const claim = await this.prisma.pushDevice.updateMany({ where: { id: device.id, nextAttemptAt: device.nextAttemptAt, sessionId: device.sessionId, token: device.token }, data: { nextAttemptAt: lease } });
        if (!claim.count) return;
        const guard = { id: device.id, token: device.token, sessionId: device.sessionId, nextAttemptAt: lease };
        try {
          const session = await this.prisma.session.findFirst({ where: { id: device.sessionId, revokedAt: null, expiresAt: { gt: new Date() }, user: { suspendedAt: null, deletionRequestedAt: null } } });
          if (!session) return;
          // Existing durable notifications are the source. Chat upserts advance updatedAt.
          const since = new Date(Math.max(device.cursorAt.getTime(), Date.now() - 86_400_000));
          const rows = await this.prisma.notification.findMany({ where: { userId: session.userId, OR: [{ updatedAt: { gt: since } }, { updatedAt: since, id: { gt: device.cursorId } }] }, orderBy: [{ updatedAt: "asc" }, { id: "asc" }], take: 20 });
          for (const row of rows) {
            const active = await this.prisma.pushDevice.findFirst({ where: { ...guard, session: { revokedAt: null, expiresAt: { gt: new Date() }, user: { suspendedAt: null, deletionRequestedAt: null } } } });
            if (!active) return;
            const latest = await this.prisma.notification.findUnique({ where: { id: row.id } });
            if (latest && !latest.readAt) {
              const result = await this.sender.send({ token: device.token, userId: session.userId, notificationId: row.id, eventId: `${row.id}:${row.updatedAt.getTime()}` });
              if (result === "invalid") { await this.prisma.pushDevice.deleteMany({ where: guard }); return; }
              if (result === "retry") throw new Error("delivery_retry");
            }
            await this.prisma.pushDevice.updateMany({ where: guard, data: { cursorAt: row.updatedAt, cursorId: row.id, failures: 0 } });
          }
          await this.prisma.pushDevice.updateMany({ where: guard, data: { nextAttemptAt: new Date(Date.now() + 10_000), failures: 0 } });
        } catch {
          await this.prisma.pushDevice.updateMany({ where: guard, data: { failures: { increment: 1 }, nextAttemptAt: new Date(Date.now() + Math.min(3_600_000, 30_000 * 2 ** Math.min(device.failures, 7))) } });
          this.logger.warn("Push delivery deferred; retry scheduled");
        }
      }));
    } catch { this.logger.warn("Push polling unavailable; retry on next interval"); }
    finally { this.busy = false; }
  }
}

@Controller("me/push-devices")
@UseGuards(JwtAuthGuard)
export class PushController {
  constructor(private readonly push: PushService) {}
  @Get("config") config() { return { enabled: this.push.enabled() }; }
  @Get("notifications/:id") notification(@CurrentUser() user: PushUser, @Param("id") id: string) { return this.push.notification(user, id); }
  @Post() register(@CurrentUser() user: PushUser, @Body() dto: DeviceDto) { return this.push.register(user, dto); }
  @Post("remove") remove(@CurrentUser() user: PushUser, @Body() dto: RemoveDeviceDto) { return this.push.remove(user, dto.installationId); }
}
