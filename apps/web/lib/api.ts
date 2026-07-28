import { DEMO_MODE_KEY, demoApiFetch, demoAvailable, initializeDemoData, isDemoMode } from "./demo";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/api/v1";

let refreshRequest: Promise<string | null> | null = null;
const sessionListeners = new Set<() => void>();

const notifySession = () => sessionListeners.forEach((listener) => listener());

export function hasAccessToken() { return typeof window !== "undefined" && (isDemoMode() || Boolean(window.localStorage.getItem("mungsil_access_token"))); }
export function setAccessToken(token: string) { if (typeof window !== "undefined") { window.localStorage.setItem("mungsil_access_token", token); sessionListeners.forEach((listener) => listener()); } }
export function startDemoMode() { if (typeof window !== "undefined" && demoAvailable) { initializeDemoData(true); window.localStorage.setItem(DEMO_MODE_KEY, "1"); notifySession(); } }
export function clearSession() { if (typeof window !== "undefined") { window.localStorage.removeItem("mungsil_access_token"); window.localStorage.removeItem(DEMO_MODE_KEY); notifySession(); } }
export function subscribeSession(listener: () => void) { sessionListeners.add(listener); const storage = (event: StorageEvent) => { if (event.key === "mungsil_access_token" || event.key === DEMO_MODE_KEY) listener(); }; window.addEventListener("storage", storage); return () => { sessionListeners.delete(listener); window.removeEventListener("storage", storage); }; }
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

export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  if (isDemoMode()) return demoApiFetch<T>(path, init);
  const request = (token: string | null) => fetch(`${API_URL}${path}`, {
      ...init,
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...init.headers,
      },
    });

  let token = typeof window === "undefined" ? null : window.localStorage.getItem("mungsil_access_token");
  let response = await request(token);

  if (response.status === 401 && token && !path.startsWith("/auth/")) {
    token = await refreshAccessToken();
    if (token) response = await request(token);
    else clearSession();
  }

  if (!response.ok) {
    const body = await response.json().catch(() => ({ message: "요청을 처리하지 못했어요." }));
    const message = Array.isArray(body.message) ? body.message[0] : body.message;
    throw new Error(message ?? "요청을 처리하지 못했어요.");
  }
  return response.json() as Promise<T>;
}

export async function uploadImage(file: File, onProgress?: (progress: number) => void) {
  if (isDemoMode()) { onProgress?.(100); return URL.createObjectURL(file); }
  const presigned = await apiFetch<{ key: string; uploadUrl: string }>("/me/media/presign", { method: "POST", body: JSON.stringify({ filename: file.name, mimeType: file.type, size: file.size }) });
  await new Promise<void>((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("PUT", presigned.uploadUrl);
    request.setRequestHeader("Content-Type", file.type);
    request.upload.onprogress = (event) => { if (event.lengthComputable) onProgress?.(Math.round(event.loaded / event.total * 100)); };
    request.onload = () => request.status >= 200 && request.status < 300 ? resolve() : reject(new Error("사진을 업로드하지 못했어요."));
    request.onerror = () => reject(new Error("사진을 업로드하지 못했어요."));
    request.send(file);
  });
  return presigned.key;
}
