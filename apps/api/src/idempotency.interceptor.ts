import { CallHandler, ConflictException, ExecutionContext, Injectable, NestInterceptor } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type { Request } from "express";
import { catchError, from, map, mergeMap, Observable, of, throwError } from "rxjs";
import { PrismaService } from "./prisma.service";

type AuthenticatedRequest = Request & { user?: { sub?: string } };

@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(private readonly prisma: PrismaService) {}

  async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
    if (context.getType() !== "http") return next.handle();
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const key = request.header("idempotency-key")?.trim();
    const userId = request.user?.sub;
    if (!key || !userId || ["GET", "HEAD", "OPTIONS"].includes(request.method)) return next.handle();
    if (key.length > 100) throw new ConflictException("요청 식별자가 너무 길어요.");
    const route = `${request.method}:${request.originalUrl.split("?")[0]}`;
    const unique = { userId_key_route: { userId, key, route } };
    const existing = await this.prisma.idempotencyKey.findUnique({ where: unique });
    if (existing?.completedAt) return of(existing.response);
    if (existing) throw new ConflictException("같은 요청을 처리하고 있어요.");
    try {
      await this.prisma.idempotencyKey.create({
        data: { userId, key, route, expiresAt: new Date(Date.now() + 24 * 3600_000) },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new ConflictException("같은 요청을 처리하고 있어요.");
      }
      throw error;
    }
    return next.handle().pipe(
      mergeMap((value) => {
        const response = JSON.parse(JSON.stringify(value ?? null)) as Prisma.InputJsonValue;
        return from(this.prisma.idempotencyKey.update({ where: unique, data: { response, completedAt: new Date() } })).pipe(map(() => value));
      }),
      catchError((error: unknown) => from(this.prisma.idempotencyKey.deleteMany({ where: { userId, key, route, completedAt: null } })).pipe(mergeMap(() => throwError(() => error)))),
    );
  }
}
