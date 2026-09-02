"use client";

import Image from "next/image";
import Link from "next/link";
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Ban, ChevronDown, ExternalLink, Flag, ImagePlus, LoaderCircle, MessageCircleReply, MoreHorizontal, Send, SmilePlus, Trash2, UserRound, X } from "lucide-react";
import { io } from "socket.io-client";
import { useParams, useRouter } from "next/navigation";
import { ConfirmSheet } from "@/components/confirm-sheet";
import { ReportSheet } from "@/components/report-sheet";
import { Sheet } from "@/components/sheet";
import { AuthGate, EmptyState, ErrorState, ListSkeleton } from "@/components/states";
import { useSession } from "@/components/app-providers";
import { apiFetch, getSocketAccessToken, isDemoMode, uploadImage } from "@/lib/api";
import type { ChatReactionType, DirectChatMessage, DirectChatPage } from "@/lib/types";

const reactions: Array<{ type: ChatReactionType; emoji: string; label: string }> = [
  { type: "LIKE", emoji: "👍", label: "좋아요" }, { type: "HELPFUL", emoji: "💡", label: "도움돼요" }, { type: "CHEER", emoji: "🙌", label: "응원해요" }, { type: "EMPATHY", emoji: "🤝", label: "공감해요" }, { type: "SEEN", emoji: "✅", label: "확인했어요" },
];

