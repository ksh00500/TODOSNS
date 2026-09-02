"use client";

import Image from "next/image";
import Link from "next/link";
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Bell, BellOff, Check, ChevronDown, ExternalLink, Flag, History, ImagePlus, LoaderCircle, MessageCircleReply, MoreHorizontal, Pencil, Send, Settings2, SmilePlus, Trash2, UserRound, UsersRound, X } from "lucide-react";
import { io } from "socket.io-client";
import { useParams } from "next/navigation";
import { ConfirmSheet } from "@/components/confirm-sheet";
import { ReportSheet } from "@/components/report-sheet";
import { Sheet } from "@/components/sheet";
import { EmptyState, ErrorState, ListSkeleton } from "@/components/states";
import { apiFetch, getSocketAccessToken, isDemoMode, uploadImage } from "@/lib/api";
import type { ChallengeChatMessage, ChallengeChatPage, ChatMember, ChatNotificationLevel, ChatReactionType } from "@/lib/types";

const reactions: Array<{ type: ChatReactionType; emoji: string; label: string }> = [
  { type: "LIKE", emoji: "👍", label: "좋아요" },
  { type: "HELPFUL", emoji: "💡", label: "도움돼요" },
  { type: "CHEER", emoji: "🙌", label: "응원해요" },
  { type: "EMPATHY", emoji: "🤝", label: "공감해요" },
  { type: "SEEN", emoji: "✅", label: "확인했어요" },
];

