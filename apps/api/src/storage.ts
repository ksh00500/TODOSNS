import { S3Client, type S3ClientConfig } from "@aws-sdk/client-s3";

type StorageEnvironment = Record<string, string | undefined>;

function value(...candidates: Array<string | undefined>) {
  return candidates.find((candidate) => candidate?.trim())?.trim();
}

function booleanValue(raw: string | undefined, fallback: boolean) {
  if (raw === undefined || raw.trim() === "") return fallback;
  return raw.trim().toLowerCase() === "true";
}

export function storageSettings(env: StorageEnvironment = process.env) {
  const production = env.NODE_ENV === "production";
  const endpoint = value(env.STORAGE_ENDPOINT, env.MINIO_ENDPOINT)
    ?? (production ? undefined : "http://localhost:9000");
  const publicEndpoint = value(env.STORAGE_PUBLIC_ENDPOINT, env.MINIO_PUBLIC_ENDPOINT) ?? endpoint;
  const accessKeyId = value(env.STORAGE_ACCESS_KEY_ID, env.MINIO_ACCESS_KEY)
    ?? (!production && endpoint ? "mungsil" : undefined);
  const secretAccessKey = value(env.STORAGE_SECRET_ACCESS_KEY, env.MINIO_SECRET_KEY)
    ?? (!production && endpoint ? "change-me" : undefined);
  const sessionToken = value(env.STORAGE_SESSION_TOKEN);
  const credentials = accessKeyId && secretAccessKey
    ? { accessKeyId, secretAccessKey, ...(sessionToken ? { sessionToken } : {}) }
    : undefined;

  return {
    bucket: value(env.STORAGE_BUCKET, env.MINIO_BUCKET) ?? "mungsil",
    region: value(env.STORAGE_REGION, env.AWS_REGION, env.AWS_DEFAULT_REGION) ?? "us-east-1",
    endpoint,
    publicEndpoint,
    forcePathStyle: booleanValue(env.STORAGE_FORCE_PATH_STYLE, Boolean(endpoint)),
    credentials,
  };
}

function clientConfig(
  settings: ReturnType<typeof storageSettings>,
  endpoint: string | undefined,
): S3ClientConfig {
  return {
    region: settings.region,
    forcePathStyle: settings.forcePathStyle,
    ...(endpoint ? { endpoint } : {}),
    ...(settings.credentials ? { credentials: settings.credentials } : {}),
  };
}

export function createStorageClients(env: StorageEnvironment = process.env) {
  const settings = storageSettings(env);
  return {
    bucket: settings.bucket,
    internal: new S3Client(clientConfig(settings, settings.endpoint)),
    public: new S3Client(clientConfig(settings, settings.publicEndpoint)),
  };
}
