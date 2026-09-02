"use client";

import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { createContext, useCallback, useContext, useMemo, useState, useSyncExternalStore } from "react";
import { getCurrentSession, getSessionVersion, isDemoMode, subscribeSession } from "@/lib/api";
import type { SessionUser } from "@/lib/types";
import { ServiceWorkerRegistrar } from "./service-worker-registrar";

type Session = { status: "loading" | "guest" | "authenticated"; user: SessionUser | null; demo: boolean; refresh: () => Promise<void> };
const SessionContext = createContext<Session | null>(null);

export function AppProviders({ children }: { children: React.ReactNode }) {
  const [client] = useState(() => new QueryClient({ defaultOptions: { queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: false }, mutations: { retry: 0 } } }));
  return <QueryClientProvider client={client}><ServiceWorkerRegistrar /><SessionProvider>{children}</SessionProvider></QueryClientProvider>;
}

function SessionProvider({ children }: { children: React.ReactNode }) {
  const version = useSyncExternalStore(subscribeSession, getSessionVersion, () => 0);
  const demo = useSyncExternalStore(subscribeSession, isDemoMode, () => false);
  const query = useQuery({ queryKey: ["session", version], queryFn: () => getCurrentSession<SessionUser>(), retry: false });
  const refresh = useCallback(async () => { await query.refetch(); }, [query]);
  const status: Session["status"] = query.isPending ? "loading" : query.data ? "authenticated" : "guest";
  const session = useMemo(() => ({ status, user: query.data ?? null, demo, refresh }), [status, query.data, demo, refresh]);
  return <SessionContext.Provider value={session}>{children}</SessionContext.Provider>;
}

export function useSession() {
  const session = useContext(SessionContext);
  if (!session) throw new Error("AppProviders 안에서 사용해야 합니다.");
  return session;
}