export default function ChallengeChatPage() {
  const { id } = useParams<{ id: string }>();
  const client = useQueryClient();
  const [body, setBody] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [progress, setProgress] = useState<number[]>([]);
  const [replying, setReplying] = useState<ChallengeChatMessage | null>(null);
  const [editing, setEditing] = useState<ChallengeChatMessage | null>(null);
  const [reactionFor, setReactionFor] = useState<string | null>(null);
  const [reactionUsersFor, setReactionUsersFor] = useState<{ messageId: string; type: ChatReactionType; label: string } | null>(null);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [membersOpen, setMembersOpen] = useState(false);
  const [historyFor, setHistoryFor] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [reporting, setReporting] = useState<string | null>(null);
  const [moderating, setModerating] = useState<ChallengeChatMessage | null>(null);
  const [viewingMedia, setViewingMedia] = useState<string | null>(null);
  const [revealedBlocked, setRevealedBlocked] = useState<Set<string>>(new Set());
  const [incoming, setIncoming] = useState(0);
  const [notice, setNotice] = useState("");
  const initialized = useRef(false);

  const query = useInfiniteQuery({
    queryKey: ["challenge-chat", id],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => apiFetch<ChallengeChatPage>(`/challenges/${id}/chat?limit=30${pageParam ? `&cursor=${encodeURIComponent(pageParam)}` : ""}`),
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  });
  const room = query.data?.pages[0]?.room;
  const items = useMemo(() => query.data ? [...query.data.pages].reverse().flatMap((page) => page.items).filter((item, index, all) => all.findIndex((candidate) => candidate.id === item.id) === index) : [], [query.data]);

  const refresh = () => client.invalidateQueries({ queryKey: ["challenge-chat", id] });
  const send = useMutation({
    mutationFn: async () => {
      const mediaIds: string[] = [];
      setProgress(files.map(() => 0));
      for (const [index, file] of files.entries()) mediaIds.push(await uploadImage(file, (value) => setProgress((current) => current.map((item, itemIndex) => itemIndex === index ? value : item))));
      return apiFetch(`/challenges/${id}/chat/messages`, { method: "POST", body: JSON.stringify({ body: body.trim() || undefined, mediaIds, replyToId: replying?.id }) });
    },
    onSuccess: async () => { setBody(""); setFiles([]); setProgress([]); setReplying(null); await refresh(); requestAnimationFrame(() => scrollToBottom()); },
    onError: (cause) => setNotice(cause instanceof Error ? cause.message : "메시지를 보내지 못했어요."),
  });
  const update = useMutation({ mutationFn: () => apiFetch(`/challenges/${id}/chat/messages/${editing!.id}`, { method: "PATCH", body: JSON.stringify({ body: body.trim() }) }), onSuccess: async () => { setEditing(null); setBody(""); await refresh(); } });
  const remove = useMutation({ mutationFn: (messageId: string) => apiFetch(`/challenges/${id}/chat/messages/${messageId}`, { method: "DELETE" }), onSuccess: async () => { setDeleting(null); setMenuFor(null); await refresh(); } });
  const react = useMutation({ mutationFn: ({ messageId, type }: { messageId: string; type: ChatReactionType }) => apiFetch(`/challenges/${id}/chat/messages/${messageId}/reactions`, { method: "POST", body: JSON.stringify({ type }) }), onSuccess: async () => { setReactionFor(null); await refresh(); } });
  const read = useMutation({ mutationFn: (messageId: string) => apiFetch(`/challenges/${id}/chat/read`, { method: "POST", body: JSON.stringify({ messageId }) }) });
  const markRead = read.mutate;
  const scrollToBottom = useCallback(() => {
    const scroll = document.querySelector<HTMLElement>(".app-scroll");
    scroll?.scrollTo({ top: scroll.scrollHeight, behavior: "smooth" });
    setIncoming(0);
    const latest = items.at(-1);
    if (latest) markRead(latest.id);
  }, [items, markRead]);

  useEffect(() => {
    if (!room?.conversationId || isDemoMode()) return;
    let disposed = false;
    let renewing = false;
    let socket: ReturnType<typeof io> | null = null;
    void getSocketAccessToken().then((token) => {
      if (!token || disposed) return;
      socket = io(`${process.env.NEXT_PUBLIC_SOCKET_URL ?? "http://localhost:4000"}/chat`, { transports: ["websocket", "polling"], auth: { token }, withCredentials: true });
      socket.on("connect", () => { renewing = false; socket?.emit("join", room.conversationId); });
      socket.on("connect_error", async () => {
        if (renewing) return;
        renewing = true;
        const renewed = await getSocketAccessToken(true);
        if (!renewed || !socket || disposed) return;
        socket.auth = { token: renewed };
        socket.connect();
      });
      ["message.created", "message.updated", "message.deleted", "reaction.updated", "room.closed"].forEach((event) => socket?.on(event, () => {
        const scroll = document.querySelector<HTMLElement>(".app-scroll");
        const nearBottom = scroll ? scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight < 140 : true;
        if (!nearBottom && event === "message.created") setIncoming((value) => value + 1);
        void refresh();
      }));
    });
    return () => { disposed = true; socket?.disconnect(); };
  }, [room?.conversationId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { const timer = window.setInterval(() => void query.refetch(), 15_000); return () => window.clearInterval(timer); }, [query]);
  useEffect(() => {
    if (!items.length || initialized.current) return;
    initialized.current = true;
    requestAnimationFrame(scrollToBottom);
  }, [items, markRead, scrollToBottom]);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (editing) update.mutate(); else send.mutate();
  }

  function chooseFiles(list: FileList | null) {
    const selected = Array.from(list ?? []);
    if (selected.length > 4) return setNotice("사진은 메시지마다 최대 4장까지 올릴 수 있어요.");
    const next = selected.slice(0, 4);
    if (next.some((file) => file.size > 10_000_000)) return setNotice("사진은 한 장당 10MB 이하여야 해요.");
    setFiles(next);
  }

  if (query.isLoading) return <main className="chat-page"><ListSkeleton count={6} /></main>;
  if (query.isError || !room) return <main className="chat-page"><ErrorState message={query.error instanceof Error ? query.error.message : "대화방을 불러오지 못했어요."} onRetry={() => query.refetch()} /><Link className="secondary-button full" href={`/challenges/${id}`}>챌린지로 돌아가기</Link></main>;

  return <main className="chat-page">
    <header className="chat-header"><Link href={`/challenges/${id}`} className="icon-button" aria-label="챌린지로 돌아가기"><ArrowLeft /></Link><button type="button" className="chat-title" onClick={() => setMembersOpen(true)}><b>{room.title}</b><small><UsersRound /> 참여자 {room.participantCount.toLocaleString()}명</small></button><button type="button" className="icon-button" aria-label="대화방 알림 설정" onClick={() => setSettingsOpen(true)}><Settings2 /></button></header>
    {notice && <button className="notice chat-notice" onClick={() => setNotice("")}>{notice}</button>}
    {query.hasNextPage && <button className="chat-load-older" disabled={query.isFetchingNextPage} onClick={() => query.fetchNextPage()}><ChevronDown /> {query.isFetchingNextPage ? "불러오는 중…" : "이전 대화 더 보기"}</button>}
    <section className="chat-messages" aria-live="polite">
      {!items.length ? <EmptyState title="첫 대화를 시작해보세요" body="챌린지에 도움이 된 방법이나 조심할 점을 나눠보세요." /> : items.map((message) => <ChatBubble key={message.id} message={message} revealed={revealedBlocked.has(message.id)} onReveal={() => setRevealedBlocked((current) => new Set(current).add(message.id))} onReply={() => { setReplying(message); setEditing(null); }} onMenu={() => setMenuFor(message.id)} onReact={() => setReactionFor(message.id)} onHistory={() => setHistoryFor(message.id)} onMedia={setViewingMedia} />)}
    </section>
    {incoming > 0 && <button className="new-chat-messages" onClick={scrollToBottom}>새 메시지 {incoming}개 <ChevronDown /></button>}
    {room.readOnly ? <div className="chat-readonly"><Check /><span><b>종료된 챌린지예요</b><small>{room.purgeAt ? `${new Date(room.purgeAt).toLocaleDateString("ko-KR")}까지 대화를 볼 수 있어요.` : "대화를 읽기만 할 수 있어요."}</small></span></div> : room.mutedUntil ? <div className="chat-readonly"><BellOff /><span><b>채팅이 잠시 제한됐어요</b><small>{new Date(room.mutedUntil).toLocaleString("ko-KR")}까지 읽기만 할 수 있어요.</small></span></div> : <form className="chat-composer" onSubmit={submit}>
      {(replying || editing) && <div className="chat-compose-context"><span>{editing ? <Pencil /> : <MessageCircleReply />}</span><div><b>{editing ? "메시지 수정" : `${replying?.sender?.nickname ?? "메시지"}에게 답장`}</b><small>{editing?.body || replying?.body || "사진 메시지"}</small></div><button type="button" aria-label="답장 또는 수정 취소" onClick={() => { setReplying(null); setEditing(null); setBody(""); }}><X /></button></div>}
      {files.length > 0 && <div className="chat-photo-drafts">{files.map((file, index) => <ChatPhotoDraft file={file} index={index} progress={progress[index]} key={`${file.name}-${file.lastModified}-${index}`} onRemove={() => setFiles((current) => current.filter((_, itemIndex) => itemIndex !== index))} />)}</div>}
      <div className="chat-compose-row"><label className="chat-photo-button" aria-label="사진 첨부"><input type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif" multiple onChange={(event) => chooseFiles(event.target.files)} /><ImagePlus /></label><label className="sr-only" htmlFor="chat-message">대화 메시지</label><textarea id="chat-message" rows={1} value={body} onChange={(event) => setBody(event.target.value)} maxLength={2000} placeholder="팁이나 경험을 나눠보세요" /><button className="chat-send-button" aria-label={editing ? "메시지 수정 저장" : "메시지 보내기"} disabled={send.isPending || update.isPending || (!body.trim() && !files.length)}>{send.isPending || update.isPending ? <LoaderCircle className="spin" /> : <Send />}</button></div>
    </form>}

    {reactionFor && <ReactionSheet message={items.find((item) => item.id === reactionFor)!} onClose={() => setReactionFor(null)} onSelect={(type) => react.mutate({ messageId: reactionFor, type })} onUsers={(type, label) => { setReactionUsersFor({ messageId: reactionFor, type, label }); setReactionFor(null); }} busy={react.isPending} />}
    {reactionUsersFor && <ReactionUsersSheet challengeId={id} value={reactionUsersFor} onClose={() => setReactionUsersFor(null)} />}
    {menuFor && <MessageMenu message={items.find((item) => item.id === menuFor)!} onClose={() => setMenuFor(null)} onReply={() => { const item = items.find((candidate) => candidate.id === menuFor)!; setReplying(item); setEditing(null); setMenuFor(null); }} onEdit={() => { const item = items.find((candidate) => candidate.id === menuFor)!; setEditing(item); setReplying(null); setBody(item.body ?? ""); setMenuFor(null); }} onDelete={() => setDeleting(menuFor)} onHistory={() => { setHistoryFor(menuFor); setMenuFor(null); }} onReport={() => { setReporting(menuFor); setMenuFor(null); }} onModerate={() => { setModerating(items.find((item) => item.id === menuFor)!); setMenuFor(null); }} />}
    {settingsOpen && <ChatSettings challengeId={id} value={room.notificationLevel} onClose={() => setSettingsOpen(false)} onSaved={refresh} />}
    {membersOpen && <MembersSheet challengeId={id} canManage={room.canManage} onClose={() => setMembersOpen(false)} />}
    {historyFor && <HistorySheet challengeId={id} messageId={historyFor} onClose={() => setHistoryFor(null)} />}
    {deleting && <ConfirmSheet title="메시지를 삭제할까요?" body="대화에는 삭제된 메시지라는 표시만 남아요." confirmLabel="메시지 삭제" danger busy={remove.isPending} onClose={() => setDeleting(null)} onConfirm={() => remove.mutate(deleting)} />}
    {reporting && <ReportSheet targetType="MESSAGE" targetId={reporting} onClose={() => setReporting(null)} onReported={() => { setReporting(null); setNotice("메시지 신고가 접수됐어요."); }} />}
    {moderating && <ModerationSheet challengeId={id} message={moderating} onClose={() => setModerating(null)} onDone={async () => { setModerating(null); await refresh(); }} />}
    {viewingMedia && <Sheet title="대화 사진" onClose={() => setViewingMedia(null)}><div className="chat-media-view"><Image src={viewingMedia} alt="대화에 첨부된 사진 크게 보기" width={800} height={800} unoptimized /></div></Sheet>}
  </main>;
}

