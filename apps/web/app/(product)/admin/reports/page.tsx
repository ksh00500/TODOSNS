"use client";

import { FormEvent, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Activity, Ban, Camera, CheckCircle2, ClipboardCopy, Clock3, Eye, History, Link2, MessageCircleReply, Plus, RotateCcw, Search, ShieldAlert, ShieldCheck, TicketCheck, Trophy, UserRoundCog, Users, XCircle } from "lucide-react";
import { useSession } from "@/components/app-providers";
import { ChallengeComposer } from "@/components/challenge-composer";
import { DatePicker } from "@/components/todo-form-controls";
import { Sheet } from "@/components/sheet";
import { AuthGate, EmptyState, ErrorState, PageLoading } from "@/components/states";
import { apiFetch } from "@/lib/api";
import { localDateKey } from "@/lib/date";
import type { AdminAuditLog, AdminContent, AdminInviteCode, AdminOverview, AdminReport, AdminUser, Challenge } from "@/lib/types";

type AdminSection = "overview" | "users" | "moderation" | "challenges" | "audit";
type RewardParticipant = { userId: string; rewardStatus: string; joinedAt: string; checkInCount: number; user: { nickname: string; handle: string; email: string } };
type VerificationOverview = { pending: number; delayed: number; approved24h: number; rejected24h: number; insufficientPools: Array<{ id: string; title: string; participantCount: number; required: number }>; items: Array<{ id: string; challenge: { id: string; title: string; _count: { participants: number } }; attempt: number; reviewSize: number; validVotes: number; unsureVotes: number; submittedAt: string }> };
type MessageReportContext = { reportId: string; targetMessageId: string; items: Array<{ id: string; body: string | null; sender: { id: string; nickname: string; handle: string } | null; deletedAt: string | null; hiddenAt: string | null; createdAt: string; media: Array<{ id: string; url: string; thumbnailUrl: string | null }> }>; revisions: Array<{ id: string; body: string | null; createdAt: string }> };

const sectionOptions: Array<{ value: AdminSection; label: string; icon: typeof Activity; adminOnly?: boolean }> = [
  { value: "overview", label: "현황", icon: Activity },
  { value: "users", label: "사용자", icon: Users, adminOnly: true },
  { value: "moderation", label: "신고·콘텐츠", icon: ShieldAlert },
  { value: "challenges", label: "챌린지", icon: Trophy },
  { value: "audit", label: "기록", icon: History, adminOnly: true },
];

export default function AdminReportsPage() {
  const { status, user } = useSession();
  const permitted = user?.role === "ADMIN" || user?.role === "MODERATOR";
  const isAdmin = user?.role === "ADMIN";
  const [section, setSection] = useState<AdminSection>("overview");

  if (status === "guest") return <main className="app-page"><AuthGate /></main>;
  if (status === "loading") return <main className="app-page"><PageLoading /></main>;
  if (!permitted) return <main className="app-page"><ErrorState message="운영자만 운영 센터를 확인할 수 있어요." /></main>;

  const options = sectionOptions.filter((item) => isAdmin || !item.adminOnly);
  return <main className="app-page admin-page">
    <header className="simple-header"><div><span className="eyebrow">초대형 베타</span><h1>운영 센터</h1></div><ShieldCheck aria-hidden /></header>
    <nav className="admin-section-tabs" aria-label="운영 센터 메뉴">{options.map((item) => { const Icon = item.icon; return <button type="button" key={item.value} aria-pressed={section === item.value} className={section === item.value ? "active" : ""} onClick={() => setSection(item.value)}><Icon aria-hidden /><span>{item.label}</span></button>; })}</nav>
    {section === "overview" && <OverviewSection onNavigate={setSection} isAdmin={isAdmin} />}
    {section === "users" && isAdmin && <UsersAndInvitesSection />}
    {section === "moderation" && <ModerationSection />}
    {section === "challenges" && <ChallengeOperationsSection />}
    {section === "audit" && isAdmin && <AuditSection />}
  </main>;
}

