"use client";

import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { Bell, Check, CopyPlus, HeartHandshake, MessageCircle, Trophy, UserPlus } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { useSession } from "@/components/app-providers";
import { AuthGate, EmptyState, ErrorState, ListSkeleton } from "@/components/states";
import type { NotificationDto, NotificationPageDto } from "@mungsil/contracts";

const icons = { CHEER: HeartHandshake, COMMENT: MessageCircle, COPY: CopyPlus, FOLLOW: UserPlus, MESSAGE: Bell, CHALLENGE: Trophy, RANK: Trophy, SYSTEM: Bell };

export default function NotificationsPage() {
  const { status } = useSession(); const client = useQueryClient(); const query = useQuery({ queryKey: ["notifications"], queryFn: () => apiFetch<NotificationPageDto>("/me/notifications?limit=50"), enabled: status === "authenticated" });
  const loadMore = useMutation({ mutationFn: (cursor: string) => apiFetch<NotificationPageDto>(`/me/notifications?limit=50&cursor=${encodeURIComponent(cursor)}`), onSuccess: (next) => client.setQueryData<NotificationPageDto>(["notifications"], (page) => page ? { items: [...page.items, ...next.items], nextCursor: next.nextCursor, unreadCount: next.unreadCount } : next) });
  useEffect(() => { if (query.data?.items.some((item) => !item.readAt)) void apiFetch("/me/notifications/read", { method: "POST" }).then(() => client.setQueryData<NotificationPageDto>(["notifications"], (page) => page ? { ...page, unreadCount: 0, items: page.items.map((item) => ({ ...item, readAt: new Date().toISOString() })) } : page)); }, [query.data, client]);
  if (status === "guest") return <main className="app-page"><AuthGate title="알림은 로그인 후 확인할 수 있어요" /></main>;
  return <main className="app-page notifications-page"><header className="simple-header"><div><span>새로운 응원과 소식</span><h1>알림</h1></div>{query.data?.items.length ? <small><Check /> 모두 읽음</small> : null}</header>{query.isLoading ? <ListSkeleton /> : query.isError ? <ErrorState onRetry={() => void query.refetch()} /> : !query.data?.items.length ? <EmptyState title="아직 새로운 소식이 없어요" body="실천을 게시하면 응원과 댓글 소식이 이곳에 도착해요." /> : <><div className="notification-list">{query.data.items.map((item: NotificationDto) => { const Icon = icons[item.type]; const content = <><span><Icon /></span><div><b>{item.title}{item.targetType === "CHALLENGE_CHAT" && (item.unreadCount ?? 0) > 1 ? <em>새 메시지 {item.unreadCount}개</em> : null}</b><p>{item.body}</p><small>{new Date(item.createdAt).toLocaleString("ko-KR", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</small></div></>; return item.href ? <Link className={!item.readAt ? "unread" : ""} href={item.href} key={item.id}>{content}</Link> : <article className={!item.readAt ? "unread" : ""} key={item.id}>{content}</article>; })}</div>{query.data.nextCursor && <button className="load-more" onClick={() => loadMore.mutate(query.data!.nextCursor!)} disabled={loadMore.isPending}>{loadMore.isPending ? "불러오는 중…" : "이전 알림 더 보기"}</button>}</>}</main>;
}
