"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, Check, CopyPlus, HeartHandshake, MessageCircle, Trophy, UserPlus } from "lucide-react";
import { apiFetch, userErrorMessage } from "@/lib/api";
import { useSession } from "@/components/app-providers";
import { AuthGate, EmptyState, ErrorState, ListSkeleton } from "@/components/states";
import type { NotificationDto, NotificationPageDto } from "@mungsil/contracts";

const icons = { CHEER: HeartHandshake, COMMENT: MessageCircle, COPY: CopyPlus, FOLLOW: UserPlus, MESSAGE: Bell, CHALLENGE: Trophy, RANK: Trophy, SYSTEM: Bell };

export default function NotificationsPage() {
  const { status, user } = useSession();
  const router = useRouter();
  const client = useQueryClient();
  const [error, setError] = useState("");
  const [retryId, setRetryId] = useState<string | null>(null);
  const query = useQuery({ queryKey: ["notifications"], queryFn: () => apiFetch<NotificationPageDto>("/me/notifications?limit=50"), enabled: status === "authenticated" });
  const refresh = async () => {
    await Promise.all([client.invalidateQueries({ queryKey: ["notifications"] }), client.invalidateQueries({ queryKey: ["shell-notification-count", user?.id] })]);
  };
  const loadMore = useMutation({ mutationFn: (cursor: string) => apiFetch<NotificationPageDto>(`/me/notifications?limit=50&cursor=${encodeURIComponent(cursor)}`), onSuccess: (next) => client.setQueryData<NotificationPageDto>(["notifications"], (page) => page ? { items: [...page.items, ...next.items], nextCursor: next.nextCursor, unreadCount: next.unreadCount } : next) });
  const readOne = useMutation({ mutationFn: (item: NotificationDto) => apiFetch(`/me/notifications/${encodeURIComponent(item.id)}/read`, { method: "POST" }), onSuccess: async (_result, item) => { setError(""); setRetryId(null); await refresh(); if (item.href) router.push(item.href); }, onError: (cause, item) => { setRetryId(item.id); setError(userErrorMessage(cause, "알림을 읽음 처리하지 못했어요. 다시 시도해주세요.")); } });
  const readAll = useMutation({ mutationFn: () => apiFetch("/me/notifications/read", { method: "POST" }), onSuccess: async () => { setError(""); await refresh(); }, onError: (cause) => setError(userErrorMessage(cause, "모두 읽음 처리하지 못했어요. 다시 시도해주세요.")) });
  if (status === "guest") return <main className="app-page"><AuthGate title="알림은 로그인 후 확인할 수 있어요" /></main>;
  return <main className="app-page notifications-page"><header className="simple-header"><div><span>새로운 응원과 소식</span><h1>알림</h1></div>{Boolean(query.data?.unreadCount) && <button className="notification-read-all" type="button" disabled={readAll.isPending || readOne.isPending} onClick={() => readAll.mutate()}><Check aria-hidden />{readAll.isPending ? "처리 중…" : "모두 읽음"}</button>}</header>
    {error && <p className="form-error" role="alert">{error}</p>}
    {query.isLoading ? <ListSkeleton /> : query.isError ? <ErrorState onRetry={() => void query.refetch()} /> : !query.data?.items.length ? <EmptyState title="아직 새로운 소식이 없어요" body="실천을 게시하면 응원과 댓글 소식이 이곳에 도착해요." /> : <><div className="notification-list">{query.data.items.map((item) => { const Icon = icons[item.type]; return <button type="button" className={!item.readAt ? "unread" : ""} key={item.id} disabled={readOne.isPending || readAll.isPending} onClick={() => item.readAt ? item.href && router.push(item.href) : readOne.mutate(item)}><span><Icon aria-hidden /></span><div><b>{item.title}{item.targetType === "CHALLENGE_CHAT" && (item.unreadCount ?? 0) > 1 ? <em>새 메시지 {item.unreadCount}개</em> : null}</b><p>{item.body}</p><small>{new Date(item.createdAt).toLocaleString("ko-KR", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })} · {item.readAt ? "읽음" : "읽지 않음"}</small>{retryId === item.id && <small className="form-error">다시 눌러 시도할 수 있어요.</small>}</div></button>; })}</div>{query.data.nextCursor && <button className="load-more" onClick={() => loadMore.mutate(query.data!.nextCursor!)} disabled={loadMore.isPending}>{loadMore.isPending ? "불러오는 중…" : "이전 알림 더 보기"}</button>}{loadMore.isError && <p className="form-error" role="alert">알림을 더 불러오지 못했어요. <button onClick={() => loadMore.mutate(query.data!.nextCursor!)}>다시 시도</button></p>}</>}
  </main>;
}