function OverviewSection({ onNavigate, isAdmin }: { onNavigate: (section: AdminSection) => void; isAdmin: boolean }) {
  const query = useQuery({ queryKey: ["admin", "overview"], queryFn: () => apiFetch<AdminOverview>("/admin/overview") });
  if (query.isLoading) return <PageLoading />;
  if (query.isError || !query.data) return <ErrorState message="운영 현황을 불러오지 못했어요." onRetry={() => query.refetch()} />;
  const data = query.data;
  return <section className="admin-section">
    <div className="admin-metric-grid">
      <article className="tone-lilac"><Users /><span>전체 사용자</span><strong>{data.users.total}</strong><small>7일 신규 {data.users.newLast7Days}명</small></article>
      <article className="tone-mint"><Activity /><span>7일 활성</span><strong>{data.users.activeLast7Days}</strong><small>메일 인증 {data.users.verified}명</small></article>
      <article className="tone-yellow"><ShieldAlert /><span>처리 대기</span><strong>{data.moderation.openReports + data.moderation.pendingCheckIns}</strong><small>신고 {data.moderation.openReports} · 인증 {data.moderation.pendingCheckIns}</small></article>
      <article className="tone-pink"><TicketCheck /><span>활성 초대</span><strong>{data.invites.active}</strong><small>정지 사용자 {data.users.suspended}명</small></article>
    </div>
    <div className="section-heading"><div><h2>최근 7일 핵심 순환</h2><span>개인 본문 없이 행동 수만 집계해요</span></div></div>
    <div className="admin-funnel surface-card"><div><b>{data.activity.completedTodosLast7Days}</b><span>TODO 완료</span></div><i /><div><b>{data.activity.publishedPostsLast7Days}</b><span>게시</span></div><i /><div><b>{data.activity.copiedTodosLast7Days}</b><span>가져오기</span></div></div>
    <div className="section-heading"><div><h2>바로 처리할 일</h2><span>대기 항목이 있는 영역으로 이동해요</span></div></div>
    <div className="admin-quick-actions"><button onClick={() => onNavigate("moderation")}><ShieldAlert /><span><b>신고·콘텐츠 확인</b><small>{data.moderation.openReports}건의 열린 신고</small></span></button><button onClick={() => onNavigate("challenges")}><Camera /><span><b>사진 인증 흐름 확인</b><small>{data.moderation.pendingCheckIns}건 자동 판정 대기</small></span></button>{isAdmin && <button onClick={() => onNavigate("users")}><UserRoundCog /><span><b>사용자·초대 관리</b><small>활성 초대 코드 {data.invites.active}개</small></span></button>}</div>
  </section>;
}

function UsersAndInvitesSection() {
  const client = useQueryClient();
  const [creatingInvite, setCreatingInvite] = useState(false);
  const [createdCode, setCreatedCode] = useState("");
  const [queryText, setQueryText] = useState("");
  const [submittedQuery, setSubmittedQuery] = useState("");
  const [userStatus, setUserStatus] = useState<"ALL" | "ACTIVE" | "SUSPENDED">("ALL");
  const [suspensionTarget, setSuspensionTarget] = useState<AdminUser | null>(null);
  const invites = useQuery({ queryKey: ["admin", "invite-codes"], queryFn: () => apiFetch<{ items: AdminInviteCode[] }>("/admin/invite-codes") });
  const users = useQuery({ queryKey: ["admin", "users", submittedQuery, userStatus], queryFn: () => apiFetch<{ items: AdminUser[] }>(`/admin/users?limit=50&status=${userStatus}${submittedQuery ? `&query=${encodeURIComponent(submittedQuery)}` : ""}`) });
  const toggleInvite = useMutation({ mutationFn: ({ id, disabled }: { id: string; disabled: boolean }) => apiFetch(`/admin/invite-codes/${id}`, { method: "PATCH", body: JSON.stringify({ disabled }) }), onSuccess: () => { void Promise.all([client.invalidateQueries({ queryKey: ["admin", "invite-codes"] }), client.invalidateQueries({ queryKey: ["admin", "overview"] })]); } });
  const submitSearch = (event: FormEvent) => { event.preventDefault(); setSubmittedQuery(queryText.trim()); };
  return <section className="admin-section">
    <div className="section-heading spaced"><div><h2>초대 코드</h2><span>코드 원문은 생성 직후 한 번만 보여요</span></div><button className="section-action" onClick={() => setCreatingInvite(true)}><Plus /> 발급</button></div>
    {createdCode && <div className="created-invite-code"><div><span>새 초대 코드</span><strong>{createdCode}</strong><small>닫기 전에 안전한 곳에 보관해주세요.</small></div><button type="button" aria-label="초대 코드 복사" onClick={() => void navigator.clipboard.writeText(createdCode)}><ClipboardCopy /></button><button type="button" className="text-close" onClick={() => setCreatedCode("")}>확인</button></div>}
    {invites.isLoading ? <PageLoading /> : invites.isError ? <ErrorState message="초대 코드를 불러오지 못했어요." onRetry={() => invites.refetch()} /> : <div className="invite-code-list">{invites.data?.items.map((item) => <article className="surface-card" key={item.id}><div><b>{item.label || "이름 없는 초대 코드"}</b><small>{item.uses}/{item.maxUses}회 사용 · {item.expiresAt ? `${new Date(item.expiresAt).toLocaleDateString("ko-KR")} 만료` : "만료 없음"}</small></div><span className={`status-pill status-${item.state.toLowerCase()}`}>{inviteStateLabel(item.state)}</span><button type="button" disabled={toggleInvite.isPending || item.state === "EXPIRED" || item.state === "EXHAUSTED"} onClick={() => toggleInvite.mutate({ id: item.id, disabled: item.state !== "DISABLED" })}>{item.state === "DISABLED" ? <><RotateCcw /> 활성화</> : <><Ban /> 중지</>}</button></article>)}</div>}
    <div className="section-heading"><div><h2>사용자 관리</h2><span>정지 시 모든 로그인 세션이 즉시 종료돼요</span></div></div>
    <form className="admin-search" onSubmit={submitSearch}><label><span>사용자 검색</span><div><Search /><input value={queryText} onChange={(event) => setQueryText(event.target.value)} placeholder="닉네임, 아이디 또는 이메일" /><button>검색</button></div></label></form>
    <div className="admin-filter-row" aria-label="사용자 상태">{(["ALL", "ACTIVE", "SUSPENDED"] as const).map((value) => <button type="button" key={value} aria-pressed={userStatus === value} className={userStatus === value ? "active" : ""} onClick={() => setUserStatus(value)}>{value === "ALL" ? "전체" : value === "ACTIVE" ? "이용 중" : "정지"}</button>)}</div>
    {users.isLoading ? <PageLoading /> : users.isError ? <ErrorState message="사용자를 불러오지 못했어요." onRetry={() => users.refetch()} /> : !users.data?.items.length ? <EmptyState title="조건에 맞는 사용자가 없어요" body="검색어나 상태 조건을 바꿔보세요." /> : <div className="admin-user-list">{users.data.items.map((item) => <article className="surface-card" key={item.id}><span className="avatar">{item.nickname.slice(0, 1)}</span><div><b>{item.nickname}<small>@{item.handle}</small></b><p>{item.email}</p><small>TODO {item._count.todos} · 게시물 {item._count.posts} · 활성 세션 {item._count.sessions}</small>{item.suspensionReason && <em>정지 사유 · {item.suspensionReason}</em>}</div><span className={`status-pill ${item.suspendedAt ? "status-dismissed" : "status-resolved"}`}>{item.suspendedAt ? "정지" : item.role === "USER" ? "이용 중" : item.role}</span>{item.role === "USER" && <button type="button" className={item.suspendedAt ? "restore" : "danger"} onClick={() => setSuspensionTarget(item)}>{item.suspendedAt ? "정지 해제" : "정지"}</button>}</article>)}</div>}
    {creatingInvite && <InviteCodeSheet onClose={() => setCreatingInvite(false)} onCreated={(code) => { setCreatedCode(code); setCreatingInvite(false); void Promise.all([client.invalidateQueries({ queryKey: ["admin", "invite-codes"] }), client.invalidateQueries({ queryKey: ["admin", "overview"] })]); }} />}
    {suspensionTarget && <UserSuspensionSheet user={suspensionTarget} onClose={() => setSuspensionTarget(null)} onSaved={() => { setSuspensionTarget(null); void Promise.all([client.invalidateQueries({ queryKey: ["admin", "users"] }), client.invalidateQueries({ queryKey: ["admin", "overview"] }), client.invalidateQueries({ queryKey: ["admin", "audit"] })]); }} />}
  </section>;
}

