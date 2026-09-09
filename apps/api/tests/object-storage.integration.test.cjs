const test = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const {
  CreateBucketCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  HeadObjectCommand,
  ListObjectVersionsCommand,
  PutBucketVersioningCommand,
  PutObjectCommand,
} = require("@aws-sdk/client-s3");

const enabled = process.env.RUN_OBJECT_STORAGE_E2E === "1";

function isMissing(error) {
  return error?.name === "NoSuchKey"
    || error?.name === "NotFound"
    || error?.$metadata?.httpStatusCode === 404;
}

async function exactVersions(client, bucket, key) {
  const found = [];
  let keyMarker;
  let versionIdMarker;
  do {
    const page = await client.send(new ListObjectVersionsCommand({
      Bucket: bucket,
      Prefix: key,
      KeyMarker: keyMarker,
      VersionIdMarker: versionIdMarker,
    }));
    found.push(
      ...(page.Versions ?? []).filter((item) => item.Key === key).map((item) => ({ Key: key, VersionId: item.VersionId })),
      ...(page.DeleteMarkers ?? []).filter((item) => item.Key === key).map((item) => ({ Key: key, VersionId: item.VersionId })),
    );
    keyMarker = page.IsTruncated ? page.NextKeyMarker : undefined;
    versionIdMarker = page.IsTruncated ? page.NextVersionIdMarker : undefined;
  } while (keyMarker || versionIdMarker);
  return found;
}

async function cleanupSyntheticObject(client, bucket, key) {
  const versions = await exactVersions(client, bucket, key);
  if (versions.length) {
    await client.send(new DeleteObjectsCommand({ Bucket: bucket, Delete: { Objects: versions, Quiet: true } }));
  }
  await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
}

test("실제 S3 호환 저장소에서 모든 객체 버전과 delete marker만 정확히 파기한다", { skip: !enabled }, async () => {
  const { createStorageClients } = require("../dist/src/storage.js");
  const { MediaService } = require("../dist/src/media.service.js");
  const storage = createStorageClients();
  const client = storage.internal;
  const bucket = storage.bucket;
  const prefix = `synthetic-data-governance/${randomUUID()}`;
  const originalKey = `${prefix}/original.webp`;
  const thumbnailKey = `${prefix}/thumbnail.webp`;
  const neighborKey = `${originalKey}-must-survive`;
  const versioned = process.env.OBJECT_STORAGE_VERSIONED === "1";
  const service = new MediaService({});

  try {
    if (process.env.OBJECT_STORAGE_CREATE_BUCKET === "1") {
      await client.send(new CreateBucketCommand({ Bucket: bucket }));
      if (versioned) {
        await client.send(new PutBucketVersioningCommand({
          Bucket: bucket,
          VersioningConfiguration: { Status: "Enabled" },
        }));
      }
    }
    await client.send(new PutObjectCommand({ Bucket: bucket, Key: originalKey, Body: "synthetic-v1", ContentType: "image/webp" }));
    await client.send(new PutObjectCommand({ Bucket: bucket, Key: originalKey, Body: "synthetic-v2", ContentType: "image/webp" }));
    await client.send(new PutObjectCommand({ Bucket: bucket, Key: thumbnailKey, Body: "synthetic-thumb", ContentType: "image/webp" }));
    await client.send(new PutObjectCommand({ Bucket: bucket, Key: neighborKey, Body: "synthetic-neighbor", ContentType: "image/webp" }));
    if (versioned) {
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: originalKey }));
      await client.send(new PutObjectCommand({ Bucket: bucket, Key: originalKey, Body: "synthetic-v3", ContentType: "image/webp" }));
    }

    assert.equal(typeof service.deleteObjectCompletely, "function");
    await service.deleteObjectCompletely(originalKey);
    await service.deleteObjectCompletely(thumbnailKey);

    assert.deepEqual(await exactVersions(client, bucket, originalKey), []);
    assert.deepEqual(await exactVersions(client, bucket, thumbnailKey), []);
    await assert.rejects(
      client.send(new HeadObjectCommand({ Bucket: bucket, Key: originalKey })),
      isMissing,
    );
    const neighbor = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: neighborKey }));
    assert.ok((neighbor.ContentLength ?? 0) > 0, "prefix가 비슷한 합성 객체는 삭제하면 안 된다");
  } finally {
    await Promise.allSettled([
      cleanupSyntheticObject(client, bucket, originalKey),
      cleanupSyntheticObject(client, bucket, thumbnailKey),
      cleanupSyntheticObject(client, bucket, neighborKey),
    ]);
    client.destroy();
  }
});