export default function DirectChatPage() {
  const { id } = useParams<{ id: string }>();
  const { status } = useSession();
  const router = useRouter();
  const client = useQueryClient();
  const [body, setBody] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [progress, setProgress] = useState<number[]>([]);
  const [replying, setReplying] = useState<DirectChatMessage | null>(null);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [reactionFor, setReactionFor] = useState<string | null>(null);
  const [reactionUsersFor, setReactionUsersFor] = useState<{ messageId: string; type: ChatReactionType; label: string } | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [reporting, setReporting] = useState<string | null>(null);
  const [safetyOpen, setSafetyOpen] = useState(false);
  const [blocking, setBlocking] = useState(false);
  const [viewingMedia, setViewingMedia] = useState<string | null>(null);
  const [revealedBlocked, setRevealedBlocked] = useState<Set<string>>(new Set());
  const [incoming, setIncoming] = useState(0);
  const [notice, setNotice] = useState("");
  const initialized = useRef(false);

  const query = useInfiniteQuery({
    queryKey: ["direct-chat", id], enabled: status === "authenticated",
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => apiFetch<DirectChatPage>(`/messages/${id}?limit=30${pageParam ? `&cursor=${encodeURIComponent(pageParam)}` : ""}`),
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  });
  const room = query.data?.pages[0]?.room;
  const items = useMemo(() => query.data ? [...query.data.pages].reverse().flatMap((page) => page.items).filter((item, index, all) => all.findIndex((candidate) => candidate.id === item.id) === index) : [], [query.data]);
  const refresh = useCallback(() => client.invalidateQueries({ queryKey: ["direct-chat", id] }), [client, id]);
  const read = useMutation({ mutationFn: (messageId: string) => apiFetch(`/messages/${id}/read`, { method: "POST", body: JSON.stringify({ messageId }) }), onSuccess: () => { void client.invalidateQueries({ queryKey: ["direct-conversations"] }); void client.invalidateQueries({ queryKey: ["direct-unread-count"] }); } });
  const markRead = read.mutate;
  const send = useMutation({
    mutationFn: async () => { const mediaIds: string[] = []; setProgress(files.map(() => 0)); for (const [index, file] of files.entries()) mediaIds.push(await uploadImage(file, (value) => setProgress((current) => current.map((item, itemIndex) => itemIndex === index ? value : item)))); return apiFetch(`/messages/${id}/messages`, { method: "POST", body: JSON.stringify({ body: body.trim() || undefined, mediaIds, replyToId: replying?.id }) }); },
    onSuccess: async () => { setBody(""); setFiles([]); setProgress([]); setReplying(null); await refresh(); requestAnimationFrame(() => scrollToBottom()); },
    onError: (cause) => setNotice(cause instanceof Error ? cause.message : "메시지를 보내지 못했어요."),
  });
  const remove = useMutation({ mutationFn: (messageId: string) => apiFetch(`/messages/${id}/messages/${messageId}`, { method: "DELETE" }), onSuccess: async () => { setDeleting(null); setMenuFor(null); await refresh(); } });
  const react = useMutation({ mutationFn: ({ messageId, type }: { messageId: string; type: ChatReactionType }) => apiFetch(`/messages/${id}/messages/${messageId}/reactions`, { method: "POST", body: JSON.stringify({ type }) }), onSuccess: async () => { setReactionFor(null); await refresh(); } });
  const block = useMutation({ mutationFn: () => apiFetch("/social/block", { method: "POST", body: JSON.stringify({ userId: room!.otherUser.id }) }), onSuccess: async () => { setBlocking(false); setSafetyOpen(false); await refresh(); } });
  const scrollToBottom = useCallback(() => { const scroll = document.querySelector<HTMLElement>(".app-scroll"); scroll?.scrollTo({ top: scroll.scrollHeight, behavior: "smooth" }); setIncoming(0); const latest = items.at(-1); if (latest) markRead(latest.id); }, [items, markRead]);

  useEffect(() => {
    if (!room?.conversationId || isDemoMode()) return;
    let disposed = false, renewing = false; let socket: ReturnType<typeof io> | null = null;
    void getSocketAccessToken().then((token) => { if (!token || disposed) return; socket = io(`${process.env.NEXT_PUBLIC_SOCKET_URL ?? "http://localhost:4000"}/chat`, { transports: ["websocket", "polling"], auth: { token }, withCredentials: true }); socket.on("connect", () => { renewing = false; socket?.emit("join", room.conversationId); }); socket.on("connect_error", async () => { if (renewing) return; renewing = true; const renewed = await getSocketAccessToken(true); if (!renewed || !socket || disposed) return; socket.auth = { token: renewed }; socket.connect(); }); ["message.created", "message.updated", "message.deleted", "reaction.updated"].forEach((event) => socket?.on(event, () => { const scroll = document.querySelector<HTMLElement>(".app-scroll"); const nearBottom = scroll ? scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight < 140 : true; if (!nearBottom && event === "message.created") setIncoming((value) => value + 1); void refresh(); })); });
    return () => { disposed = true; socket?.disconnect(); };
  }, [room?.conversationId, refresh]);
  useEffect(() => { const timer = window.setInterval(() => void query.refetch(), 15_000); return () => window.clearInterval(timer); }, [query]);
  useEffect(() => { if (!items.length || initialized.current) return; initialized.current = true; requestAnimationFrame(scrollToBottom); }, [items, scrollToBottom]);

  function submit(event: FormEvent) { event.preventDefault(); send.mutate(); }
  function chooseFiles(list: FileList | null) { const selected = Array.from(list ?? []); if (selected.length > 4) return setNotice("사진은 메시지마다 최대 4장까지 올릴 수 있어요."); if (selected.some((file) => file.size > 10_000_000)) return setNotice("사진은 한 장당 10MB 이하여야 해요."); setFiles(selected.slice(0, 4)); }

  if (status === "guest") return <main className="chat-page"><AuthGate title="대화는 로그인 후 이용할 수 있어요" /></main>;
  if (query.isLoading) return <main className="chat-page"><ListSkeleton count={6} /></main>;
  if (query.isError || !room) return <main className="chat-page"><ErrorState message={query.error instanceof Error ? query.error.message : "대화를 불러오지 못했어요."} onRetry={() => query.refetch()} /><Link className="secondary-button full" href="/messages">대화 목록으로 돌아가기</Link></main>;

  return <main className="chat-page direct-chat-page">
    <header className="chat-header"><Link href="/messages" className="icon-button" aria-label="대화 목록으로 돌아가기"><ArrowLeft /></Link><Link className="chat-title" href={`/people/${room.otherUser.handle}`}><b>{room.otherUser.nickname}</b><small>@{room.otherUser.handle}</small></Link><button type="button" className="icon-button" aria-label="대화 설정" onClick={() => setSafetyOpen(true)}><MoreHorizontal /></button></header>
    {notice && <button className="notice chat-notice" onClick={() => setNotice("")}>{notice}</button>}
    {query.hasNextPage && <button className="chat-load-older" disabled={query.isFetchingNextPage} onClick={() => query.fetchNextPage()}><ChevronDown /> {query.isFetchingNextPage ? "불러오는 중…" : "이전 대화 더 보기"}</button>}
    <section className="chat-messages" aria-live="polite">{!items.length ? <EmptyState title="첫 메시지를 보내보세요" body="가볍게 인사하며 대화를 시작해보세요." /> : items.map((message) => <DirectBubble key={message.id} message={message} revealed={revealedBlocked.has(message.id)} onReveal={() => setRevealedBlocked((current) => new Set(current).add(message.id))} onReply={() => setReplying(message)} onMenu={() => setMenuFor(message.id)} onReact={() => setReactionFor(message.id)} onMedia={setViewingMedia} />)}</section>
    {incoming > 0 && <button className="new-chat-messages" onClick={scrollToBottom}>새 메시지 {incoming}개 <ChevronDown /></button>}
    {!room.canSend ? <div className="chat-readonly"><Ban /><span><b>메시지를 보낼 수 없는 대화예요</b><small>{room.blockedByMe ? "내가 차단한 사용자예요." : "상대방의 개인 정보 설정으로 대화를 이어갈 수 없어요."}</small></span></div> : <form className="chat-composer" onSubmit={submit}>
      {replying && <div className="chat-compose-context"><span><MessageCircleReply /></span><div><b>{replying.sender?.nickname ?? "메시지"}에게 답장</b><small>{replying.body || "사진 메시지"}</small></div><button type="button" aria-label="답장 취소" onClick={() => setReplying(null)}><X /></button></div>}
      {files.length > 0 && <div className="chat-photo-drafts">{files.map((file, index) => <PhotoDraft file={file} index={index} progress={progress[index]} key={`${file.name}-${file.lastModified}-${index}`} onRemove={() => setFiles((current) => current.filter((_, itemIndex) => itemIndex !== index))} />)}</div>}
      <div className="chat-compose-row"><label className="chat-photo-button" aria-label="사진 첨부"><input type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif" multiple onChange={(event) => chooseFiles(event.target.files)} /><ImagePlus /></label><label className="sr-only" htmlFor="direct-chat-message">대화 메시지</label><textarea id="direct-chat-message" rows={1} value={body} onChange={(event) => setBody(event.target.value)} maxLength={2000} placeholder="메시지를 입력하세요" /><button className="chat-send-button" aria-label="메시지 보내기" disabled={send.isPending || (!body.trim() && !files.length)}>{send.isPending ? <LoaderCircle className="spin" /> : <Send />}</button></div>
    </form>}
    {reactionFor && <DirectReactionSheet message={items.find((item) => item.id === reactionFor)!} onClose={() => setReactionFor(null)} onSelect={(type) => react.mutate({ messageId: reactionFor, type })} onUsers={(type, label) => { setReactionUsersFor({ messageId: reactionFor, type, label }); setReactionFor(null); }} busy={react.isPending} />}
    {reactionUsersFor && <DirectReactionUsers conversationId={id} value={reactionUsersFor} onClose={() => setReactionUsersFor(null)} />}
    {menuFor && <DirectMessageMenu message={items.find((item) => item.id === menuFor)!} onClose={() => setMenuFor(null)} onReply={() => { setReplying(items.find((item) => item.id === menuFor)!); setMenuFor(null); }} onDelete={() => setDeleting(menuFor)} onReport={() => { setReporting(menuFor); setMenuFor(null); }} />}
    {safetyOpen && <Sheet title="대화 설정" onClose={() => setSafetyOpen(false)}><div className="sheet-action-list"><button onClick={() => router.push(`/people/${room.otherUser.handle}`)}><UserRound /> 프로필 보기</button><button onClick={() => { setReporting(`USER:${room.otherUser.id}`); setSafetyOpen(false); }}><Flag /> 사용자 신고</button>{!room.blockedByMe && <button className="danger" onClick={() => { setBlocking(true); setSafetyOpen(false); }}><Ban /> 사용자 차단</button>}</div></Sheet>}
    {blocking && <ConfirmSheet title={`${room.otherUser.nickname}님을 차단할까요?`} body="서로 팔로우가 해제되고 더 이상 메시지를 주고받을 수 없어요." confirmLabel="차단하기" danger busy={block.isPending} onClose={() => setBlocking(false)} onConfirm={() => block.mutate()} />}
    {deleting && <ConfirmSheet title="메시지를 삭제할까요?" body="대화에는 삭제된 메시지라는 표시만 남아요." confirmLabel="메시지 삭제" danger busy={remove.isPending} onClose={() => setDeleting(null)} onConfirm={() => remove.mutate(deleting)} />}
    {reporting && <ReportSheet targetType={reporting.startsWith("USER:") ? "USER" : "MESSAGE"} targetId={reporting.replace(/^USER:/, "")} onClose={() => setReporting(null)} onReported={() => { setReporting(null); setNotice("신고가 접수됐어요. 운영팀이 확인할게요."); }} />}
    {viewingMedia && <Sheet title="대화 사진" onClose={() => setViewingMedia(null)}><div className="chat-media-view"><Image src={viewingMedia} alt="대화에 첨부된 사진 크게 보기" width={800} height={800} unoptimized /></div></Sheet>}
  </main>;
}