function InviteCodeSheet({ onClose, onCreated }: { onClose: () => void; onCreated: (code: string) => void }) {
  const expires = new Date(); expires.setDate(expires.getDate() + 30);
  const [label, setLabel] = useState("");
  const [maxUses, setMaxUses] = useState(10);
  const [expiresAt, setExpiresAt] = useState(localDateKey(expires));
  const mutation = useMutation({ mutationFn: () => apiFetch<{ code: string }>("/admin/invite-codes", { method: "POST", body: JSON.stringify({ label: label.trim() || undefined, maxUses, expiresAt: `${expiresAt}T23:59:59+09:00` }) }), onSuccess: (result) => onCreated(result.code) });
  return <Sheet title="초대 코드 발급" onClose={onClose}><form className="composer-form" onSubmit={(event) => { event.preventDefault(); mutation.mutate(); }}><label className="field"><span>구분 이름</span><input value={label} onChange={(event) => setLabel(event.target.value)} maxLength={100} placeholder="예: 1차 내부 테스터" /></label><fieldset className="admin-choice"><legend>최대 사용 횟수</legend><div>{[1, 5, 10, 30, 100].map((value) => <button type="button" key={value} aria-pressed={maxUses === value} className={maxUses === value ? "active" : ""} onClick={() => setMaxUses(value)}>{value}회</button>)}</div></fieldset><DatePicker label="만료일" value={expiresAt} min={localDateKey()} onChange={setExpiresAt} />{mutation.isError && <p className="form-error">{mutation.error instanceof Error ? mutation.error.message : "초대 코드를 만들지 못했어요."}</p>}<button className="button full" disabled={mutation.isPending}>{mutation.isPending ? "발급하는 중…" : "초대 코드 발급"}</button></form></Sheet>;
}