function ChatPhotoDraft({ file, index, progress, onRemove }: { file: File; index: number; progress?: number; onRemove: () => void }) {
  const [preview] = useState(() => URL.createObjectURL(file));
  useEffect(() => () => URL.revokeObjectURL(preview), [preview]);
  return <div><Image src={preview} alt={`첨부 사진 ${index + 1}`} width={72} height={72} unoptimized />{Boolean(progress && progress < 100) && <span>{progress}%</span>}<button type="button" aria-label={`첨부 사진 ${index + 1} 제거`} onClick={onRemove}><X /></button></div>;
}

function ChatBubble({ message, revealed, onReveal, onReply, onMenu, onReact, onHistory, onMedia }: { message: ChallengeChatMessage; revealed: boolean; onReveal: () => void; onReply: () => void; onMenu: () => void; onReact: () => void; onHistory: () => void; onMedia: (url: string) => void }) {
  if (message.kind === "SYSTEM") return <article className="chat-system-message"><span>{message.body}</span><time>{formatTime(message.createdAt)}</time></article>;
  if (message.blocked && !revealed) return <article className="chat-blocked-message"><span>차단한 사용자의 메시지예요.</span><button onClick={onReveal}>이 메시지만 보기</button></article>;
  const unavailable = Boolean(message.deletedAt || message.hiddenAt);
  return <article className={`chat-message ${message.canDelete ? "mine" : ""}`}>
    {!message.canDelete && <span className="avatar">{message.sender?.nickname.slice(0, 1) ?? "?"}</span>}
    <div className="chat-message-content"><header><b>{message.sender?.nickname ?? "알 수 없는 사용자"}</b><time>{formatTime(message.createdAt)}</time>{message.editedAt && !unavailable && <button onClick={onHistory}>수정됨</button>}<button className="chat-message-menu" aria-label="메시지 메뉴" onClick={onMenu}><MoreHorizontal /></button></header>
      {message.replyTo && <button className="chat-reply-preview" onClick={onReply}><MessageCircleReply /><span><b>{message.replyTo.senderNickname ?? "메시지"}</b><small>{message.replyTo.deleted ? "삭제되거나 숨겨진 메시지" : message.replyTo.body || "사진"}</small></span></button>}
      {unavailable ? <p className="chat-unavailable">{message.hiddenAt ? "운영 원칙에 따라 숨겨진 메시지예요." : "삭제된 메시지예요."}</p> : <>{message.body && <p>{message.body}</p>}{message.links.map((link) => <a className="chat-link-card" href={link.url} target="_blank" rel="noreferrer" key={link.url}><ExternalLink /><span><b>{link.domain}</b><small>{link.url}</small></span></a>)}{message.media.length > 0 && <div className={`chat-media-grid count-${message.media.length}`}>{message.media.map((media, index) => <button key={media.id} onClick={() => onMedia(media.url)} aria-label={`첨부 사진 ${index + 1} 크게 보기`}><Image src={media.thumbnailUrl || media.url} alt={`대화 첨부 사진 ${index + 1}`} width={240} height={240} unoptimized /></button>)}</div>}</>}
      {!unavailable && <div className="chat-message-actions"><button onClick={onReply}><MessageCircleReply /> 답장</button><button onClick={onReact}><SmilePlus /> 반응</button></div>}
      {message.reactions.length > 0 && <div className="chat-reactions">{message.reactions.map((reaction) => { const meta = reactions.find((item) => item.type === reaction.type)!; return <button className={reaction.mine ? "mine" : ""} key={reaction.type} onClick={() => onReact()} aria-label={`${meta.label} ${reaction.count}명`}>{meta.emoji} {reaction.count}</button>; })}</div>}
    </div>
  </article>;
}

