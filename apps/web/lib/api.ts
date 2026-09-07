import { DEMO_MODE_KEY, demoApiFetch, demoAvailable, initializeDemoData, isDemoMode } from "./demo";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/api/v1";
const API_READ_CACHE_PREFIX = "mungsil-api-read-v2";
const SESSION_USER_CACHE = "mungsil_session_user";
const SESSION_SCOPE_KEY = "mungsil_session_scope";
const REFRESH_LOCK_KEY = "mungsil_refresh_lock";
const PRIVATE_CACHE_PATHS = ["/todos", "/todo-lists", "/me/todo-categories"];
const CACHE_TTL_MS = 24 * 60 * 60_000;
const CACHE_MAX_ENTRIES = 50;

export class ApiError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = "ApiError";
  }
}

export function userErrorMessage(cause: unknown, fallback = "요청을 처리하지 못했어요.") {
  if (cause instanceof ApiError || cause instanceof Error && cause.message) return cause.message;
  return fallback;
}

function responseErrorMessage(status: number, serverMessage?: string) {
  if (status >= 500) return "서버에서 잠시 문제가 생겼어요. 입력한 내용은 유지했으니 다시 시도해주세요.";
  if (status === 429) return "요청이 잠시 몰렸어요. 잠시 뒤 다시 시도해주세요.";
  if (status === 409) return serverMessage || "다른 변경과 겹쳤어요. 최신 상태를 확인한 뒤 다시 시도해주세요.";
  if (status === 404) return serverMessage || "요청한 내용을 찾을 수 없어요.";
  if (status === 403) return serverMessage || "이 작업을 할 권한이 없어요.";
  if (status === 401) return "로그인이 만료됐어요. 다시 로그인해주세요.";
  return serverMessage && serverMessage !== "Internal server error" ? serverMessage : "요청을 처리하지 못했어요. 입력 내용을 확인해주세요.";
}

function networkError(cause: unknown) {
  if (cause instanceof Error && cause.name === "AbortError") return cause;
  return new ApiError(0, "네트워크 연결을 확인한 뒤 다시 시도해주세요.");
}

let refreshRequest: Promise<string | null> | null = null;
const sessionListeners = new Set<() => void>();
let accessToken: string | null = null;
let sessionVersion = 0;
let sessionScope: string | null = null;
let requestEpoch = 0;
const pendingRequests = new Set<AbortController>();

const tokenScope = (token: string) => {
  try {
    const payload = JSON.parse(atob(token.split(".")[1])) as { sub?: string };
    if (payload.sub) return payload.sub;
  } catch { /* Tests and development adapters may use opaque tokens. */ }
  let hash = 2166136261;
  for (const char of token) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return `opaque-${(hash >>> 0).toString(36)}`;
};

const storedScope = () => typeof window === "undefined" ? null : window.localStorage.getItem(SESSION_SCOPE_KEY);
export const getSessionScope = () => sessionScope ?? storedScope() ?? (isDemoMode() ? "demo" : "guest");
const cacheName = (scope = getSessionScope()) => `${API_READ_CACHE_PREFIX}-${encodeURIComponent(scope)}`;
const abortPendingRequests = () => {
  requestEpoch += 1;
  pendingRequests.forEach((controller) => controller.abort());
  pendingRequests.clear();
};

const notifySession = () => {
  sessionVersion += 1;
  sessionListeners.forEach((listener) => listener());
};

