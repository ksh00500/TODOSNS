"use client";

import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { createContext, useCallback, useContext, useMemo, useState, useSyncExternalStore } from "react";
import { apiFetch, hasAccessToken, isDemoMode, subscribeSession } from "@/lib/api";
import type { SessionUser } from "@/lib/types";

type Session = { status: "loading" | "guest" | "authenticated"; user: SessionUser | null; demo: boolean; refresh: () => Promise<void> };
const SessionContext = createContext<Session | null>(null);

export function AppProviders({ children }: { children: React.ReactNode }) {
  const [client] = useState(() => new QueryClient({ defaultOptions: { queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: false }, mutations: { retry: 0 } } }));
  return <QueryClientProvider client={client}><SessionProvider>{children}</SessionProvider></QueryClientProvider>;
}

function SessionProvider({ children }: { children: React.ReactNode }) {
  const hasToken = useSyncExternalStore(subscribeSession, hasAccessToken, () => false);
  const query = useQuery({ queryKey: ["session"], queryFn: () => apiFetch<SessionUser>("/auth/me", { method: "POST" }), enabled: hasToken, retry: false });
  const refresh = useCallback(async () => { if (hasAccessToken()) await query.refetch(); }, [query]);
  const status: Session["status"] = !hasToken ? "guest" : query.isPending ? "loading" : query.data ? "authenticated" : "guest";
  const session = useMemo(() => ({ status, user: query.data ?? null, demo: isDemoMode(), refresh }), [status, query.data, refresh]);
  return <SessionContext.Provider value={session}>{children}</SessionContext.Provider>;
}

export function useSession() {
  const session = useContext(SessionContext);
  if (!session) throw new Error("AppProviders 안에서 사용해야 합니다.");
  return session;
}