function ReactionSheet({ message, onClose, onSelect, onUsers, busy }: { message: ChallengeChatMessage; onClose: () => void; onSelect: (type: ChatReactionType) => void; onUsers: (type: ChatReactionType, label: string) => void; busy: boolean }) { return <Sheet title="메시지에 반응하기" onClose={onClose}><div className="reaction-picker" aria-label={`${message.id} 반응 선택`}>{reactions.map((item) => { const current = message.reactions.find((reaction) => reaction.type === item.type); return <div key={item.type}><button aria-pressed={Boolean(current?.mine)} disabled={busy} onClick={() => onSelect(item.type)}><span>{item.emoji}</span><b>{item.label}</b><small>{current?.mine ? "내 반응 취소" : "반응 남기기"}</small></button>{Boolean(current?.count) && <button className="reaction-users-link" onClick={() => onUsers(item.type, item.label)}>{current!.count}명 보기</button>}</div>; })}</div></Sheet>; }

function ReactionUsersSheet({ challengeId, value, onClose }: { challengeId: string; value: { messageId: string; type: ChatReactionType; label: string }; onClose: () => void }) {
  const query = useQuery({ queryKey: ["chat-reaction-users", value.messageId, value.type], queryFn: () => apiFetch<Array<{ user: { id: string; nickname: string; handle: string } }>>(`/challenges/${challengeId}/chat/messages/${value.messageId}/reactions?type=${value.type}`) });
  return <Sheet title={`${value.label} 반응한 사람`} onClose={onClose}>{query.isLoading ? <ListSkeleton count={3} /> : query.isError ? <ErrorState message="반응한 사람을 불러오지 못했어요." onRetry={() => query.refetch()} /> : <div className="chat-member-list">{query.data?.map(({ user }) => <article key={user.id}><span className="avatar">{user.nickname.slice(0, 1)}</span><div><b>{user.nickname}</b><small>@{user.handle}</small></div></article>)}</div>}</Sheet>;
}