export function hasAccessToken() { return isDemoMode() || Boolean(accessToken); }
export async function getSocketAccessToken(forceRefresh = false) {
  if (isDemoMode()) return null;
  if (forceRefresh) accessToken = null;
  if (!accessToken) accessToken = await refreshAccessToken().catch(() => null);
  return accessToken;
}
export function getSessionVersion() { return sessionVersion; }
export function setAccessToken(token: string) {
  const previousScope = getSessionScope();
  const nextScope = tokenScope(token);
  if (previousScope !== "guest" && previousScope !== nextScope) {
    abortPendingRequests();
    if (typeof window !== "undefined" && "caches" in window) void window.caches.delete(cacheName(previousScope));
  }
  accessToken = token;
  sessionScope = nextScope;
  if (typeof window !== "undefined") {
    window.localStorage.removeItem("mungsil_access_token");
    window.localStorage.setItem(SESSION_SCOPE_KEY, nextScope);
    window.localStorage.setItem("mungsil_session_epoch", String(Date.now()));
  }
  notifySession();
}
export function startDemoMode() { if (typeof window !== "undefined" && demoAvailable) { initializeDemoData(true); window.localStorage.setItem(DEMO_MODE_KEY, "1"); notifySession(); } }
export function clearSession() {
  const previousScope = getSessionScope();
  abortPendingRequests();
  accessToken = null;
  sessionScope = null;
  if (typeof window !== "undefined") {
    window.localStorage.removeItem("mungsil_access_token");
    window.localStorage.removeItem(DEMO_MODE_KEY);
    window.localStorage.removeItem(`${SESSION_USER_CACHE}:${previousScope}`);
    window.localStorage.removeItem(SESSION_SCOPE_KEY);
    window.localStorage.setItem("mungsil_session_epoch", String(Date.now()));
  }
  if (typeof window !== "undefined" && "caches" in window) void window.caches.delete(cacheName(previousScope));
  notifySession();
}
export function subscribeSession(listener: () => void) {
  sessionListeners.add(listener);
  const storage = (event: StorageEvent) => {
    if (event.key === "mungsil_session_epoch" || event.key === DEMO_MODE_KEY) {
      accessToken = null;
      sessionScope = null;
      abortPendingRequests();
      notifySession();
    }
  };
  if (typeof window !== "undefined") window.addEventListener("storage", storage);
  return () => {
    sessionListeners.delete(listener);
    if (typeof window !== "undefined") window.removeEventListener("storage", storage);
  };
}
export { demoAvailable, isDemoMode };

const waitForRefreshOwner = async (epoch: string | null) => {
  for (let attempt = 0; attempt < 25; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 200));
    if (window.localStorage.getItem("mungsil_session_epoch") !== epoch || !window.localStorage.getItem(REFRESH_LOCK_KEY)) return;
  }
};

async function refreshAcrossTabs() {
  const browser = typeof window !== "undefined" ? window : null;
  const epoch = browser?.localStorage.getItem("mungsil_session_epoch") ?? null;
  const now = Date.now();
  const existing = Number(browser?.localStorage.getItem(REFRESH_LOCK_KEY) ?? 0);
  if (browser && existing > now - 10_000) await waitForRefreshOwner(epoch);
  const owner = String(Date.now());
  browser?.localStorage.setItem(REFRESH_LOCK_KEY, owner);
  try {
    let response = await fetch(`${API_URL}/auth/refresh`, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: "{}" });
    if (!response.ok && browser?.localStorage.getItem("mungsil_session_epoch") !== epoch) {
      response = await fetch(`${API_URL}/auth/refresh`, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: "{}" });
    }
    if (!response.ok) return null;
    const result = await response.json() as { accessToken?: string };
    if (!result.accessToken) return null;
    setAccessToken(result.accessToken);
    return result.accessToken;
  } finally {
    if (browser?.localStorage.getItem(REFRESH_LOCK_KEY) === owner) browser.localStorage.removeItem(REFRESH_LOCK_KEY);
  }
}

async function refreshAccessToken() {
  if (!refreshRequest) {
    refreshRequest = refreshAcrossTabs().finally(() => { refreshRequest = null; });
  }
  return refreshRequest;
}

export async function getCurrentSession<T>() {
  if (isDemoMode()) return demoApiFetch<T>("/auth/me", { method: "POST" });
  if (typeof navigator !== "undefined" && !navigator.onLine) {
    const cached = window.localStorage.getItem(`${SESSION_USER_CACHE}:${getSessionScope()}`);
    if (cached) return JSON.parse(cached) as T;
    throw new Error("오프라인에서 확인할 세션이 없어요.");
  }
  if (!accessToken) accessToken = await refreshAccessToken().catch(() => null);
  if (!accessToken) {
    if (typeof window !== "undefined") window.localStorage.removeItem(SESSION_USER_CACHE);
    throw new Error("로그인이 필요해요.");
  }
  const user = await apiFetch<T>("/auth/me", { method: "GET" });
  if (typeof window !== "undefined") window.localStorage.setItem(`${SESSION_USER_CACHE}:${getSessionScope()}`, JSON.stringify(user));
  return user;
}

