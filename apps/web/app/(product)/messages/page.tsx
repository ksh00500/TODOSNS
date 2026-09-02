"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ChevronRight, Trophy, X } from "lucide-react";
import { apiFetch } from "@/lib/api";
import type { ChatInboxItem, DirectMessageRequest, DirectMessageStart } from "@/lib/types";
import { AuthGate, EmptyState, ErrorState, ListSkeleton } from "@/components/states";
import { useSession } from "@/components/app-providers";
import { Sheet } from "@/components/sheet";

export default function MessagesPage() {
  const { status, user } = useSession();
  const client = useQueryClient();
  const [requestsOpen, setRequestsOpen] = useState(false);
  const inbox = useQuery({ queryKey: ["chat-inbox"], queryFn: () => apiFetch<ChatInboxItem[]>("/messages/inbox"), enabled: status === "authenticated" });
  const requests = useQuery({ queryKey: ["direct-message-requests"], queryFn: () => apiFetch<DirectMessageRequest[]>("/messages/requests"), enabled: status === "authenticated" });
  const accept = useMutation({
    mutationFn: (id: string) => apiFetch<DirectMessageStart>(`/messages/requests/${id}/accept`, { method: "POST" }),
    onSuccess: async () => {
      await Promise.all([client.invalidateQueries({ queryKey: ["chat-inbox"] }), client.invalidateQueries({ queryKey: ["direct-message-requests"] })]);
      if ((requests.data?.length ?? 0) <= 1) setRequestsOpen(false);
    },
  });
  const reject = useMutation({
    mutationFn: (id: string) => apiFetch(`/messages/requests/${id}`, { method: "DELETE" }),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ["direct-message-requests"] });
      if ((requests.data?.length ?? 0) <= 1) setRequestsOpen(false);
    },
  });

  if (status === "guest") return <main className="app-page"><AuthGate title="대화는 로그인 후 이용할 수 있어요" /></main>;
  return <main className="app-page messages-page">
    <header className="simple-header"><div><span>서로의 하루를 가볍게 이어보세요</span><h1>대화</h1></div></header>
    {requests.isLoading || inbox.isLoading ? <ListSkeleton count={5} /> : requests.isError || inbox.isError ? <ErrorState message="대화 목록을 불러오지 못했어요." onRetry={() => { void requests.refetch(); void inbox.refetch(); }} /> : <>
      {Boolean(requests.data?.length) && <button className="message-request-summary" onClick={() => setRequestsOpen(true)} aria-haspopup="dialog">
        <b>메시지 요청</b>
        <em>{requests.data!.length}</em><ChevronRight aria-hidden="true" />
      </button>}
      <section><div className="section-heading"><div><h2>최근 대화</h2><span>1:1과 챌린지 대화를 한곳에서 확인해요</span></div></div>{!inbox.data?.length ? <EmptyState title="아직 시작한 대화가 없어요" body="사용자 프로필에서 메시지를 보내거나 챌린지에 참여해보세요." /> : <div className="conversation-list">{inbox.data.map((item) => <Link href={item.href} key={`${item.kind}-${item.id}`}>
        {item.kind === "DIRECT" ? <Avatar user={{ nickname: item.title, avatarUrl: item.avatarUrl }} /> : <span className="conversation-kind-avatar challenge" aria-hidden="true"><Trophy /></span>}
        <div><div className="conversation-title-row"><b>{item.title}</b><span className={`conversation-kind-label ${item.kind === "CHALLENGE" ? "challenge" : ""}`}>{item.kind === "CHALLENGE" ? "챌린지" : "1:1"}</span>{item.readOnly && <span className="conversation-kind-label readonly">종료됨</span>}</div><p>{preview(item, user?.id)}</p></div>
        <span><time>{formatListTime(item.lastMessage?.createdAt ?? item.updatedAt)}</time>{item.unreadCount > 0 && <em>{Math.min(99, item.unreadCount)}</em>}</span>
      </Link>)}</div>}</section>
    </>}
    {requestsOpen && <Sheet title="메시지 요청" onClose={() => setRequestsOpen(false)}>
      <p className="message-request-sheet-copy">수락한 사람과만 대화가 시작돼요. 원하지 않는 요청은 조용히 거절할 수 있어요.</p>
      <div className="message-request-list">{requests.data?.map((request) => <article key={request.id}><Avatar user={request.sender} /><div><b>{request.sender.nickname}</b><small>@{request.sender.handle} · 대화를 요청했어요</small></div><button aria-label={`${request.sender.nickname}의 요청 수락`} className="accept" disabled={accept.isPending || reject.isPending} onClick={() => accept.mutate(request.id)}><Check /></button><button aria-label={`${request.sender.nickname}의 요청 거절`} disabled={accept.isPending || reject.isPending} onClick={() => reject.mutate(request.id)}><X /></button></article>)}</div>
    </Sheet>}
  </main>;
}

function Avatar({ user }: { user: { nickname: string; avatarUrl?: string | null } }) { return user.avatarUrl ? <Image className="message-avatar" src={user.avatarUrl} alt="" width={48} height={48} unoptimized /> : <span className="message-avatar fallback">{user.nickname.slice(0, 1)}</span>; }
function preview(item: ChatInboxItem, currentUserId?: string) { const message = item.lastMessage; if (!message) return item.kind === "CHALLENGE" ? `${item.subtitle} · 첫 이야기를 시작해보세요.` : "대화를 시작해보세요."; if (message.deleted) return "삭제된 메시지예요."; const sender = message.senderId === currentUserId ? "나" : item.kind === "CHALLENGE" ? message.senderNickname : null; const body = message.body ?? (message.hasMedia ? "사진을 보냈어요." : "새 메시지가 있어요."); return sender ? `${sender}: ${body}` : body; }
function formatListTime(value: string) { const date = new Date(value), now = new Date(); return date.toDateString() === now.toDateString() ? date.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" }) : date.toLocaleDateString("ko-KR", { month: "short", day: "numeric" }); }
