import { Controller, Get, Injectable, OnModuleDestroy, ServiceUnavailableException } from "@nestjs/common";
import { HeadBucketCommand, S3Client } from "@aws-sdk/client-s3";
import Redis from "ioredis";
import { PrismaService } from "./prisma.service";

@Injectable()
export class HealthService implements OnModuleDestroy {
  private readonly redis = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", {
    lazyConnect: true,
    enableOfflineQueue: false,
    maxRetriesPerRequest: 1,
  });

  private readonly storage = new S3Client({
    endpoint: process.env.MINIO_ENDPOINT ?? "http://localhost:9000",
    region: "us-east-1",
    forcePathStyle: true,
    credentials: {
      accessKeyId: process.env.MINIO_ACCESS_KEY ?? "mungsil",
      secretAccessKey: process.env.MINIO_SECRET_KEY ?? "change-me",
    },
  });

  constructor(private readonly prisma: PrismaService) {}

  async onModuleDestroy() {
    if (this.redis.status !== "end") await this.redis.quit().catch(() => this.redis.disconnect());
    this.storage.destroy();
  }

  liveness() {
    return { ok: true, service: "mungsil-api", timestamp: new Date().toISOString() };
  }

  async readiness() {
    const checks = {
      database: await this.checkDatabase(),
      redis: await this.checkRedis(),
      storage: await this.checkStorage(),
    };
    const ok = Object.values(checks).every(Boolean);
    if (!ok) throw new ServiceUnavailableException({ ok, checks });
    return { ok, checks, timestamp: new Date().toISOString() };
  }

  private async checkDatabase() {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return true;
    } catch {
      return false;
    }
  }

  private async checkRedis() {
    try {
      if (this.redis.status === "wait") await this.redis.connect();
      return (await this.redis.ping()) === "PONG";
    } catch {
      return false;
    }
  }

  private async checkStorage() {
    try {
      await this.storage.send(new HeadBucketCommand({ Bucket: process.env.MINIO_BUCKET ?? "mungsil" }));
      return true;
    } catch {
      return false;
    }
  }
}

@Controller()
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get("health")
  health() {
    return this.healthService.liveness();
  }

  @Get("ready")
  ready() {
    return this.healthService.readiness();
  }
}