export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  if (isDemoMode()) return demoApiFetch<T>(path, init);
  const method = (init.method ?? "GET").toUpperCase();
  const requestUrl = `${API_URL}${path}`;
  const scopeAtStart = getSessionScope();
  const epochAtStart = requestEpoch;
  const cacheable = method === "GET" && (path.startsWith("/public/") || PRIVATE_CACHE_PATHS.some((prefix) => path === prefix || path.startsWith(`${prefix}?`) || path.startsWith(`${prefix}/`)));
  const mutationKey = !["GET", "HEAD", "OPTIONS"].includes(method)
    ? (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`)
    : null;
  if (typeof navigator !== "undefined" && !navigator.onLine) {
    if (method !== "GET") throw new Error("오프라인에서는 변경할 수 없어요. 연결된 뒤 다시 시도해주세요.");
    if (cacheable && "caches" in window) {
      const cached = await (await window.caches.open(cacheName(scopeAtStart))).match(requestUrl);
      if (cached) {
        const cachedAt = Number(cached.headers.get("x-mungsil-cached-at") ?? 0);
        if (cachedAt && Date.now() - cachedAt <= CACHE_TTL_MS) return cached.json() as Promise<T>;
        const cache = await window.caches.open(cacheName(scopeAtStart));
        await cache.delete(requestUrl);
      }
    }
    throw new Error("오프라인에서 볼 수 있도록 저장된 내용이 없어요.");
  }
  const request = async (token: string | null) => {
    const controller = new AbortController();
    const externalSignal = init.signal;
    const abort = () => controller.abort();
    externalSignal?.addEventListener("abort", abort, { once: true });
    pendingRequests.add(controller);
    try { return await fetch(requestUrl, {
      ...init,
      signal: controller.signal,
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(mutationKey ? { "Idempotency-Key": mutationKey } : {}),
        ...init.headers,
      },
    }); } finally {
      pendingRequests.delete(controller);
      externalSignal?.removeEventListener("abort", abort);
    }
  };

  let token = accessToken;
  let response: Response;
  try {
    response = await request(token);
  } catch (error) {
    if (!mutationKey || error instanceof Error && error.name === "AbortError") throw networkError(error);
    try {
      response = await request(token);
    } catch (retryError) {
      throw networkError(retryError);
    }
  }

  if (response.status === 401 && !path.startsWith("/auth/")) {
    token = await refreshAccessToken();
    if (token) response = await request(token);
    else clearSession();
  }

  if (!response.ok) {
    const body = await response.json().catch(() => ({ message: "요청을 처리하지 못했어요." }));
    const message = Array.isArray(body.message) ? body.message[0] : body.message;
    throw new ApiError(response.status, responseErrorMessage(response.status, typeof message === "string" ? message : undefined));
  }
  const cacheCopy = cacheable ? response.clone() : null;
  if (cacheCopy && typeof window !== "undefined" && "caches" in window && epochAtStart === requestEpoch && scopeAtStart === getSessionScope()) {
    void (async () => {
      const length = Number(cacheCopy.headers.get("content-length") ?? 0);
      if (length > 1_000_000) return;
      const headers = new Headers(cacheCopy.headers);
      headers.set("x-mungsil-cached-at", String(Date.now()));
      const stored = new Response(await cacheCopy.arrayBuffer(), { status: cacheCopy.status, statusText: cacheCopy.statusText, headers });
      if (epochAtStart !== requestEpoch || scopeAtStart !== getSessionScope()) return;
      const cache = await window.caches.open(cacheName(scopeAtStart));
      await cache.put(requestUrl, stored);
      const keys = await cache.keys();
      await Promise.all(keys.slice(0, Math.max(0, keys.length - CACHE_MAX_ENTRIES)).map((key) => cache.delete(key)));
    })().catch(() => undefined);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export async function uploadImage(file: File, onProgress?: (progress: number) => void) {
  if (isDemoMode()) { onProgress?.(100); return URL.createObjectURL(file); }
  const presigned = await apiFetch<{ mediaId: string; key: string; uploadUrl: string }>("/me/media/presign", { method: "POST", body: JSON.stringify({ filename: file.name, mimeType: file.type, size: file.size }) });
  await new Promise<void>((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("PUT", presigned.uploadUrl);
    request.setRequestHeader("Content-Type", file.type);
    request.upload.onprogress = (event) => { if (event.lengthComputable) onProgress?.(Math.round(event.loaded / event.total * 90)); };
    request.onload = () => request.status >= 200 && request.status < 300 ? resolve() : reject(new Error("사진을 업로드하지 못했어요."));
    request.onerror = () => reject(new Error("사진을 업로드하지 못했어요."));
    request.send(file);
  });
  onProgress?.(94);
  await apiFetch("/me/media/complete", { method: "POST", body: JSON.stringify({ mediaId: presigned.mediaId }) });
  onProgress?.(100);
  return presigned.mediaId;
}
