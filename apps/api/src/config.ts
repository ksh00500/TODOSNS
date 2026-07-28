const productionRequired = [
  "DATABASE_URL",
  "REDIS_URL",
  "JWT_ACCESS_SECRET",
  "JWT_REFRESH_SECRET",
  "WEB_ORIGIN",
  "MINIO_ENDPOINT",
  "MINIO_ACCESS_KEY",
  "MINIO_SECRET_KEY",
  "MINIO_BUCKET",
  "SMTP_HOST",
  "SITE_ORIGIN",
] as const;

function assertUrl(name: string, value: string | undefined, protocols: string[]) {
  if (!value) return;
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${name} must be a valid URL`);
  }
  if (!protocols.includes(parsed.protocol)) {
    throw new Error(`${name} must use ${protocols.join(" or ")}`);
  }
}

export function validateEnvironment(config: Record<string, unknown>) {
  const env = Object.fromEntries(
    Object.entries(config).map(([key, value]) => [key, typeof value === "string" ? value.trim() : value]),
  ) as Record<string, string | undefined>;

  if (env.NODE_ENV === "production") {
    const missing = productionRequired.filter((key) => !env[key]);
    if (missing.length) throw new Error(`Missing required environment variables: ${missing.join(", ")}`);
    for (const name of ["JWT_ACCESS_SECRET", "JWT_REFRESH_SECRET"] as const) {
      if ((env[name]?.length ?? 0) < 32) throw new Error(`${name} must be at least 32 characters`);
    }
  }

  assertUrl("DATABASE_URL", env.DATABASE_URL, ["postgresql:", "postgres:"]);
  assertUrl("REDIS_URL", env.REDIS_URL, ["redis:", "rediss:"]);
  assertUrl("MINIO_ENDPOINT", env.MINIO_ENDPOINT, ["http:", "https:"]);
  assertUrl("MINIO_PUBLIC_ENDPOINT", env.MINIO_PUBLIC_ENDPOINT, ["http:", "https:"]);
  assertUrl("SITE_ORIGIN", env.SITE_ORIGIN, ["http:", "https:"]);
  for (const origin of (env.WEB_ORIGIN ?? "http://localhost:3000").split(",")) {
    assertUrl("WEB_ORIGIN", origin.trim(), ["http:", "https:"]);
  }
  return env;
}