function MessageMenu({ message, onClose, onReply, onEdit, onDelete, onHistory, onReport, onModerate }: { message: ChallengeChatMessage; onClose: () => void; onReply: () => void; onEdit: () => void; onDelete: () => void; onHistory: () => void; onReport: () => void; onModerate: () => void }) { return <Sheet title="메시지 메뉴" onClose={onClose}><div className="sheet-action-list"><button onClick={onReply}><MessageCircleReply /> 답장하기</button>{message.canEdit && <button onClick={onEdit}><Pencil /> 수정하기</button>}{message.editedAt && !message.deletedAt && !message.hiddenAt && <button onClick={onHistory}><History /> 수정 기록 보기</button>}{message.canDelete && <button className="danger" onClick={onDelete}><Trash2 /> 삭제하기</button>}{!message.canDelete && <button onClick={onReport}><Flag /> 신고하기</button>}{message.canModerate && <button onClick={onModerate}><UserRound /> 방장 관리</button>}</div></Sheet>; }

function ChatSettings({ challengeId, value, onClose, onSaved }: { challengeId: string; value: ChatNotificationLevel; onClose: () => void; onSaved: () => Promise<unknown> }) {
  const [selected, setSelected] = useState(value);
  const mutation = useMutation({ mutationFn: () => apiFetch(`/challenges/${challengeId}/chat/settings`, { method: "PATCH", body: JSON.stringify({ notificationLevel: selected }) }), onSuccess: async () => { await onSaved(); onClose(); } });
  const options: Array<[ChatNotificationLevel, string, string]> = [["ALL", "모든 메시지", "새 메시지가 오면 방별 알림을 갱신해요."], ["REPLIES", "내 답장만", "내 메시지에 답장이 달릴 때만 알려드려요."], ["NONE", "알림 없음", "알림 없이 안 읽은 수만 표시해요."]];
  return <Sheet title="대화방 알림" onClose={onClose}><div className="chat-setting-options">{options.map(([id, title, description]) => <button key={id} aria-pressed={selected === id} className={selected === id ? "selected" : ""} onClick={() => setSelected(id)}>{id === "NONE" ? <BellOff /> : <Bell />}<span><b>{title}</b><small>{description}</small></span>{selected === id && <Check />}</button>)}</div><button className="button full" disabled={mutation.isPending} onClick={() => mutation.mutate()}>{mutation.isPending ? "저장하는 중…" : "알림 설정 저장"}</button></Sheet>;
}

