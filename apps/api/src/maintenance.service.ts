import { Injectable, Logger } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { MediaService } from "./media.service";
import { PrismaService } from "./prisma.service";

@Injectable()
export class MaintenanceService {
  private readonly logger = new Logger(MaintenanceService.name);

  constructor(private readonly prisma: PrismaService, private readonly media: MediaService) {}

  @Cron("0 20 3 * * *", { timeZone: "UTC" })
  async cleanExpiredSecurityData() {
    const now = new Date();
    const oldUsedToken = new Date(now.getTime() - 7 * 86_400_000);
    const [sessions, tokens, idempotency] = await this.prisma.$transaction([
      this.prisma.session.deleteMany({ where: { OR: [{ expiresAt: { lt: now } }, { revokedAt: { lt: oldUsedToken } }] } }),
      this.prisma.verificationToken.deleteMany({ where: { OR: [{ expiresAt: { lt: now } }, { usedAt: { lt: oldUsedToken } }] } }),
      this.prisma.idempotencyKey.deleteMany({ where: { expiresAt: { lt: now } } }),
    ]);
    this.logger.log(JSON.stringify({ event: "security_cleanup", sessions: sessions.count, tokens: tokens.count, idempotencyKeys: idempotency.count }));
  }

  @Cron("0 45 3 * * *", { timeZone: "UTC" })
  async purgeDeletedAccounts() {
    const cutoff = new Date(Date.now() - 7 * 86_400_000);
    const users = await this.prisma.user.findMany({
      where: { deletionRequestedAt: { lte: cutoff } },
      select: { id: true },
      take: 50,
    });
    for (const user of users) {
      try {
        await this.media.purgeOwner(user.id);
        await this.prisma.user.delete({ where: { id: user.id } });
        this.logger.log(JSON.stringify({ event: "account_purged", userId: user.id }));
      } catch (error) {
        this.logger.error(JSON.stringify({ event: "account_purge_failed", userId: user.id, message: error instanceof Error ? error.message : "unknown" }));
      }
    }
  }
}
