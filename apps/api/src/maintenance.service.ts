import { Injectable, Logger } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { MediaService } from "./media.service";
import { PrismaService } from "./prisma.service";
import { DataGovernanceService } from "./data-governance.service";

@Injectable()
export class MaintenanceService {
  private readonly logger = new Logger(MaintenanceService.name);

  constructor(private readonly prisma: PrismaService, private readonly media: MediaService, private readonly governance: DataGovernanceService) {}

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

  @Cron("0 * * * * *", { timeZone: "UTC" })
  async purgeDeletedAccounts() {
    const cutoff = new Date();
    const users = await this.prisma.user.findMany({
      where: { deletionRequestedAt: { lte: cutoff } },
      select: { id: true, deletionRequestedAt: true },
      take: 50,
    });
    for (const user of users) {
      await this.purgeDeletedAccount(user.id, user.deletionRequestedAt ?? cutoff);
    }
  }

  async purgeDeletedAccount(userId: string, requestedAt: Date) {
    const requestId = await this.governance.beginErasure(userId, requestedAt);
    if (!requestId) return false;
    try {
      await this.media.purgeOwner(userId);
      await this.governance.deleteUserAndCompleteErasure(requestId, userId);
      this.logger.log(JSON.stringify({ event: "account_purged", erasureRequestId: requestId }));
      return true;
    } catch (error) {
      const code = await this.governance.failErasure(requestId, error);
      this.logger.error(JSON.stringify({ event: "account_purge_failed", erasureRequestId: requestId, code }));
      return false;
    }
  }
}