function MembersSheet({ challengeId, canManage, onClose }: { challengeId: string; canManage: boolean; onClose: () => void }) {
  const [managing, setManaging] = useState<ChatMember | null>(null);
  const query = useQuery({ queryKey: ["challenge-chat-members", challengeId], queryFn: () => apiFetch<{ items: ChatMember[] }>(`/challenges/${challengeId}/chat/members?limit=50`) });
  if (managing) return <MemberModerationSheet challengeId={challengeId} member={managing} onClose={() => setManaging(null)} onDone={async () => { setManaging(null); await query.refetch(); }} />;
  return <Sheet title="대화방 참여자" onClose={onClose}>{query.isLoading ? <ListSkeleton /> : query.isError ? <ErrorState onRetry={() => query.refetch()} /> : <div className="chat-member-list">{query.data?.items.map((member) => <article key={member.user.id}><span className="avatar">{member.user.nickname.slice(0, 1)}</span><div><b>{member.user.nickname}</b><small>@{member.user.handle}{member.mutedUntil ? ` · ${new Date(member.mutedUntil).toLocaleString("ko-KR")}까지 제한` : ""}</small></div>{canManage && member.canModerate && <button onClick={() => setManaging(member)}>관리</button>}</article>)}</div>}</Sheet>;
}

function MemberModerationSheet({ challengeId, member, onClose, onDone }: { challengeId: string; member: ChatMember; onClose: () => void; onDone: () => Promise<unknown> }) {
  const [hours, setHours] = useState<24 | 168>(24);
  const [reason, setReason] = useState("");
  const unmuting = Boolean(member.mutedUntil && new Date(member.mutedUntil) > new Date());
  const mutation = useMutation({ mutationFn: () => apiFetch(`/challenges/${challengeId}/chat/members/${member.user.id}/${unmuting ? "unmute" : "mute"}`, { method: "POST", body: JSON.stringify(unmuting ? { reason: reason.trim() } : { durationHours: hours, reason: reason.trim() }) }), onSuccess: onDone });
  return <Sheet title={unmuting ? "채팅 제한 조기 해제" : "참여자 채팅 제한"} onClose={onClose}><div className="admin-target-summary"><span className="avatar">{member.user.nickname.slice(0, 1)}</span><div><b>{member.user.nickname}</b><small>@{member.user.handle}</small></div></div>{!unmuting && <div className="moderation-options"><button aria-pressed={hours === 24} className={hours === 24 ? "selected" : ""} onClick={() => setHours(24)}>24시간</button><button aria-pressed={hours === 168} className={hours === 168 ? "selected" : ""} onClick={() => setHours(168)}>7일</button></div>}<label className="field"><span>{unmuting ? "조기 해제 사유" : "제한 사유"}</span><textarea value={reason} minLength={3} maxLength={300} onChange={(event) => setReason(event.target.value)} placeholder="참여자가 이해할 수 있게 적어주세요." /></label>{mutation.isError && <p className="form-error">{mutation.error instanceof Error ? mutation.error.message : "참여자 상태를 바꾸지 못했어요."}</p>}<button className={`button full ${unmuting ? "" : "danger-button"}`} disabled={reason.trim().length < 3 || mutation.isPending} onClick={() => mutation.mutate()}>{mutation.isPending ? "적용하는 중…" : unmuting ? "채팅 제한 해제" : `${hours === 24 ? "24시간" : "7일"} 제한 적용`}</button></Sheet>;
}

