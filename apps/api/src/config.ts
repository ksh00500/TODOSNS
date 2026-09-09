const productionRequired = [
  "DATABASE_URL",
  "REDIS_URL",
  "JWT_ACCESS_SECRET",
  "JWT_REFRESH_SECRET",
  "WEB_ORIGIN",
  "SMTP_HOST",
  "SITE_ORIGIN",
] as const;

function setting(config: Record<string, unknown>, ...names: string[]) {
  for (const name of names) {
    const candidate = config[name];
    if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
  }
  return undefined;
}

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
    const knownExamples = /^(change[-_ ]?me|example|replace[-_ ]?(me|with)|your[-_ ]?|dev[-_ ]?|test[-_ ]?|mungsil($|[-_ ]?secret))/i;
    for (const name of ["JWT_ACCESS_SECRET", "JWT_REFRESH_SECRET", "MINIO_ACCESS_KEY", "MINIO_SECRET_KEY", "STORAGE_ACCESS_KEY_ID", "STORAGE_SECRET_ACCESS_KEY"] as const) {
      if (knownExamples.test(env[name] ?? "")) throw new Error(`${name} must not use an example or development credential`);
    }
    if (env.JWT_ACCESS_SECRET === env.JWT_REFRESH_SECRET) throw new Error("JWT access and refresh secrets must be different");

    const bucket = setting(env, "STORAGE_BUCKET", "MINIO_BUCKET");
    if (!bucket) throw new Error("Missing required production environment variables: STORAGE_BUCKET or MINIO_BUCKET");
    const endpoint = setting(env, "STORAGE_ENDPOINT", "MINIO_ENDPOINT");
    const accessKey = setting(env, "STORAGE_ACCESS_KEY_ID", "MINIO_ACCESS_KEY");
    const secretKey = setting(env, "STORAGE_SECRET_ACCESS_KEY", "MINIO_SECRET_KEY");
    if (Boolean(accessKey) !== Boolean(secretKey)) {
      throw new Error("Storage access key and secret key must be configured together");
    }
    if (endpoint && (!accessKey || !secretKey)) {
      throw new Error("Custom storage endpoints require explicit access and secret keys");
    }

    const localSynthetic = env.DEPLOYMENT_SECURITY_PROFILE === "local-synthetic";
    if (localSynthetic && env.SEED_DEMO_DATA !== "true") {
      throw new Error("local-synthetic production profile requires SEED_DEMO_DATA=true and must not contain real user data");
    }
    if (!localSynthetic) {
      for (const origin of [env.SITE_ORIGIN, ...(env.WEB_ORIGIN ?? "").split(",")]) {
        if (origin && new URL(origin.trim()).protocol !== "https:") {
          throw new Error("Production SITE_ORIGIN and WEB_ORIGIN must use https");
        }
      }
      if (env.COOKIE_SECURE !== "true") throw new Error("Production COOKIE_SECURE must be true");
      if (endpoint && new URL(endpoint).protocol !== "https:") {
        throw new Error("Production custom storage endpoints must use https");
      }
    }
  }

  assertUrl("DATABASE_URL", env.DATABASE_URL, ["postgresql:", "postgres:"]);
  assertUrl("REDIS_URL", env.REDIS_URL, ["redis:", "rediss:"]);
  assertUrl("STORAGE_ENDPOINT", setting(env, "STORAGE_ENDPOINT", "MINIO_ENDPOINT"), ["http:", "https:"]);
  assertUrl("STORAGE_PUBLIC_ENDPOINT", setting(env, "STORAGE_PUBLIC_ENDPOINT", "MINIO_PUBLIC_ENDPOINT"), ["http:", "https:"]);
  assertUrl("SITE_ORIGIN", env.SITE_ORIGIN, ["http:", "https:"]);
  for (const origin of (env.WEB_ORIGIN ?? "http://localhost:3000").split(",")) {
    assertUrl("WEB_ORIGIN", origin.trim(), ["http:", "https:"]);
  }
  if (env.TRUST_PROXY_HOPS !== undefined && (!/^\d+$/.test(env.TRUST_PROXY_HOPS) || Number(env.TRUST_PROXY_HOPS) > 3)) {
    throw new Error("TRUST_PROXY_HOPS must be an integer from 0 to 3");
  }
  const numericLimits: Array<[string, number, number]> = [
    ["MEDIA_MAX_BYTES_PER_USER", 10_000_000, 10_000_000_000],
    ["MEDIA_PROCESS_CONCURRENCY", 1, 16],
    ["MEDIA_PROCESS_TIMEOUT_MS", 5_000, 120_000],
    ["MEDIA_READ_URL_TTL_SECONDS", 60, 900],
  ];
  for (const [name, minimum, maximum] of numericLimits) {
    if (env[name] !== undefined && (!/^\d+$/.test(env[name]!) || Number(env[name]) < minimum || Number(env[name]) > maximum)) {
      throw new Error(`${name} must be an integer from ${minimum} to ${maximum}`);
    }
  }
  return env;
}
