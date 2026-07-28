import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { Cron } from "@nestjs/schedule";
import { Media, MediaStatus } from "@prisma/client";
import { randomUUID } from "node:crypto";
import * as sharp from "sharp";
import { CompleteMediaDto, PresignDto } from "./dtos";
import { PrismaService } from "./prisma.service";

const MAX_IMAGE_BYTES = 10_000_000;

@Injectable()
export class MediaService {
  private readonly bucket = process.env.MINIO_BUCKET ?? "mungsil";
  private readonly s3 = new S3Client({
    endpoint: process.env.MINIO_ENDPOINT ?? "http://localhost:9000",
    region: "us-east-1",
    forcePathStyle: true,
    credentials: {
      accessKeyId: process.env.MINIO_ACCESS_KEY ?? "mungsil",
      secretAccessKey: process.env.MINIO_SECRET_KEY ?? "change-me",
    },
  });
  private readonly publicS3 = new S3Client({
    endpoint: process.env.MINIO_PUBLIC_ENDPOINT ?? process.env.MINIO_ENDPOINT ?? "http://localhost:9000",
    region: "us-east-1",
    forcePathStyle: true,
    credentials: {
      accessKeyId: process.env.MINIO_ACCESS_KEY ?? "mungsil",
      secretAccessKey: process.env.MINIO_SECRET_KEY ?? "change-me",
    },
  });

  constructor(private readonly prisma: PrismaService) {}

  async presign(userId: string, dto: PresignDto) {
    if (!/^image\/(jpeg|png|webp|heic|heif)$/.test(dto.mimeType)) {
      throw new BadRequestException("지원하지 않는 이미지 형식이에요.");
    }
    if (dto.size > MAX_IMAGE_BYTES) throw new BadRequestException("이미지는 10MB 이하여야 해요.");
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

    try {
      const source = await this.s3.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: media.objectKey }),
      );
      if (!source.Body) throw new BadRequestException("업로드한 파일을 찾지 못했어요.");
      const bytes = Buffer.from(await source.Body.transformToByteArray());
      if (!bytes.length || bytes.length > MAX_IMAGE_BYTES || bytes.length !== media.size) {
        throw new BadRequestException("이미지는 10MB 이하여야 해요.");
      }
      const metadata = await sharp(bytes, { failOn: "error", limitInputPixels: 40_000_000 }).metadata();
      if (!metadata.width || !metadata.height || !metadata.format || !["jpeg", "png", "webp", "heif"].includes(metadata.format)) {
        throw new BadRequestException("올바른 이미지 파일이 아니에요.");
      }

      const full = await sharp(bytes, { limitInputPixels: 40_000_000 })
        .rotate()
        .resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: true })
        .webp({ quality: 82 })
        .toBuffer({ resolveWithObject: true });
      const thumbnail = await sharp(bytes, { limitInputPixels: 40_000_000 })
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
            CacheControl: "private, max-age=31536000, immutable",
          }),
        ),
        this.s3.send(
          new PutObjectCommand({
            Bucket: this.bucket,
            Key: thumbnailKey,
            Body: thumbnail,
            ContentType: "image/webp",
            CacheControl: "private, max-age=31536000, immutable",
          }),
        ),
      ]);
      await this.s3.send(
        new DeleteObjectCommand({ Bucket: this.bucket, Key: media.objectKey }),
      ).catch(() => undefined);
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
      return this.serialize(ready);
    } catch (error) {
      await this.prisma.media.update({
        where: { id: media.id },
        data: { status: MediaStatus.FAILED },
      });
      if (error instanceof BadRequestException) throw error;
      throw new BadRequestException("이미지를 처리하지 못했어요. 다른 사진으로 다시 시도해주세요.");
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
    if (media.postId || media.checkInId || (media.avatarFor && media.avatarFor.id !== userId)) {
      throw new BadRequestException("이미 사용 중인 사진이에요. 새로 업로드해주세요.");
    }
    const claimed = await this.prisma.media.updateMany({ where: { id: mediaId, ownerId: userId, status: MediaStatus.READY, postId: null, checkInId: null }, data: { postId } });
    if (claimed.count !== 1) throw new BadRequestException("이미 사용 중인 사진이에요. 새로 업로드해주세요.");
    return this.prisma.media.findUniqueOrThrow({ where: { id: mediaId } });
  }

  async attachToCheckIn(userId: string, mediaId: string, checkInId: string) {
    const media = await this.readyOwned(userId, mediaId);
    if (media.postId || (media.checkInId && media.checkInId !== checkInId) || media.avatarFor) {
      throw new BadRequestException("이미 사용 중인 사진이에요. 새로 업로드해주세요.");
    }
    return this.prisma.$transaction(async (tx) => {
      const claimed = await tx.media.updateMany({ where: { id: mediaId, ownerId: userId, status: MediaStatus.READY, postId: null, OR: [{ checkInId: null }, { checkInId }] }, data: { checkInId } });
      if (claimed.count !== 1) throw new BadRequestException("이미 사용 중인 사진이에요. 새로 업로드해주세요.");
      await tx.media.updateMany({ where: { checkInId, id: { not: mediaId } }, data: { checkInId: null } });
      return tx.media.findUniqueOrThrow({ where: { id: mediaId } });
    });
  }

  async setAvatar(userId: string, mediaId: string) {
    const media = await this.readyOwned(userId, mediaId);
    if (media.postId || media.checkInId || (media.avatarFor && media.avatarFor.id !== userId)) {
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
      { expiresIn: 3600 },
    );
  }

  @Cron("0 30 3 * * *", { timeZone: "UTC" })
  async cleanupIncompleteUploads() {
    const expired = await this.prisma.media.findMany({
      where: {
        status: { in: [MediaStatus.UPLOADING, MediaStatus.FAILED] },
        createdAt: { lt: new Date(Date.now() - 24 * 3600_000) },
        postId: null,
        checkInId: null,
      },
      take: 200,
    });
    for (const media of expired) {
      await this.s3.send(
        new DeleteObjectCommand({ Bucket: this.bucket, Key: media.objectKey }),
      ).catch(() => undefined);
      await this.prisma.media.delete({ where: { id: media.id } }).catch(() => undefined);
    }
  }

  async purgeOwner(userId: string) {
    const media = await this.prisma.media.findMany({
      where: { ownerId: userId },
      select: { id: true, objectKey: true, thumbnailKey: true },
    });
    for (const item of media) {
      const keys = [item.objectKey, item.thumbnailKey].filter((key): key is string => Boolean(key));
      await Promise.all(keys.map((key) => this.s3.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key })).catch(() => undefined)));
    }
    await this.prisma.user.updateMany({ where: { id: userId }, data: { avatarMediaId: null } });
    await this.prisma.media.deleteMany({ where: { ownerId: userId } });
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
}
