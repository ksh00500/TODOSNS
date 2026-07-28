"use client";

import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, Check, CopyPlus, HeartHandshake, MessageCircle, Trophy, UserPlus } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { useSession } from "@/components/app-providers";
import { AuthGate, EmptyState, ErrorState, ListSkeleton } from "@/components/states";

type Notification = { id: string; type: "CHEER" | "COMMENT" | "COPY" | "FOLLOW" | "MESSAGE" | "CHALLENGE" | "RANK" | "SYSTEM"; title: string; body: string; referenceId?: string | null; readAt?: string | null; createdAt: string };
const icons = { CHEER: HeartHandshake, COMMENT: MessageCircle, COPY: CopyPlus, FOLLOW: UserPlus, MESSAGE: Bell, CHALLENGE: Trophy, RANK: Trophy, SYSTEM: Bell };

export default function NotificationsPage() {
  const { status } = useSession(); const client = useQueryClient(); const query = useQuery({ queryKey: ["notifications"], queryFn: () => apiFetch<Notification[]>("/me/notifications"), enabled: status === "authenticated" });
  useEffect(() => { if (query.data?.some((item) => !item.readAt)) void apiFetch("/me/notifications/read", { method: "POST" }).then(() => client.setQueryData<Notification[]>(["notifications"], (items = []) => items.map((item) => ({ ...item, readAt: new Date().toISOString() })))); }, [query.data, client]);
  if (status === "guest") return <main className="app-page"><AuthGate title="알림은 로그인 후 확인할 수 있어요" /></main>;
  return <main className="app-page notifications-page"><header className="simple-header"><div><span>새로운 응원과 소식</span><h1>알림</h1></div>{query.data?.length ? <small><Check /> 모두 읽음</small> : null}</header>{query.isLoading ? <ListSkeleton /> : query.isError ? <ErrorState onRetry={() => void query.refetch()} /> : !query.data?.length ? <EmptyState title="아직 새로운 소식이 없어요" body="실천을 공유하면 응원과 댓글 소식이 이곳에 도착해요." /> : <div className="notification-list">{query.data.map((item) => { const Icon = icons[item.type]; return <article className={!item.readAt ? "unread" : ""} key={item.id}><span><Icon /></span><div><b>{item.title}</b><p>{item.body}</p><small>{new Date(item.createdAt).toLocaleString("ko-KR", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</small></div></article>; })}</div>}</main>;
}