function PhotoDraft({ file, index, progress, onRemove }: { file: File; index: number; progress?: number; onRemove: () => void }) { const [preview] = useState(() => URL.createObjectURL(file)); useEffect(() => () => URL.revokeObjectURL(preview), [preview]); return <div><Image src={preview} alt={`첨부 사진 ${index + 1}`} width={72} height={72} unoptimized />{Boolean(progress && progress < 100) && <span>{progress}%</span>}<button type="button" aria-label={`첨부 사진 ${index + 1} 제거`} onClick={onRemove}><X /></button></div>; }
function DirectBubble({ message, revealed, onReveal, onReply, onMenu, onReact, onMedia }: { message: DirectChatMessage; revealed: boolean; onReveal: () => void; onReply: () => void; onMenu: () => void; onReact: () => void; onMedia: (url: string) => void }) {
  if (message.blocked && !revealed) return <article className="chat-blocked-message"><span>차단한 사용자의 메시지예요.</span><button onClick={onReveal}>이 메시지만 보기</button></article>;
  const unavailable = Boolean(message.deletedAt || message.hiddenAt);
  return <article className={`chat-message ${message.canDelete ? "mine" : ""}`}>{!message.canDelete && <span className="avatar">{message.sender?.nickname.slice(0, 1) ?? "?"}</span>}<div className="chat-message-content"><header><b>{message.sender?.nickname ?? "알 수 없는 사용자"}</b><time>{formatTime(message.createdAt)}</time><button className="chat-message-menu" aria-label="메시지 메뉴" onClick={onMenu}><MoreHorizontal /></button></header>{message.replyTo && <button className="chat-reply-preview" onClick={onReply}><MessageCircleReply /><span><b>{message.replyTo.senderNickname ?? "메시지"}</b><small>{message.replyTo.deleted ? "삭제되거나 숨겨진 메시지" : message.replyTo.body || "사진"}</small></span></button>}{unavailable ? <p className="chat-unavailable">{message.hiddenAt ? "운영 원칙에 따라 숨겨진 메시지예요." : "삭제된 메시지예요."}</p> : <>{message.body && <p>{message.body}</p>}{message.links.map((link) => <a className="chat-link-card" href={link.url} target="_blank" rel="noreferrer" key={link.url}><ExternalLink /><span><b>{link.domain}</b><small>{link.url}</small></span></a>)}{message.media.length > 0 && <div className={`chat-media-grid count-${message.media.length}`}>{message.media.map((media, index) => <button key={media.id} onClick={() => onMedia(media.url)} aria-label={`첨부 사진 ${index + 1} 크게 보기`}><Image src={media.thumbnailUrl || media.url} alt={`대화 첨부 사진 ${index + 1}`} width={240} height={240} unoptimized /></button>)}</div>}</>}{!unavailable && <div className="chat-message-actions"><button onClick={onReply}><MessageCircleReply /> 답장</button><button onClick={onReact}><SmilePlus /> 반응</button></div>}{message.reactions.length > 0 && <div className="chat-reactions">{message.reactions.map((reaction) => { const meta = reactions.find((item) => item.type === reaction.type)!; return <button className={reaction.mine ? "mine" : ""} key={reaction.type} onClick={onReact} aria-label={`${meta.label} ${reaction.count}명`}>{meta.emoji} {reaction.count}</button>; })}</div>}</div></article>;
}
function DirectReactionSheet({ message, onClose, onSelect, onUsers, busy }: { message: DirectChatMessage; onClose: () => void; onSelect: (type: ChatReactionType) => void; onUsers: (type: ChatReactionType, label: string) => void; busy: boolean }) { return <Sheet title="메시지에 반응하기" onClose={onClose}><div className="reaction-picker">{reactions.map((item) => { const current = message.reactions.find((reaction) => reaction.type === item.type); return <div key={item.type}><button aria-pressed={Boolean(current?.mine)} disabled={busy} onClick={() => onSelect(item.type)}><span>{item.emoji}</span><b>{item.label}</b><small>{current?.mine ? "내 반응 취소" : "반응 남기기"}</small></button>{Boolean(current?.count) && <button className="reaction-users-link" onClick={() => onUsers(item.type, item.label)}>{current!.count}명 보기</button>}</div>; })}</div></Sheet>; }
function DirectReactionUsers({ conversationId, value, onClose }: { conversationId: string; value: { messageId: string; type: ChatReactionType; label: string }; onClose: () => void }) { const query = useQuery({ queryKey: ["direct-reaction-users", value.messageId, value.type], queryFn: () => apiFetch<Array<{ user: { id: string; nickname: string; handle: string } }>>(`/messages/${conversationId}/messages/${value.messageId}/reactions?type=${value.type}`) }); return <Sheet title={`${value.label} 반응한 사람`} onClose={onClose}>{query.isLoading ? <ListSkeleton count={3} /> : query.isError ? <ErrorState onRetry={() => query.refetch()} /> : <div className="chat-member-list">{query.data?.map(({ user }) => <article key={user.id}><span className="avatar">{user.nickname.slice(0, 1)}</span><div><b>{user.nickname}</b><small>@{user.handle}</small></div></article>)}</div>}</Sheet>; }
function DirectMessageMenu({ message, onClose, onReply, onDelete, onReport }: { message: DirectChatMessage; onClose: () => void; onReply: () => void; onDelete: () => void; onReport: () => void }) { return <Sheet title="메시지 메뉴" onClose={onClose}><div className="sheet-action-list"><button onClick={onReply}><MessageCircleReply /> 답장하기</button>{message.canDelete ? <button className="danger" onClick={onDelete}><Trash2 /> 삭제하기</button> : <button onClick={onReport}><Flag /> 신고하기</button>}</div></Sheet>; }
function formatTime(value: string) { return new Date(value).toLocaleString("ko-KR", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }); }