function UserSuspensionSheet({ user, onClose, onSaved }: { user: AdminUser; onClose: () => void; onSaved: () => void }) {
  const restoring = Boolean(user.suspendedAt);
  const [reason, setReason] = useState("");
  const mutation = useMutation({ mutationFn: () => apiFetch(`/admin/users/${user.id}/suspension`, { method: "PATCH", body: JSON.stringify({ suspended: !restoring, reason: restoring ? undefined : reason.trim() }) }), onSuccess: onSaved });
  return <Sheet title={restoring ? "사용자 정지 해제" : "사용자 이용 정지"} onClose={onClose}><form className="composer-form" onSubmit={(event) => { event.preventDefault(); mutation.mutate(); }}><div className="admin-target-summary"><span className="avatar">{user.nickname.slice(0, 1)}</span><div><b>{user.nickname}</b><small>@{user.handle} · {user.email}</small></div></div>{restoring ? <p className="admin-action-note">정지를 해제하면 사용자가 다시 로그인할 수 있어요.</p> : <label className="field"><span>정지 사유</span><textarea value={reason} onChange={(event) => setReason(event.target.value)} minLength={3} maxLength={300} required placeholder="사용자에게 전달할 구체적인 사유를 적어주세요." /></label>}{mutation.isError && <p className="form-error">{mutation.error instanceof Error ? mutation.error.message : "사용자 상태를 변경하지 못했어요."}</p>}<button className={`button full ${restoring ? "" : "danger-button"}`} disabled={mutation.isPending || (!restoring && reason.trim().length < 3)}>{mutation.isPending ? "처리 중…" : restoring ? "정지 해제" : "모든 세션 종료 후 정지"}</button></form></Sheet>;
}