function HistorySheet({ challengeId, messageId, onClose }: { challengeId: string; messageId: string; onClose: () => void }) {
  const query = useQuery({ queryKey: ["chat-history", messageId], queryFn: () => apiFetch<Array<{ id: string; body?: string | null; createdAt: string }>>(`/challenges/${challengeId}/chat/messages/${messageId}/revisions`) });
  return <Sheet title="메시지 수정 기록" onClose={onClose}>{query.isLoading ? <ListSkeleton /> : query.isError ? <ErrorState onRetry={() => query.refetch()} /> : <div className="chat-history-list">{query.data?.map((item, index) => <article key={item.id}><b>{index === query.data!.length - 1 ? "현재 내용" : `${index + 1}번째 내용`}</b><p>{item.body || "내용 없음"}</p><time>{new Date(item.createdAt).toLocaleString("ko-KR")}</time></article>)}</div>}</Sheet>;
}

function ModerationSheet({ challengeId, message, onClose, onDone }: { challengeId: string; message: ChallengeChatMessage; onClose: () => void; onDone: () => Promise<void> }) {
  const restoring = Boolean(message.hiddenAt);
  const [action, setAction] = useState<"HIDE" | "RESTORE" | "MUTE_24" | "MUTE_168">(restoring ? "RESTORE" : "HIDE");
  const [reason, setReason] = useState("");
  const mutation = useMutation({ mutationFn: () => action === "HIDE" || action === "RESTORE" ? apiFetch(`/challenges/${challengeId}/chat/messages/${message.id}/visibility`, { method: "PATCH", body: JSON.stringify({ hidden: action === "HIDE", reason }) }) : apiFetch(`/challenges/${challengeId}/chat/members/${message.sender!.id}/mute`, { method: "POST", body: JSON.stringify({ durationHours: action === "MUTE_24" ? 24 : 168, reason }) }), onSuccess: onDone });
  const options: Array<[typeof action, string]> = restoring ? [["RESTORE", "메시지 복구"]] : [["HIDE", "메시지 숨김"], ["MUTE_24", "24시간 채팅 제한"], ["MUTE_168", "7일 채팅 제한"]];
  return <Sheet title="커뮤니티 대화 관리" onClose={onClose}><div className="moderation-options">{options.map(([id,label]) => <button key={id} aria-pressed={action === id} className={action === id ? "selected" : ""} onClick={() => setAction(id)}>{label}</button>)}</div><label className="field"><span>조치 사유</span><textarea value={reason} minLength={3} maxLength={300} onChange={(event) => setReason(event.target.value)} placeholder="참여자가 이해할 수 있게 적어주세요." /></label>{mutation.isError && <p className="form-error">{mutation.error instanceof Error ? mutation.error.message : "조치하지 못했어요."}</p>}<button className={`button full ${restoring ? "" : "danger-button"}`} disabled={reason.trim().length < 3 || mutation.isPending} onClick={() => mutation.mutate()}>{mutation.isPending ? "적용하는 중…" : restoring ? "메시지 복구" : "관리 조치 적용"}</button></Sheet>;
}

function formatTime(value: string) { return new Date(value).toLocaleString("ko-KR", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }); }
