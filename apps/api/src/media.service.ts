import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException, ServiceUnavailableException } from "@nestjs/common";
import {
  DeleteObjectsCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectVersionsCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { Cron } from "@nestjs/schedule";
import { Media, MediaStatus } from "@prisma/client";
import { randomUUID } from "node:crypto";
import * as sharp from "sharp";
import { CompleteMediaDto, PresignDto } from "./dtos";
import { PrismaService } from "./prisma.service";
import { createStorageClients } from "./storage";

const MAX_IMAGE_BYTES = 10_000_000;
const DEFAULT_ACCOUNT_MEDIA_BYTES = 500_000_000;
const DEFAULT_PROCESSING_CONCURRENCY = 2;
const DEFAULT_PROCESSING_TIMEOUT_MS = 30_000;
const DEFAULT_READ_URL_TTL_SECONDS = 300;

@Injectable()
export class MediaService {
  private readonly logger = new Logger(MediaService.name);
  private readonly storage = createStorageClients();
  private readonly bucket = this.storage.bucket;
  private readonly s3 = this.storage.internal;
  private readonly publicS3 = this.storage.public;
  private readonly accountMediaBytes = this.numberSetting(
    "MEDIA_MAX_BYTES_PER_USER",
    DEFAULT_ACCOUNT_MEDIA_BYTES,
    MAX_IMAGE_BYTES,
    10_000_000_000,
  );
  private readonly processingConcurrency = this.numberSetting(
    "MEDIA_PROCESS_CONCURRENCY",
    DEFAULT_PROCESSING_CONCURRENCY,
    1,
    16,
  );
  private readonly processingTimeoutMs = this.numberSetting(
    "MEDIA_PROCESS_TIMEOUT_MS",
    DEFAULT_PROCESSING_TIMEOUT_MS,
    5_000,
    120_000,
  );
  private readonly readUrlTtlSeconds = this.numberSetting(
    "MEDIA_READ_URL_TTL_SECONDS",
    DEFAULT_READ_URL_TTL_SECONDS,
    60,
    900,
  );
  private activeProcessing = 0;

  constructor(private readonly prisma: PrismaService) {}

  async presign(userId: string, dto: PresignDto) {
    if (!/^image\/(jpeg|png|webp|heic|heif)$/.test(dto.mimeType)) {
      throw new BadRequestException("지원하지 않는 이미지 형식이에요.");
    }
    if (dto.size > MAX_IMAGE_BYTES) throw new BadRequestException("이미지는 10MB 이하여야 해요.");
    const stored = await this.prisma.media.aggregate({
      where: { ownerId: userId },
      _sum: { size: true },
    });
    if ((stored._sum.size ?? 0) + dto.size > this.accountMediaBytes) {
      throw new BadRequestException("저장 공간이 부족해요. 사용하지 않는 사진을 정리한 뒤 다시 시도해주세요.");
    }
    const extension = this.extension(dto.mimeType);
    const key = `uploads/${userId}/${new Date().toISOString().slice(0, 10)}/${randomUUID()}${extension}`;
    const media = await this.prisma.media.create({
      data: {
        ownerId: userId,
        objectKey: key,
        originalName: dto.filename,
        mimeType: dto.mimeType,
        size: dto.size,
        status: MediaStatus.UPLOADING,
      },
    });
    const uploadUrl = await getSignedUrl(
      this.publicS3,
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        ContentType: dto.mimeType,
        ContentLength: dto.size,
      }),
      { expiresIn: 300 },
    );
    return { mediaId: media.id, key, uploadUrl, expiresIn: 300 };
  }

  async complete(userId: string, dto: CompleteMediaDto) {
    const media = await this.prisma.media.findFirst({
      where: { id: dto.mediaId, ownerId: userId },
    });
    if (!media) throw new NotFoundException("업로드 정보를 찾지 못했어요.");
    if (media.status === MediaStatus.READY) return this.serialize(media);
    if (media.status === MediaStatus.FAILED) throw new BadRequestException("다시 업로드해주세요.");
    if (this.activeProcessing >= this.processingConcurrency) {
      throw new ServiceUnavailableException("사진 처리 요청이 많아요. 잠시 후 다시 시도해주세요.");
    }
    this.activeProcessing += 1;
    const abort = new AbortController();
    const timeout = setTimeout(() => abort.abort(), this.processingTimeoutMs);
    const sharpTimeoutSeconds = Math.max(1, Math.ceil(this.processingTimeoutMs / 1000));

    try {
      const source = await this.s3.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: media.objectKey }),
        { abortSignal: abort.signal },
      );
      if (!source.Body) throw new BadRequestException("업로드한 파일을 찾지 못했어요.");
      if ((source.ContentLength ?? media.size) > MAX_IMAGE_BYTES) {
        throw new BadRequestException("이미지는 10MB 이하여야 해요.");
      }
      const bytes = Buffer.from(await source.Body.transformToByteArray());
      if (!bytes.length || bytes.length > MAX_IMAGE_BYTES || bytes.length !== media.size) {
        throw new BadRequestException("이미지는 10MB 이하여야 해요.");
      }
      const metadata = await sharp(bytes, { failOn: "error", limitInputPixels: 40_000_000 }).metadata();
      if (!metadata.width || !metadata.height || !metadata.format || !["jpeg", "png", "webp", "heif"].includes(metadata.format)) {
        throw new BadRequestException("올바른 이미지 파일이 아니에요.");
      }

      const full = await sharp(bytes, { limitInputPixels: 40_000_000 })
        .timeout({ seconds: sharpTimeoutSeconds })
        .rotate()
        .resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: true })
        .webp({ quality: 82 })
        .toBuffer({ resolveWithObject: true });
      const thumbnail = await sharp(bytes, { limitInputPixels: 40_000_000 })
        .timeout({ seconds: sharpTimeoutSeconds })
        .rotate()
        .resize({ width: 480, height: 480, fit: "inside", withoutEnlargement: true })
        .webp({ quality: 76 })
        .toBuffer();
      const objectKey = `media/${userId}/${media.id}/full.webp`;
      const thumbnailKey = `media/${userId}/${media.id}/thumb.webp`;
      await Promise.all([
        this.s3.send(
          new PutObjectCommand({
            Bucket: this.bucket,
            Key: objectKey,
            Body: full.data,
            ContentType: "image/webp",
            CacheControl: "private, no-store",
          }),
          { abortSignal: abort.signal },
        ),
        this.s3.send(
          new PutObjectCommand({
            Bucket: this.bucket,
            Key: thumbnailKey,
            Body: thumbnail,
            ContentType: "image/webp",
            CacheControl: "private, no-store",
          }),
          { abortSignal: abort.signal },
        ),
      ]);
      const sourceDeletionTaskId = await this.queueObjectDeletion(media.id, media.ownerId, media.objectKey, "SOURCE_AFTER_TRANSFORM");
      const ready = await this.prisma.media.update({
        where: { id: media.id },
        data: {
          objectKey,
          thumbnailKey,
          mimeType: "image/webp",
          size: full.data.length,
          width: full.info.width,
          height: full.info.height,
          status: MediaStatus.READY,
          completedAt: new Date(),
        },
      });
      try {
        await this.deleteObjectCompletely(media.objectKey, abort.signal);
        await this.completeObjectDeletionTask(sourceDeletionTaskId);
      } catch (error) {
        this.logger.error(JSON.stringify({ event: "transformed_source_delete_deferred", taskId: sourceDeletionTaskId, code: this.storageErrorCode(error) }));
      }
      return this.serialize(ready);
    } catch (error) {
      await this.prisma.media.update({
        where: { id: media.id },
        data: { status: MediaStatus.FAILED },
      });
      if (error instanceof BadRequestException) throw error;
      throw new BadRequestException("이미지를 처리하지 못했어요. 다른 사진으로 다시 시도해주세요.");
    } finally {
      clearTimeout(timeout);
      this.activeProcessing -= 1;
    }
  }

  async readyOwned(userId: string, mediaId: string) {
    const media = await this.prisma.media.findFirst({
      where: { id: mediaId, ownerId: userId, status: MediaStatus.READY },
      include: { avatarFor: { select: { id: true } } },
    });
    if (!media) throw new ForbiddenException("검증이 완료된 내 이미지만 사용할 수 있어요.");
    return media;
  }

  async attachToPost(userId: string, mediaId: string, postId: string) {
    const media = await this.readyOwned(userId, mediaId);
    if (media.postId || media.checkInId || media.messageId || (media.avatarFor && media.avatarFor.id !== userId)) {
      throw new BadRequestException("이미 사용 중인 사진이에요. 새로 업로드해주세요.");
    }
    const claimed = await this.prisma.media.updateMany({ where: { id: mediaId, ownerId: userId, status: MediaStatus.READY, postId: null, checkInId: null, messageId: null }, data: { postId } });
    if (claimed.count !== 1) throw new BadRequestException("이미 사용 중인 사진이에요. 새로 업로드해주세요.");
    return this.prisma.media.findUniqueOrThrow({ where: { id: mediaId } });
  }

  async attachToCheckIn(userId: string, mediaId: string, checkInId: string) {
    const media = await this.readyOwned(userId, mediaId);
    if (media.postId || media.messageId || (media.checkInId && media.checkInId !== checkInId) || media.avatarFor) {
      throw new BadRequestException("이미 사용 중인 사진이에요. 새로 업로드해주세요.");
    }
    return this.prisma.$transaction(async (tx) => {
      const claimed = await tx.media.updateMany({ where: { id: mediaId, ownerId: userId, status: MediaStatus.READY, postId: null, messageId: null, OR: [{ checkInId: null }, { checkInId }] }, data: { checkInId } });
      if (claimed.count !== 1) throw new BadRequestException("이미 사용 중인 사진이에요. 새로 업로드해주세요.");
      await tx.media.updateMany({ where: { checkInId, id: { not: mediaId } }, data: { checkInId: null } });
      return tx.media.findUniqueOrThrow({ where: { id: mediaId } });
    });
  }

  async setAvatar(userId: string, mediaId: string) {
    const media = await this.readyOwned(userId, mediaId);
    if (media.postId || media.checkInId || media.messageId || (media.avatarFor && media.avatarFor.id !== userId)) {
      throw new BadRequestException("게시물이나 인증에 사용한 사진은 프로필 사진으로 설정할 수 없어요.");
    }
    await this.prisma.user.update({ where: { id: userId }, data: { avatarMediaId: mediaId } });
    return this.urls(mediaId);
  }

  async urls(mediaId: string | null | undefined) {
    if (!mediaId) return null;
    const media = await this.prisma.media.findFirst({
      where: { id: mediaId, status: MediaStatus.READY },
    });
    return media ? this.serialize(media) : null;
  }

  async viewUrl(key: string) {
    return getSignedUrl(
      this.publicS3,
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      { expiresIn: this.readUrlTtlSeconds },
    );
  }

  async attachToMessage(userId: string, mediaIds: string[], messageId: string) {
    if (mediaIds.length > 4 || new Set(mediaIds).size !== mediaIds.length) throw new BadRequestException("사진은 메시지마다 최대 4장까지 올릴 수 있어요.");
    for (const mediaId of mediaIds) {
      const media = await this.readyOwned(userId, mediaId);
      if (media.postId || media.checkInId || media.messageId || media.avatarFor) throw new BadRequestException("이미 사용 중인 사진이에요. 새로 업로드해주세요.");
    }
    await this.prisma.$transaction(async (tx) => {
      for (const [messageOrder, mediaId] of mediaIds.entries()) {
        const claimed = await tx.media.updateMany({ where: { id: mediaId, ownerId: userId, status: MediaStatus.READY, postId: null, checkInId: null, messageId: null }, data: { messageId, messageOrder } });
        if (claimed.count !== 1) throw new BadRequestException("이미 사용 중인 사진이에요. 새로 업로드해주세요.");
      }
    });
  }

  async purgeMessageMedia(conversationId: string) {
    const media = await this.prisma.media.findMany({ where: { message: { conversationId } }, select: { id: true, objectKey: true, thumbnailKey: true } });
    for (const item of media) {
      await this.deleteObjects([item.objectKey, item.thumbnailKey]);
    }
    if (media.length) await this.prisma.media.deleteMany({ where: { id: { in: media.map((item) => item.id) } } });
  }

  async purgePosts(postIds: string[]) {
    if (!postIds.length) return;
    const media = await this.prisma.media.findMany({
      where: { postId: { in: postIds } },
      select: { id: true, ownerId: true, objectKey: true, thumbnailKey: true },
    });
    for (const item of media) {
      let complete = true;
      for (const key of [item.objectKey, item.thumbnailKey].filter((value): value is string => Boolean(value))) {
        const taskId = await this.queueObjectDeletion(item.id, item.ownerId, key, "POST_SNAPSHOT_ERASURE");
        try {
          await this.deleteObjectCompletely(key);
          await this.completeObjectDeletionTask(taskId);
        } catch (error) {
          complete = false;
          this.logger.error(JSON.stringify({ event: "post_media_delete_deferred", taskId, code: this.storageErrorCode(error) }));
        }
      }
      if (complete) await this.prisma.media.deleteMany({ where: { id: item.id, postId: { in: postIds } } });
    }
  }

  @Cron("0 30 3 * * *", { timeZone: "UTC" })
  async cleanupIncompleteUploads() {
    const expired = await this.prisma.media.findMany({
      where: {
        status: { in: [MediaStatus.UPLOADING, MediaStatus.FAILED, MediaStatus.READY] },
        createdAt: { lt: new Date(Date.now() - 24 * 3600_000) },
        postId: null,
        checkInId: null,
        messageId: null,
        avatarFor: { is: null },
      },
      take: 200,
    });
    for (const media of expired) {
      try {
        await this.deleteObjects([media.objectKey, media.thumbnailKey]);
        await this.prisma.media.delete({ where: { id: media.id } });
      } catch (error) {
        this.logger.error(JSON.stringify({ event: "media_cleanup_failed", mediaId: media.id, message: error instanceof Error ? error.message : "unknown" }));
      }
    }
  }

  async purgeOwner(userId: string) {
    if (typeof this.prisma.$queryRawUnsafe === "function") {
      const queued = await this.prisma.$queryRawUnsafe<Array<{ id: string; objectKey: string }>>(
        `SELECT "id", "objectKey" FROM governance."ObjectDeletionTask"
         WHERE "subjectUserId" = $1 AND "completedAt" IS NULL
         ORDER BY "createdAt"`,
        userId,
      );
      for (const task of queued) {
        await this.deleteObjectCompletely(task.objectKey);
        await this.prisma.$executeRawUnsafe(
          `UPDATE governance."ObjectDeletionTask"
           SET "completedAt" = NOW(), "lastErrorCode" = NULL, "updatedAt" = NOW()
           WHERE "id" = $1`,
          task.id,
        );
      }
    }
    const media = await this.prisma.media.findMany({
      where: { ownerId: userId },
      select: { id: true, objectKey: true, thumbnailKey: true },
    });
    for (const item of media) {
      await this.deleteObjects([item.objectKey, item.thumbnailKey]);
    }
    await this.prisma.user.updateMany({ where: { id: userId }, data: { avatarMediaId: null } });
    await this.prisma.media.deleteMany({ where: { ownerId: userId } });
  }

  private async deleteObjects(keys: Array<string | null>) {
    for (const key of keys.filter((value): value is string => Boolean(value))) {
      await this.deleteObjectCompletely(key);
    }
  }

  @Cron("0 */10 * * * *", { timeZone: "UTC" })
  async retryObjectDeletionTasks() {
    if (typeof this.prisma.$queryRawUnsafe !== "function") return;
    const tasks = await this.prisma.$queryRawUnsafe<Array<{ id: string; mediaId: string | null; objectKey: string; reason: string }>>(
      `WITH candidates AS (
         SELECT "id" FROM governance."ObjectDeletionTask"
         WHERE "completedAt" IS NULL AND "nextAttemptAt" <= NOW()
         ORDER BY "nextAttemptAt", "createdAt"
         FOR UPDATE SKIP LOCKED
         LIMIT 50
       )
       UPDATE governance."ObjectDeletionTask" task
       SET "attempts" = task."attempts" + 1, "lastAttemptAt" = NOW(),
           "nextAttemptAt" = NOW() + INTERVAL '10 minutes', "updatedAt" = NOW()
       FROM candidates
       WHERE task."id" = candidates."id"
       RETURNING task."id", task."mediaId", task."objectKey", task."reason"`,
    );
    for (const task of tasks) {
      try {
        await this.deleteObjectCompletely(task.objectKey);
        await this.prisma.$executeRawUnsafe(
          `UPDATE governance."ObjectDeletionTask"
           SET "completedAt" = NOW(), "lastErrorCode" = NULL, "updatedAt" = NOW()
           WHERE "id" = $1`,
          task.id,
        );
        if (task.mediaId && task.reason === "POST_SNAPSHOT_ERASURE") {
          const pending = await this.prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
            `SELECT COUNT(*)::bigint AS "count" FROM governance."ObjectDeletionTask"
             WHERE "mediaId" = $1 AND "completedAt" IS NULL`,
            task.mediaId,
          );
          if (pending[0]?.count === 0n) await this.prisma.media.deleteMany({ where: { id: task.mediaId, post: { snapshotErasedAt: { not: null } } } });
        }
      } catch (error) {
        const code = this.storageErrorCode(error);
        await this.prisma.$executeRawUnsafe(
          `UPDATE governance."ObjectDeletionTask"
           SET "lastErrorCode" = $2,
               "nextAttemptAt" = NOW() + (LEAST(1440, POWER(2, LEAST("attempts", 10)))::text || ' minutes')::interval,
               "updatedAt" = NOW()
           WHERE "id" = $1`,
          task.id,
          code,
        );
        this.logger.error(JSON.stringify({ event: "object_deletion_retry_failed", taskId: task.id, code }));
      }
    }
  }

  private async queueObjectDeletion(mediaId: string, ownerId: string, objectKey: string, reason: string) {
    const rows = await this.prisma.$queryRawUnsafe<Array<{ id: string }>>(
      `INSERT INTO governance."ObjectDeletionTask"
         ("id", "mediaId", "subjectUserId", "bucket", "objectKey", "reason", "nextAttemptAt", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW(), NOW())
       ON CONFLICT ("bucket", "objectKey") WHERE "completedAt" IS NULL
       DO UPDATE SET "nextAttemptAt" = NOW(), "updatedAt" = NOW()
       RETURNING "id"`,
      randomUUID(),
      mediaId,
      ownerId,
      this.bucket,
      objectKey,
      reason,
    );
    return rows[0].id;
  }

  private async completeObjectDeletionTask(taskId: string) {
    await this.prisma.$executeRawUnsafe(
      `UPDATE governance."ObjectDeletionTask"
       SET "completedAt" = NOW(), "lastErrorCode" = NULL, "updatedAt" = NOW()
       WHERE "id" = $1`,
      taskId,
    );
  }

  private async deleteObjectCompletely(key: string, abortSignal?: AbortSignal) {
    let unversionedDeleteAttempted = false;
    for (let round = 0; round < 20; round += 1) {
      const targets: Array<{ Key: string; VersionId?: string }> = [];
      let keyMarker: string | undefined;
      let versionIdMarker: string | undefined;
      do {
        const listed = await this.s3.send(new ListObjectVersionsCommand({
          Bucket: this.bucket,
          Prefix: key,
          KeyMarker: keyMarker,
          VersionIdMarker: versionIdMarker,
        }), { abortSignal });
        targets.push(
          ...(listed.Versions ?? []).filter((item) => item.Key === key).map((item) => ({ Key: key, VersionId: item.VersionId })),
          ...(listed.DeleteMarkers ?? []).filter((item) => item.Key === key).map((item) => ({ Key: key, VersionId: item.VersionId })),
        );
        keyMarker = listed.IsTruncated ? listed.NextKeyMarker : undefined;
        versionIdMarker = listed.IsTruncated ? listed.NextVersionIdMarker : undefined;
      } while (keyMarker || versionIdMarker);

      if (targets.length) {
        for (let index = 0; index < targets.length; index += 1000) {
          const response = await this.s3.send(new DeleteObjectsCommand({
            Bucket: this.bucket,
            Delete: { Objects: targets.slice(index, index + 1000), Quiet: true },
          }), { abortSignal });
          if (response.Errors?.length) throw new Error(`object-version-delete-failed:${response.Errors[0].Code ?? "unknown"}`);
        }
        continue;
      }

      if (!unversionedDeleteAttempted) {
        await this.s3.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }), { abortSignal });
        unversionedDeleteAttempted = true;
        continue;
      }

      try {
        await this.s3.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }), { abortSignal });
      } catch (error) {
        if (this.isObjectMissing(error)) return;
        throw error;
      }
      throw new Error("object-delete-verification-failed");
    }
    throw new Error("object-delete-version-limit-exceeded");
  }

  private isObjectMissing(error: unknown) {
    if (!error || typeof error !== "object") return false;
    const value = error as { name?: string; $metadata?: { httpStatusCode?: number } };
    return value.name === "NoSuchKey" || value.name === "NotFound" || value.$metadata?.httpStatusCode === 404;
  }

  private storageErrorCode(error: unknown) {
    if (!error || typeof error !== "object") return "UNKNOWN";
    const value = error as { name?: string; Code?: string; $metadata?: { httpStatusCode?: number } };
    return (value.name ?? value.Code ?? (value.$metadata?.httpStatusCode ? `HTTP_${value.$metadata.httpStatusCode}` : "UNKNOWN")).slice(0, 80);
  }

  private async serialize(media: Media) {
    return {
      id: media.id,
      status: media.status,
      mimeType: media.mimeType,
      size: media.size,
      width: media.width,
      height: media.height,
      url: await this.viewUrl(media.objectKey),
      thumbnailUrl: media.thumbnailKey ? await this.viewUrl(media.thumbnailKey) : null,
    };
  }

  private extension(mimeType: string) {
    return {
      "image/jpeg": ".jpg",
      "image/png": ".png",
      "image/webp": ".webp",
      "image/heic": ".heic",
      "image/heif": ".heif",
    }[mimeType] ?? ".img";
  }

  private numberSetting(name: string, fallback: number, minimum: number, maximum: number) {
    const raw = process.env[name];
    if (!raw) return fallback;
    const value = Number(raw);
    return Number.isInteger(value) && value >= minimum && value <= maximum ? value : fallback;
  }
}
