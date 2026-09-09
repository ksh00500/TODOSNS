import { ForbiddenException, Injectable } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { PrismaService } from "./prisma.service";

type SqlClient = Pick<Prisma.TransactionClient, "$executeRawUnsafe" | "$queryRawUnsafe">;

const ANALYTICS_ALLOWED_FIELDS = new Set([
  "eventType",
  "occurredMonth",
  "broadCategory",
  "countValue",
  "completedValue",
  "eligibleValue",
  "ageBand",
]);

export function accountDeletionGraceDays(env: Record<string, string | undefined> = process.env) {
  void env;
  return 0;
}

export function seoulMonthStart(at: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(at);
  const year = Number(parts.find((part) => part.type === "year")?.value);
  const month = Number(parts.find((part) => part.type === "month")?.value);
  return `${year.toString().padStart(4, "0")}-${month.toString().padStart(2, "0")}-01`;
}

export function ageBandAtActivity(birthDate: Date | null, activityAt: Date) {
  if (!birthDate || Number.isNaN(birthDate.getTime()) || Number.isNaN(activityAt.getTime())) return "UNKNOWN";
  const formatter = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" });
  const values = (date: Date) => Object.fromEntries(formatter.formatToParts(date).map((part) => [part.type, part.value]));
  const birth = values(birthDate);
  const activity = values(activityAt);
  let age = Number(activity.year) - Number(birth.year);
  if (`${activity.month}-${activity.day}` < `${birth.month}-${birth.day}`) age -= 1;
  if (age < 0 || age > 120) return "UNKNOWN";
  return `${Math.floor(age / 10) * 10}s`;
}

export function assertAnalyticsPayload(payload: Record<string, unknown>) {
  const rejected = Object.keys(payload).filter((key) => !ANALYTICS_ALLOWED_FIELDS.has(key));
  if (rejected.length) throw new ForbiddenException("승인되지 않은 분석 필드는 수집할 수 없어요.");
}

@Injectable()
export class DataGovernanceService {
  constructor(private readonly prisma: PrismaService) {}

  async registerErasure(client: SqlClient, userId: string, requestedAt: Date, executeAfter: Date) {
    const rows = await client.$queryRawUnsafe<Array<{ id: string }>>(
      `INSERT INTO governance."ErasureRequest"
         ("id", "subjectUserId", "requestedAt", "executeAfter", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, $4, NOW(), NOW())
       ON CONFLICT ("subjectUserId")
         WHERE "subjectUserId" IS NOT NULL AND "status" IN ('PENDING', 'PROCESSING', 'FAILED')
       DO UPDATE SET "updatedAt" = NOW()
       RETURNING "id"`,
      randomUUID(),
      userId,
      requestedAt,
      executeAfter,
    );
    const requestId = rows[0].id;
    for (const scope of ["SERVICE_DATABASE", "OBJECT_STORAGE", "ANALYTICS_RESTRICTED"]) {
      await client.$executeRawUnsafe(
        `INSERT INTO governance."ErasureTask" ("id", "requestId", "scope", "createdAt", "updatedAt")
         VALUES ($1, $2, $3, NOW(), NOW())
         ON CONFLICT ("requestId", "scope") DO NOTHING`,
        randomUUID(),
        requestId,
        scope,
      );
    }
    return requestId;
  }

