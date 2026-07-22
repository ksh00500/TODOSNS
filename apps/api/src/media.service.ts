import { BadRequestException, Injectable } from "@nestjs/common";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { randomUUID } from "crypto";
import { extname } from "path";
import { PresignDto } from "./dtos";

@Injectable()
export class MediaService {
  private readonly bucket = process.env.MINIO_BUCKET ?? "mungsil";
  private readonly s3 = new S3Client({ endpoint: process.env.MINIO_ENDPOINT ?? "http://localhost:9000", region: "us-east-1", forcePathStyle: true, credentials: { accessKeyId: process.env.MINIO_ACCESS_KEY ?? "mungsil", secretAccessKey: process.env.MINIO_SECRET_KEY ?? "change-me" } });
  async presign(userId: string, dto: PresignDto) {
    if (!/^image\/(jpeg|png|webp|heic)$/.test(dto.mimeType)) throw new BadRequestException("지원하지 않는 이미지 형식이에요.");
    const key = `uploads/${userId}/${new Date().toISOString().slice(0, 10)}/${randomUUID()}${extname(dto.filename).toLowerCase()}`;
    const uploadUrl = await getSignedUrl(this.s3, new PutObjectCommand({ Bucket: this.bucket, Key: key, ContentType: dto.mimeType, ContentLength: dto.size }), { expiresIn: 300 });
    return { key, uploadUrl, expiresIn: 300 };
  }
}