function ModerationSection() {
  const client = useQueryClient();
  const [contentType, setContentType] = useState<"POST" | "COMMENT">("POST");
  const [contentStatus, setContentStatus] = useState<"ALL" | "VISIBLE" | "HIDDEN">("ALL");
  const [contentQuery, setContentQuery] = useState("");
  const [submittedContentQuery, setSubmittedContentQuery] = useState("");
  const [visibilityTarget, setVisibilityTarget] = useState<AdminContent | null>(null);
  const [checkInVisibilityTarget, setCheckInVisibilityTarget] = useState<AdminReport | null>(null);
  const [messageContextReport, setMessageContextReport] = useState<AdminReport | null>(null);
  const reports = useQuery({ queryKey: ["admin", "reports"], queryFn: () => apiFetch<{ items: AdminReport[] }>("/admin/reports") });
  const content = useQuery({ queryKey: ["admin", "content", contentType, contentStatus, submittedContentQuery], queryFn: () => apiFetch<{ items: AdminContent[] }>(`/admin/content?limit=50&type=${contentType}&status=${contentStatus}${submittedContentQuery ? `&query=${encodeURIComponent(submittedContentQuery)}` : ""}`) });
  const updateReport = useMutation({ mutationFn: ({ id, nextStatus }: { id: string; nextStatus: string }) => apiFetch(`/admin/reports/${id}`, { method: "PATCH", body: JSON.stringify({ status: nextStatus, resolution: `운영자 상태 변경: ${nextStatus}` }) }), onSuccess: () => { void Promise.all([client.invalidateQueries({ queryKey: ["admin", "reports"] }), client.invalidateQueries({ queryKey: ["admin", "overview"] }), client.invalidateQueries({ queryKey: ["admin", "audit"] })]); } });
  return <section className="admin-section">
    <div className="section-heading"><div><h2>신고 처리</h2><span>대상 내용을 확인하고 처리 상태를 남겨요</span></div></div>
    {reports.isLoading ? <PageLoading /> : reports.isError ? <ErrorState message="신고를 불러오지 못했어요." onRetry={() => reports.refetch()} /> : !reports.data?.items.length ? <EmptyState title="처리할 신고가 없어요" body="새로운 신고가 접수되면 여기에 나타나요." /> : <div className="report-list">{reports.data.items.map((report) => <article className="surface-card report-card" key={report.id}><div className="report-card-head"><span className={`status-pill status-${report.status.toLowerCase()}`}>{reportStatusLabel(report.status)}</span><time>{new Date(report.createdAt).toLocaleString("ko-KR")}</time></div><h2>{targetLabel(report.targetType)} · {report.reason}</h2>{report.targetMediaUrl && <Image className="reported-checkin-image" src={report.targetMediaUrl} width={360} height={240} alt="신고된 챌린지 인증 사진" unoptimized />}<p>{report.targetPreview || "대상 미리보기가 없어요."}</p><small>@{report.reporter.handle} 님이 신고 · 대상 {report.targetId}</small>{report.targetHidden && <em className="moderation-note">현재 숨김 처리됨</em>}<div className="report-actions">{report.targetType === "MESSAGE" && <button onClick={() => setMessageContextReport(report)}><MessageCircleReply /> 앞뒤 대화 확인</button>}{report.targetType === "CHALLENGE_CHECK_IN" && <button onClick={() => setCheckInVisibilityTarget(report)} disabled={report.targetHidden}><Ban /> 사진 숨김</button>}<button onClick={() => updateReport.mutate({ id: report.id, nextStatus: "REVIEWING" })} disabled={updateReport.isPending}><Eye /> 검토</button><button onClick={() => updateReport.mutate({ id: report.id, nextStatus: "RESOLVED" })} disabled={updateReport.isPending}><CheckCircle2 /> 처리</button><button onClick={() => updateReport.mutate({ id: report.id, nextStatus: "DISMISSED" })} disabled={updateReport.isPending}><XCircle /> 기각</button></div></article>)}</div>}
    <div className="section-heading"><div><h2>콘텐츠 관리</h2><span>최근 게시물과 댓글을 직접 찾아 숨김·복구해요</span></div></div>
    <div className="admin-filter-row" aria-label="콘텐츠 유형">{(["POST", "COMMENT"] as const).map((value) => <button type="button" key={value} aria-pressed={contentType === value} className={contentType === value ? "active" : ""} onClick={() => setContentType(value)}>{value === "POST" ? "게시물" : "댓글"}</button>)}</div>
    <form className="admin-search" onSubmit={(event) => { event.preventDefault(); setSubmittedContentQuery(contentQuery.trim()); }}><label><span>콘텐츠 검색</span><div><Search /><input value={contentQuery} onChange={(event) => setContentQuery(event.target.value)} placeholder="본문 또는 작성자 아이디" /><button>검색</button></div></label></form>
    <div className="admin-filter-row compact" aria-label="노출 상태">{(["ALL", "VISIBLE", "HIDDEN"] as const).map((value) => <button type="button" key={value} aria-pressed={contentStatus === value} className={contentStatus === value ? "active" : ""} onClick={() => setContentStatus(value)}>{value === "ALL" ? "전체" : value === "VISIBLE" ? "노출 중" : "숨김"}</button>)}</div>
    {content.isLoading ? <PageLoading /> : content.isError ? <ErrorState message="콘텐츠를 불러오지 못했어요." onRetry={() => content.refetch()} /> : !content.data?.items.length ? <EmptyState title="조건에 맞는 콘텐츠가 없어요" body="검색어나 노출 상태를 바꿔보세요." /> : <div className="admin-content-list">{content.data.items.map((item) => <article className="surface-card" key={item.id}><div className="content-admin-head"><span className={`status-pill ${item.hiddenAt ? "status-dismissed" : "status-resolved"}`}>{item.hiddenAt ? "숨김" : "노출 중"}</span><small>신고 {item.reportCount}건</small></div><b>{item.preview}</b><p>{item.context || "연결 정보 없음"}</p><small>@{item.author.handle} · {new Date(item.createdAt).toLocaleString("ko-KR")}</small><div><Link href={item.type === "POST" ? `/posts/${item.id}` : `/posts/${item.contextId}`}><Link2 /> 원문</Link><button className={item.hiddenAt ? "restore" : "danger"} onClick={() => setVisibilityTarget(item)}>{item.hiddenAt ? <><RotateCcw /> 복구</> : <><Ban /> 숨김</>}</button></div></article>)}</div>}
    {visibilityTarget && <ContentVisibilitySheet item={visibilityTarget} onClose={() => setVisibilityTarget(null)} onSaved={() => { setVisibilityTarget(null); void Promise.all([client.invalidateQueries({ queryKey: ["admin", "content"] }), client.invalidateQueries({ queryKey: ["admin", "reports"] }), client.invalidateQueries({ queryKey: ["admin", "audit"] })]); }} />}
    {checkInVisibilityTarget && <CheckInVisibilitySheet report={checkInVisibilityTarget} onClose={() => setCheckInVisibilityTarget(null)} onSaved={() => { setCheckInVisibilityTarget(null); void Promise.all([client.invalidateQueries({ queryKey: ["admin", "reports"] }), client.invalidateQueries({ queryKey: ["admin", "challenge-verifications"] }), client.invalidateQueries({ queryKey: ["admin", "overview"] }), client.invalidateQueries({ queryKey: ["admin", "audit"] })]); }} />}
    {messageContextReport && <MessageReportContextSheet report={messageContextReport} onClose={() => setMessageContextReport(null)} onSaved={() => { setMessageContextReport(null); void Promise.all([client.invalidateQueries({ queryKey: ["admin", "reports"] }), client.invalidateQueries({ queryKey: ["admin", "audit"] })]); }} />}
  </section>;
}