  async beginErasure(userId: string, requestedAt: Date) {
    await this.registerErasure(this.prisma, userId, requestedAt, requestedAt);
    await this.prisma.$executeRawUnsafe(
      `UPDATE governance."ErasureRequest"
       SET "status" = 'FAILED', "lastErrorCode" = 'STALE_PROCESSING_LEASE', "updatedAt" = NOW()
       WHERE "subjectUserId" = $1 AND "status" = 'PROCESSING'
         AND "startedAt" < NOW() - INTERVAL '30 minutes'`,
      userId,
    );
    const rows = await this.prisma.$queryRawUnsafe<Array<{ id: string }>>(
      `UPDATE governance."ErasureRequest"
       SET "status" = 'PROCESSING', "startedAt" = NOW(),
           "attempts" = "attempts" + 1, "lastErrorCode" = NULL, "updatedAt" = NOW()
       WHERE "subjectUserId" = $1 AND "status" IN ('PENDING', 'FAILED') AND "executeAfter" <= NOW()
       RETURNING "id"`,
      userId,
    );
    const requestId = rows[0]?.id;
    if (!requestId) return null;
    await this.prisma.$executeRawUnsafe(
      `UPDATE governance."ErasureTask"
       SET "status" = 'PROCESSING', "startedAt" = COALESCE("startedAt", NOW()),
           "attempts" = "attempts" + 1, "lastErrorCode" = NULL, "updatedAt" = NOW()
       WHERE "requestId" = $1 AND "status" IN ('PENDING', 'FAILED')`,
      requestId,
    );
    return requestId;
  }

  async completeErasure(requestId: string) {
    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(
        `UPDATE governance."ErasureTask"
         SET "status" = 'COMPLETED', "completedAt" = NOW(), "lastErrorCode" = NULL,
             "evidence" = jsonb_build_object('completed', true), "updatedAt" = NOW()
         WHERE "requestId" = $1 AND "status" <> 'EXEMPT'`,
        requestId,
      );
      await tx.$executeRawUnsafe(
        `UPDATE governance."ErasureRequest"
         SET "status" = 'COMPLETED', "completedAt" = NOW(), "lastErrorCode" = NULL, "updatedAt" = NOW()
         WHERE "id" = $1`,
        requestId,
      );
    });
  }

  async deleteUserAndCompleteErasure(requestId: string, userId: string) {
    await this.prisma.$transaction(async (tx) => {
      await tx.user.delete({ where: { id: userId } });
      await tx.$executeRawUnsafe(
        `UPDATE governance."ErasureTask"
         SET "status" = 'COMPLETED', "completedAt" = NOW(), "lastErrorCode" = NULL,
             "evidence" = jsonb_build_object('completed', true), "updatedAt" = NOW()
         WHERE "requestId" = $1 AND "status" <> 'EXEMPT'`,
        requestId,
      );
      await tx.$executeRawUnsafe(
        `UPDATE governance."ErasureRequest"
         SET "status" = 'COMPLETED', "completedAt" = NOW(), "lastErrorCode" = NULL, "updatedAt" = NOW()
         WHERE "id" = $1`,
        requestId,
      );
    });
  }

  async failErasure(requestId: string, error: unknown) {
    const code = this.errorCode(error);
    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(
        `UPDATE governance."ErasureTask"
         SET "status" = 'FAILED', "lastErrorCode" = $2, "updatedAt" = NOW()
         WHERE "requestId" = $1 AND "status" = 'PROCESSING'`,
        requestId,
        code,
      );
      await tx.$executeRawUnsafe(
        `UPDATE governance."ErasureRequest"
         SET "status" = 'FAILED', "lastErrorCode" = $2, "updatedAt" = NOW()
         WHERE "id" = $1`,
        requestId,
        code,
      );
    });
    return code;
  }

  analyticsCollectionEnabled() {
    return process.env.ANALYTICS_COLLECTION_ENABLED === "true";
  }

  analyticsExportEnabled() {
    return process.env.ANALYTICS_EXPORT_ENABLED === "true";
  }

  async assertAnalyticsSubjectCollectable(userId: string) {
    if (!this.analyticsCollectionEnabled()) throw new ForbiddenException("분석 수집이 승인되지 않았어요.");
    const active = await this.prisma.user.count({ where: { id: userId, deletionRequestedAt: null, suspendedAt: null } });
    if (active !== 1) throw new ForbiddenException("탈퇴·정지 계정의 분석 자료는 새로 수집할 수 없어요.");
  }

  private errorCode(error: unknown) {
    if (!error || typeof error !== "object") return "UNKNOWN";
    const value = error as { code?: string; name?: string };
    return (value.code ?? value.name ?? "UNKNOWN").replace(/[^A-Za-z0-9_.-]/g, "_").slice(0, 80);
  }
}
