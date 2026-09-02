import { DEMO_MODE_KEY, demoApiFetch, demoAvailable, initializeDemoData, isDemoMode } from "./demo";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/api/v1";
const API_READ_CACHE = "mungsil-api-read-v1";
const SESSION_USER_CACHE = "mungsil_session_user";

let refreshRequest: Promise<string | null> | null = null;
const sessionListeners = new Set<() => void>();
let accessToken: string | null = null;
let sessionVersion = 0;

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
  accessToken = token;
  if (typeof window !== "undefined") {
    window.localStorage.removeItem("mungsil_access_token");
    window.localStorage.setItem("mungsil_session_epoch", String(Date.now()));
  }
  notifySession();
}
export function startDemoMode() { if (typeof window !== "undefined" && demoAvailable) { initializeDemoData(true); window.localStorage.setItem(DEMO_MODE_KEY, "1"); notifySession(); } }
export function clearSession() {
  accessToken = null;
  if (typeof window !== "undefined") {
    window.localStorage.removeItem("mungsil_access_token");
    window.localStorage.removeItem(DEMO_MODE_KEY);
    window.localStorage.removeItem(SESSION_USER_CACHE);
    window.localStorage.setItem("mungsil_session_epoch", String(Date.now()));
  }
  if (typeof window !== "undefined" && "caches" in window) void window.caches.delete(API_READ_CACHE);
  notifySession();
}
export function subscribeSession(listener: () => void) {
  sessionListeners.add(listener);
  const storage = (event: StorageEvent) => {
    if (event.key === "mungsil_session_epoch" || event.key === DEMO_MODE_KEY) {
      accessToken = null;
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

async function refreshAccessToken() {
  if (!refreshRequest) {
    refreshRequest = fetch(`${API_URL}/auth/refresh`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    })
      .then(async (response) => {
        if (!response.ok) return null;
        const result = await response.json() as { accessToken?: string };
        if (!result.accessToken) return null;
        setAccessToken(result.accessToken);
        return result.accessToken;
      })
      .finally(() => { refreshRequest = null; });
  }
  return refreshRequest;
}

export async function getCurrentSession<T>() {
  if (isDemoMode()) return demoApiFetch<T>("/auth/me", { method: "POST" });
  if (typeof navigator !== "undefined" && !navigator.onLine) {
    const cached = window.localStorage.getItem(SESSION_USER_CACHE);
    if (cached) return JSON.parse(cached) as T;
    throw new Error("오프라인에서 확인할 세션이 없어요.");
  }
  if (!accessToken) accessToken = await refreshAccessToken().catch(() => null);
  if (!accessToken) {
    if (typeof window !== "undefined") window.localStorage.removeItem(SESSION_USER_CACHE);
    throw new Error("로그인이 필요해요.");
  }
  const user = await apiFetch<T>("/auth/me", { method: "GET" });
  if (typeof window !== "undefined") window.localStorage.setItem(SESSION_USER_CACHE, JSON.stringify(user));
  return user;
}

export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  if (isDemoMode()) return demoApiFetch<T>(path, init);
  const method = (init.method ?? "GET").toUpperCase();
  const requestUrl = `${API_URL}${path}`;
  const mutationKey = !["GET", "HEAD", "OPTIONS"].includes(method)
    ? (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`)
    : null;
  if (typeof navigator !== "undefined" && !navigator.onLine) {
    if (method !== "GET") throw new Error("오프라인에서는 변경할 수 없어요. 연결된 뒤 다시 시도해주세요.");
    if ("caches" in window) {
      const cached = await (await window.caches.open(API_READ_CACHE)).match(requestUrl);
      if (cached) return cached.json() as Promise<T>;
    }
    throw new Error("오프라인에서 볼 수 있도록 저장된 내용이 없어요.");
  }
  const request = (token: string | null) => fetch(requestUrl, {
      ...init,
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(mutationKey ? { "Idempotency-Key": mutationKey } : {}),
        ...init.headers,
      },
    });

  let token = accessToken;
  let response = await request(token);

  if (response.status === 401 && !path.startsWith("/auth/")) {
    token = await refreshAccessToken();
    if (token) response = await request(token);
    else clearSession();
  }

  if (!response.ok) {
    const body = await response.json().catch(() => ({ message: "요청을 처리하지 못했어요." }));
    const message = Array.isArray(body.message) ? body.message[0] : body.message;
    throw new Error(message ?? "요청을 처리하지 못했어요.");
  }
  if (method === "GET" && !path.startsWith("/auth/") && typeof window !== "undefined" && "caches" in window) {
    void window.caches.open(API_READ_CACHE).then((cache) => cache.put(requestUrl, response.clone()));
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