function MessageReportContextSheet({ report, onClose, onSaved }: { report: AdminReport; onClose: () => void; onSaved: () => void }) {
  const [reason, setReason] = useState(report.reason);
  const query = useQuery({ queryKey: ["admin", "message-context", report.id], queryFn: () => apiFetch<MessageReportContext>(`/admin/reports/${report.id}/message-context`) });
  const target = query.data?.items.find((item) => item.id === query.data?.targetMessageId);
  const restoring = Boolean(target?.hiddenAt);
  const mutation = useMutation({ mutationFn: () => apiFetch(`/admin/chat/messages/${report.targetId}/visibility`, { method: "PATCH", body: JSON.stringify({ hidden: !restoring, reason: reason.trim() }) }), onSuccess: onSaved });
  return <Sheet title="신고 메시지 확인" onClose={onClose}>{query.isLoading ? <PageLoading /> : query.isError || !query.data ? <ErrorState message="신고 주변 대화를 불러오지 못했어요." onRetry={() => query.refetch()} /> : <div className="message-audit-sheet"><p className="admin-action-note">개인 대화방 전체가 아니라 신고 메시지와 앞뒤 3개 메시지만 보여요.</p><div className="message-audit-context">{query.data.items.map((item) => <article className={item.id === query.data.targetMessageId ? "target" : ""} key={item.id}><div><b>{item.sender?.nickname ?? "시스템"}</b><time>{new Date(item.createdAt).toLocaleString("ko-KR")}</time></div><p>{item.deletedAt ? "삭제된 메시지예요." : item.hiddenAt ? "숨김 처리된 메시지예요." : item.body || "사진 메시지"}</p>{item.media.length > 0 && <div>{item.media.map((media) => <Image src={media.thumbnailUrl || media.url} alt="신고 맥락의 첨부 사진" width={120} height={120} key={media.id} unoptimized />)}</div>}</article>)}</div>{query.data.revisions.length > 0 && <details className="message-audit-revisions"><summary>신고 메시지 수정 이력 {query.data.revisions.length}개</summary>{query.data.revisions.map((item) => <p key={item.id}>{item.body || "내용 없음"} <time>{new Date(item.createdAt).toLocaleString("ko-KR")}</time></p>)}</details>}<label className="field"><span>{restoring ? "복구 사유" : "숨김 사유"}</span><textarea value={reason} onChange={(event) => setReason(event.target.value)} minLength={3} maxLength={300} required /></label>{mutation.isError && <p className="form-error">{mutation.error instanceof Error ? mutation.error.message : "메시지 상태를 바꾸지 못했어요."}</p>}<button className={`button full ${restoring ? "" : "danger-button"}`} disabled={mutation.isPending || reason.trim().length < 3} onClick={() => mutation.mutate()}>{mutation.isPending ? "처리 중…" : restoring ? "메시지 복구" : "작성자에게 알리고 숨김"}</button></div>}</Sheet>;
}

function ContentVisibilitySheet({ item, onClose, onSaved }: { item: AdminContent; onClose: () => void; onSaved: () => void }) {
  const restoring = Boolean(item.hiddenAt);
  const [reason, setReason] = useState("");
  const mutation = useMutation({ mutationFn: () => apiFetch(`/admin/content/${item.type}/${item.id}/visibility`, { method: "PATCH", body: JSON.stringify({ hidden: !restoring, reason: restoring ? undefined : reason.trim() }) }), onSuccess: onSaved });
  return <Sheet title={restoring ? "콘텐츠 복구" : "콘텐츠 숨김"} onClose={onClose}><form className="composer-form" onSubmit={(event) => { event.preventDefault(); mutation.mutate(); }}><blockquote className="admin-content-preview">{item.preview}</blockquote>{restoring ? <p className="admin-action-note">복구하면 공개 범위에 따라 사용자 화면에 다시 나타나요.</p> : <label className="field"><span>숨김 사유</span><textarea value={reason} onChange={(event) => setReason(event.target.value)} minLength={3} maxLength={300} required placeholder="작성자에게 전달할 구체적인 사유를 적어주세요." /></label>}{mutation.isError && <p className="form-error">{mutation.error instanceof Error ? mutation.error.message : "콘텐츠 상태를 변경하지 못했어요."}</p>}<button className={`button full ${restoring ? "" : "danger-button"}`} disabled={mutation.isPending || (!restoring && reason.trim().length < 3)}>{mutation.isPending ? "처리 중…" : restoring ? "콘텐츠 복구" : "작성자에게 알리고 숨김"}</button></form></Sheet>;
}

function CheckInVisibilitySheet({ report, onClose, onSaved }: { report: AdminReport; onClose: () => void; onSaved: () => void }) {
  const [reason, setReason] = useState(report.reason);
  const mutation = useMutation({ mutationFn: () => apiFetch(`/admin/challenge-check-ins/${report.targetId}/visibility`, { method: "PATCH", body: JSON.stringify({ hidden: true, reason: reason.trim() }) }), onSuccess: onSaved });
  return <Sheet title="인증 사진 숨김" onClose={onClose}><form className="composer-form" onSubmit={(event) => { event.preventDefault(); mutation.mutate(); }}>{report.targetMediaUrl && <Image className="reported-checkin-image large" src={report.targetMediaUrl} width={420} height={320} alt="숨김 처리할 챌린지 인증 사진" unoptimized />}<p className="admin-action-note">사진을 숨기면 투표 대상에서 즉시 제외되고 작성자에게 사유가 전달돼요. 이 작업은 인증 통과·실패를 운영자가 판단하는 기능이 아니에요.</p><label className="field"><span>숨김 사유</span><textarea value={reason} onChange={(event) => setReason(event.target.value)} minLength={3} maxLength={300} required /></label>{mutation.isError && <p className="form-error">{mutation.error instanceof Error ? mutation.error.message : "사진을 숨기지 못했어요."}</p>}<button className="button full danger-button" disabled={mutation.isPending || reason.trim().length < 3}>{mutation.isPending ? "숨기는 중…" : "작성자에게 알리고 사진 숨김"}</button></form></Sheet>;
}

function ChallengeOperationsSection() {
  const client = useQueryClient();
  const [selectedChallenge, setSelectedChallenge] = useState("");
  const [creatingOfficial, setCreatingOfficial] = useState(false);
  const challenges = useQuery({ queryKey: ["admin", "official-challenges"], queryFn: () => apiFetch<Challenge[]>("/challenges") });
  const official = challenges.data?.filter((item) => item.kind === "OFFICIAL") ?? [];
  const challengeId = selectedChallenge || official[0]?.id || "";
  const participants = useQuery({ queryKey: ["admin", "challenge-participants", challengeId], queryFn: () => apiFetch<{ items: RewardParticipant[] }>(`/admin/challenges/${challengeId}/participants`), enabled: Boolean(challengeId) });
  const verification = useQuery({ queryKey: ["admin", "challenge-verifications"], queryFn: () => apiFetch<VerificationOverview>("/admin/challenge-verifications") });
  const reward = useMutation({ mutationFn: ({ userId, nextStatus }: { userId: string; nextStatus: string }) => apiFetch(`/admin/challenges/${challengeId}/participants/${userId}/reward`, { method: "PATCH", body: JSON.stringify({ status: nextStatus }) }), onSuccess: () => { void Promise.all([client.invalidateQueries({ queryKey: ["admin", "challenge-participants", challengeId] }), client.invalidateQueries({ queryKey: ["admin", "audit"] })]); } });
  return <section className="admin-section reward-admin">
    <div className="section-heading spaced"><div><h2>공식 챌린지 운영</h2><span>사진 판정은 참여자가 하고 운영자는 흐름과 보상만 관리해요</span></div><button className="section-action" onClick={() => setCreatingOfficial(true)}><Plus /> 만들기</button></div>
    <div className="section-heading"><div><h2>참여자 사진 인증 현황</h2><span>운영자는 개별 인증을 승인하거나 반려할 수 없어요</span></div><Camera /></div>
    {verification.isLoading ? <PageLoading /> : verification.isError || !verification.data ? <ErrorState message="사진 인증 현황을 불러오지 못했어요." onRetry={() => verification.refetch()} /> : <><div className="admin-metric-grid compact"><article className="tone-lilac"><Clock3 /><span>판정 대기</span><strong>{verification.data.pending}</strong><small>12시간 초과 {verification.data.delayed}건</small></article><article className="tone-mint"><CheckCircle2 /><span>24시간 통과</span><strong>{verification.data.approved24h}</strong><small>자동 판정</small></article><article className="tone-pink"><RotateCcw /><span>24시간 재요청</span><strong>{verification.data.rejected24h}</strong><small>재제출 가능</small></article></div>{verification.data.insufficientPools.length > 0 && <div className="verification-pool-warning"><ShieldAlert /><div><b>참여 인원이 부족한 챌린지</b>{verification.data.insufficientPools.map((item) => <small key={item.id}>{item.title} · {item.participantCount}/{item.required}명</small>)}</div></div>}<div className="verification-monitor-list">{verification.data.items.length ? verification.data.items.map((item) => <article className="surface-card" key={item.id}><div><b>{item.challenge.title}</b><small>익명 인증 · {item.challenge._count.participants}명 풀 · {item.attempt}차 시도</small></div><span>{item.validVotes}/{item.reviewSize}명</span><small>판단 보류 {item.unsureVotes} · {new Date(item.submittedAt).toLocaleString("ko-KR")} 접수</small></article>) : <div className="inline-empty">판정을 기다리는 인증이 없어요.</div>}</div></>}
    {challenges.isLoading ? <PageLoading /> : challenges.isError ? <ErrorState message="챌린지를 불러오지 못했어요." onRetry={() => challenges.refetch()} /> : !official.length ? <EmptyState title="공식 챌린지가 없어요" body="첫 공식 챌린지를 만들어보세요." /> : <><fieldset className="admin-challenge-picker"><legend>보상을 운영할 공식 챌린지</legend><div role="listbox" aria-label="공식 챌린지 선택">{official.map((item) => <button type="button" role="option" aria-selected={challengeId === item.id} className={challengeId === item.id ? "selected" : ""} key={item.id} onClick={() => setSelectedChallenge(item.id)}><Trophy /><span><b>{item.title}</b><small>{item._count.participants}명 참여</small></span></button>)}</div></fieldset><div className="section-heading"><div><h2>완주·보상 상태</h2><span>통과한 인증의 완주율을 기준으로 대상자가 자동 분류돼요</span></div></div>{participants.isLoading ? <PageLoading /> : participants.isError ? <ErrorState message="참여자 보상 정보를 불러오지 못했어요." onRetry={() => participants.refetch()} /> : !participants.data?.items.length ? <div className="inline-empty">참여자가 아직 없어요.</div> : <div className="reward-list">{participants.data.items.map((item) => <article className="surface-card" key={item.userId}><div><b>{item.user.nickname}</b><small>@{item.user.handle} · {item.checkInCount}회 인증</small></div><span className={`status-pill status-${item.rewardStatus.toLowerCase()}`}>{item.rewardStatus}</span><div className="report-actions"><button onClick={() => reward.mutate({ userId: item.userId, nextStatus: "REVIEWING" })}>검수</button><button onClick={() => reward.mutate({ userId: item.userId, nextStatus: "APPROVED" })}>승인</button><button onClick={() => reward.mutate({ userId: item.userId, nextStatus: "PAID" })}>지급</button></div></article>)}</div>}</>}
    {creatingOfficial && <ChallengeComposer kind="OFFICIAL" onClose={() => setCreatingOfficial(false)} onSaved={() => { setCreatingOfficial(false); void client.invalidateQueries({ queryKey: ["admin", "official-challenges"] }); }} />}
  </section>;
}

function AuditSection() {
  const query = useQuery({ queryKey: ["admin", "audit"], queryFn: () => apiFetch<{ items: AdminAuditLog[] }>("/admin/audit-logs?limit=50") });
  return <section className="admin-section"><div className="section-heading"><div><h2>관리자 행동 기록</h2><span>누가 언제 무엇을 바꿨는지 확인해요</span></div><History /></div>{query.isLoading ? <PageLoading /> : query.isError ? <ErrorState message="관리자 기록을 불러오지 못했어요." onRetry={() => query.refetch()} /> : !query.data?.items.length ? <EmptyState title="아직 운영 기록이 없어요" body="초대 코드 발급이나 신고 처리부터 기록돼요." /> : <div className="audit-log-list">{query.data.items.map((item) => <article className="surface-card" key={item.id}><span><History /></span><div><b>{auditActionLabel(item.action)}</b><p>{item.summary || `${item.targetType} · ${item.targetId}`}</p><small>@{item.admin.handle} · {new Date(item.createdAt).toLocaleString("ko-KR")}</small></div></article>)}</div>}</section>;
}

function inviteStateLabel(value: AdminInviteCode["state"]) { return ({ ACTIVE: "사용 가능", DISABLED: "중지", EXPIRED: "만료", EXHAUSTED: "소진" } as const)[value]; }
function reportStatusLabel(value: AdminReport["status"]) { return ({ OPEN: "접수", REVIEWING: "검토 중", RESOLVED: "처리", DISMISSED: "기각" } as const)[value]; }
function targetLabel(value: AdminReport["targetType"]) { return ({ USER: "사용자", POST: "게시물", COMMENT: "댓글", MESSAGE: "메시지", CHALLENGE: "챌린지", CHALLENGE_CHECK_IN: "챌린지 인증 사진" } as const)[value]; }
function auditActionLabel(value: string) { return ({ INVITE_CODE_CREATED: "초대 코드 발급", INVITE_CODE_DISABLED: "초대 코드 중지", INVITE_CODE_ENABLED: "초대 코드 활성화", USER_SUSPENDED: "사용자 정지", USER_RESTORED: "사용자 정지 해제", CONTENT_HIDDEN: "콘텐츠 숨김", CONTENT_RESTORED: "콘텐츠 복구", REPORT_STATUS_UPDATED: "신고 상태 변경", CHALLENGE_CHECK_IN_REVIEWED: "과거 챌린지 인증 검수", CHALLENGE_CHECK_IN_HIDDEN: "챌린지 인증 사진 숨김", CHALLENGE_CHECK_IN_RESTORED: "챌린지 인증 사진 복구", CHALLENGE_REWARD_UPDATED: "챌린지 보상 변경", CHAT_MESSAGE_HIDDEN: "대화방 메시지 숨김", CHAT_MESSAGE_RESTORED: "대화방 메시지 복구", CHAT_MEMBER_MUTED: "대화방 참여자 채팅 제한", CHAT_MEMBER_UNMUTED: "대화방 참여자 제한 해제" } as Record<string, string>)[value] ?? value; }
