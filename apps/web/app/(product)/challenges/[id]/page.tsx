"use client";

import { FormEvent, useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, CalendarCheck, Camera, Check, CheckCircle2, ChevronLeft, ChevronRight, CircleHelp, Clock3, Expand, Flag, Medal, MessageCircleMore, Pencil, RefreshCw, ShieldCheck, Trash2, Trophy, Users, UsersRound, XCircle } from "lucide-react";
import Link from "next/link";
import Image from "next/image";
import { useParams, useRouter } from "next/navigation";
import { useSession } from "@/components/app-providers";
import { ReportSheet } from "@/components/report-sheet";
import { Sheet } from "@/components/sheet";
import { ConfirmSheet } from "@/components/confirm-sheet";
import { ChallengeComposer } from "@/components/challenge-composer";
import { EmptyState, ErrorState, PageLoading } from "@/components/states";
import { apiFetch, uploadImage, userErrorMessage } from "@/lib/api";
import type { Challenge, ChallengeLeaderboard, ChallengeVerificationQueue } from "@/lib/types";

export default function ChallengeDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { status, user } = useSession();
  const queryClient = useQueryClient();
  const [checking, setChecking] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [retrying, setRetrying] = useState<string | null>(null);
  const [reporting, setReporting] = useState(false);
  const [editing, setEditing] = useState(false);
  const [confirmingLeave, setConfirmingLeave] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [notice, setNotice] = useState("");
  const [now] = useState(Date.now);
  const endpoint = status === "authenticated" ? `/challenges/${id}` : `/public/challenges/${id}`;
  const query = useQuery({ queryKey: ["challenge", id, status], queryFn: () => apiFetch<Challenge>(endpoint), enabled: Boolean(id) && status !== "loading" });
  const leaderboardEndpoint = status === "authenticated" ? `/challenges/${id}/leaderboard` : `/public/challenges/${id}/leaderboard`;
  const leaderboard = useQuery({ queryKey: ["challenge", id, "leaderboard", status], queryFn: () => apiFetch<ChallengeLeaderboard>(leaderboardEndpoint), enabled: Boolean(id) && status !== "loading" });
  const refresh = async () => { await Promise.all([queryClient.invalidateQueries({ queryKey: ["challenge", id] }), queryClient.invalidateQueries({ queryKey: ["challenges"] }), queryClient.invalidateQueries({ queryKey: ["challenge", id, "leaderboard"] })]); };
  const join = useMutation({ mutationFn: () => apiFetch(`/challenges/${id}/join`, { method: "POST" }), onSuccess: async () => { setNotice("오늘부터 함께해요!"); await refresh(); }, onError: (cause) => setNotice(userErrorMessage(cause, "챌린지에 참여하지 못했어요.")) });
  const leave = useMutation({ mutationFn: () => apiFetch(`/challenges/${id}/join`, { method: "DELETE" }), onSuccess: async () => { setConfirmingLeave(false); setNotice("참여를 취소했어요."); await refresh(); } });
  const remove = useMutation({ mutationFn: () => apiFetch(`/challenges/${id}`, { method: "DELETE" }), onSuccess: () => router.replace("/challenges") });
  const reverify = useMutation({ mutationFn: (checkInId: string) => apiFetch(`/challenge-verifications/check-ins/${checkInId}/reverify`, { method: "POST" }), onSuccess: async () => { setNotice("같은 사진으로 더 많은 참여자에게 다시 확인을 요청했어요."); await refresh(); }, onError: (cause) => setNotice(cause instanceof Error ? cause.message : "재검증을 요청하지 못했어요.") });

  if (query.isLoading || status === "loading") return <main className="app-page"><PageLoading /></main>;
  if (query.isError || !query.data) return <main className="app-page"><ErrorState message="챌린지를 불러오지 못했어요." onRetry={() => query.refetch()} /></main>;
  const challenge = query.data;
  const totalDays = Math.max(1, Math.ceil((new Date(challenge.endsAt).getTime() - new Date(challenge.startsAt).getTime()) / 86_400_000));
  const authAction = (action: () => void) => status === "authenticated" ? action() : router.push(`/start?returnTo=${encodeURIComponent(`/challenges/${id}`)}`);
  const canManage = status === "authenticated" && Boolean(user && (challenge.creator?.id === user.id || user.role === "ADMIN" || user.role === "MODERATOR"));
  const verificationReady = challenge.verificationMode === "CHECK" || challenge._count.participants >= (challenge.minimumParticipants ?? 8);
  const hasStarted = new Date(challenge.startsAt).getTime() <= now;
  const hasEnded = Boolean(challenge.endedAt) || new Date(challenge.endsAt).getTime() < now;

  return (
    <main className="app-page challenge-detail-page">
      <header className="detail-toolbar"><Link href="/challenges" className="icon-button" aria-label="챌린지 목록"><ArrowLeft /></Link><div>{canManage ? !hasEnded && <><button className="icon-button" aria-label="챌린지 편집" onClick={() => setEditing(true)}><Pencil /></button><button className="icon-button danger" aria-label="챌린지 종료" onClick={() => setConfirmingDelete(true)}><Trash2 /></button></> : <button className="icon-button" aria-label="신고" onClick={() => authAction(() => setReporting(true))}><Flag /></button>}</div></header>
      <section className={`challenge-detail-hero ${challenge.kind.toLowerCase()}`}>
        <span>{challenge.kind === "OFFICIAL" ? <><ShieldCheck /> 공식 챌린지</> : "커뮤니티 챌린지"}</span>
        <h1>{challenge.title}</h1><p>{challenge.description}</p>
        <div><span><Users />{challenge._count.participants.toLocaleString()}명</span><span><CalendarCheck />{totalDays}일</span><span>{challenge.verificationMode === "CHECK" ? <Check /> : <Camera />}{challenge.verificationMode === "CHECK" ? "간편 체크" : "참여자 사진 인증"}</span><span><Trophy />완주 {challenge.completionThreshold ?? 80}%</span></div>
      </section>
      {(challenge.rewardLabel || challenge.rewardTerms || challenge.titleAwarded || challenge.firstPlaceTitle || challenge.secondPlaceTitle || challenge.thirdPlaceTitle) && <section className="challenge-reward-card surface-card"><Trophy aria-hidden /><div><b>{challenge.titleAwarded || challenge.rewardLabel || "완주 칭호"}</b>{challenge.rewardTerms && <p>{challenge.rewardTerms}</p>}{challenge.kind === "COMMUNITY" && !challenge.titleAwarded && <p className="challenge-title-preview">{[challenge.firstPlaceTitle, challenge.secondPlaceTitle, challenge.thirdPlaceTitle].filter(Boolean).map((title, index) => <span key={title}>{index + 1}위 · {title}</span>)}</p>}{challenge.myRewardStatus && <small>내 보상 상태 · {rewardLabel(challenge.myRewardStatus, challenge.kind)}</small>}</div></section>}
      {notice && <button className="notice" onClick={() => setNotice("")}>{notice}</button>}
      {challenge.joined ? (
        <>
          <section className="challenge-my-progress surface-card"><div><span>나의 성공률</span><strong>{challenge.successRate ?? 0}%</strong><small>{challenge.myCheckInCount ?? 0}일 인증했어요</small></div><div className="progress-ring" style={{ "--progress": `${challenge.successRate ?? 0}%` } as React.CSSProperties}><i><Check /></i></div></section>
          {hasEnded ? <ChallengeStateCard title="종료된 챌린지예요" body="인증은 끝났지만 나의 기록과 참여자 대화는 보관 기간 동안 다시 볼 수 있어요." /> : !hasStarted ? <ChallengeStateCard title="아직 시작 전이에요" body={`${new Date(challenge.startsAt).toLocaleDateString("ko-KR")}부터 인증할 수 있어요.`} /> : <div className="challenge-action-stack">
            {!challenge.chatReadOnly && <button className="button full" disabled={challenge.todayCheckedIn || !verificationReady} onClick={() => setChecking(true)}>{challenge.todayCheckedIn ? <><Check /> 오늘 인증 완료</> : !verificationReady ? <><Users /> 참여자 {challenge.minimumParticipants ?? 8}명을 기다리는 중</> : <><Camera /> 오늘 인증하기</>}</button>}
            {!verificationReady && <p className="form-help">사진 인증과 익명 투표는 확인할 사람이 충분히 모인 뒤 시작해요.</p>}
            {challenge.verificationMode === "PEER_PHOTO" && verificationReady && <button className="secondary-button full" onClick={() => setReviewing(true)}><UsersRound /> 다른 참여자의 사진 인증 도와주기</button>}
          </div>}
          <Link className="challenge-chat-entry" href={`/challenges/${challenge.id}/chat`}><span><MessageCircleMore /><span><b>참여자 대화방</b><small>{challenge.chatReadOnly ? "종료된 대화를 다시 볼 수 있어요" : "팁과 경험을 함께 나눠보세요"}</small></span></span><em>{challenge.chatUnreadCount ? `${challenge.chatUnreadCount}개 새 메시지` : challenge.chatReadOnly ? "읽기 전용" : "대화하기"}</em></Link>
          <div className="section-heading"><div><h2>나의 인증 기록</h2><span>작은 실천이 쌓인 날들이에요</span></div></div>
          {!challenge.checkIns?.length ? <EmptyState title="아직 인증 기록이 없어요" body="오늘 첫 인증을 남겨보세요." /> : <div className="checkin-history">{challenge.checkIns.map((item) => <article key={item.id}>{item.mediaUrl ? <Image src={item.mediaUrl} alt="" width={52} height={52} unoptimized /> : <span>{item.status === "REJECTED" ? <XCircle /> : item.status === "PENDING" ? <Clock3 /> : <Check />}</span>}<div><b>{new Date(item.checkInDate).toLocaleDateString("ko-KR")}</b><p>{item.note || "오늘의 약속을 지켰어요."}</p><small className={`checkin-status status-${(item.status ?? "APPROVED").toLowerCase()}`}>{item.status === "PENDING" ? `참여자 확인 중 · ${item.validVotes ?? 0}/${item.reviewSize ?? 5}명` : item.status === "REJECTED" ? `다시 올려주세요 · ${item.reviewNote || "사진 인증 기준을 확인해주세요."}` : "인증 통과"}</small>{item.status === "REJECTED" && item.retryUntil && new Date(item.retryUntil) > new Date() && (item.attempt ?? 1) < 3 && <div className="checkin-retry-actions"><button type="button" onClick={() => setRetrying(item.id)}><Camera /> 새 사진 올리기</button>{!item.reverifyUsed && <button type="button" disabled={reverify.isPending} onClick={() => reverify.mutate(item.id)}><RefreshCw /> 같은 사진 재검증</button>}<small>{new Date(item.retryUntil).toLocaleString("ko-KR")}까지 · 오늘 최대 3회</small></div>}</div></article>)}</div>}
          {!hasEnded && <button className="danger-link subtle" disabled={leave.isPending} onClick={() => setConfirmingLeave(true)}>챌린지 참여 취소</button>}
        </>
      ) : (
        hasEnded ? <ChallengeStateCard title="종료된 챌린지예요" body="더 이상 참여하거나 인증할 수 없어요. 공개된 기록은 계속 둘러볼 수 있어요." /> : !hasStarted ? <ChallengeStateCard title="참여 접수 전이에요" body={`${new Date(challenge.startsAt).toLocaleDateString("ko-KR")}에 시작하면 참여할 수 있어요.`} /> : <section className="join-challenge-card surface-card"><Trophy /><h2>오늘부터 같이 시작할까요?</h2><p>참여 후 매일 한 번 인증할 수 있어요. 기간 안에는 언제든 참여를 취소할 수 있어요.</p><button className="button full" disabled={join.isPending} onClick={() => authAction(() => join.mutate())}>{join.isPending ? "참여 중…" : "챌린지 시작하기"}</button></section>
      )}
      <section className="challenge-leaderboard"><div className="section-heading"><div><h2>함께 쌓은 기록</h2><span>{leaderboard.data?.myRank ? `현재 내 순위 ${leaderboard.data.myRank}위` : "승인된 인증을 기준으로 보여줘요"}</span></div><Medal /></div>{leaderboard.isLoading ? <PageLoading /> : leaderboard.isError ? <ErrorState message="순위를 불러오지 못했어요." onRetry={() => leaderboard.refetch()} /> : !leaderboard.data?.items.length ? <EmptyState title="아직 순위가 없어요" body="첫 인증이 승인되면 기록이 시작돼요." /> : <div className="leaderboard-list">{leaderboard.data.items.slice(0, 10).map((item) => <article key={item.userId} className={item.userId === user?.id ? "mine" : ""}><strong>{item.rank}</strong><span className="avatar">{item.user.nickname.slice(0, 1)}</span><div><b>{item.user.nickname}</b><small>{item.approvedCheckIns}회 인증 · 성공률 {item.successRate}%</small></div>{item.titleAwarded && <em>{item.titleAwarded}</em>}</article>)}</div>}</section>
      {checking && <CheckInSheet challenge={challenge} onClose={() => setChecking(false)} onDone={async () => { setNotice("오늘의 인증을 남겼어요."); await refresh(); }} />}
      {retrying && <CheckInSheet challenge={challenge} retryCheckInId={retrying} onClose={() => setRetrying(null)} onDone={async () => { setNotice("새 사진으로 다시 확인을 요청했어요."); await refresh(); }} />}
      {reviewing && <VerificationQueueSheet challengeId={challenge.id} onClose={() => setReviewing(false)} onDone={(count) => setNotice(`사진 인증을 도왔어요. 지금까지 ${count}회 기여했어요.`)} />}
      {reporting && <ReportSheet targetType="CHALLENGE" targetId={id} onClose={() => setReporting(false)} onReported={() => setNotice("신고가 접수됐어요.")} />}
      {editing && <ChallengeComposer challenge={challenge} onClose={() => setEditing(false)} onSaved={() => { setNotice("챌린지를 수정했어요."); void refresh(); }} />}
      {confirmingLeave && <ConfirmSheet title="챌린지 참여를 취소할까요?" body="참여를 취소하면 이 챌린지의 인증 기록도 함께 삭제되고 되돌릴 수 없어요." confirmLabel="참여와 인증 기록 삭제" danger busy={leave.isPending} error={leave.isError ? userErrorMessage(leave.error, "참여를 취소하지 못했어요.") : ""} onClose={() => setConfirmingLeave(false)} onConfirm={() => leave.mutate()} />}
      {confirmingDelete && <ConfirmSheet title="챌린지를 종료할까요?" body="목록에서 즉시 숨겨지고 참여자에게 종료 알림이 전송돼요. 이미 차감된 포인트는 반환되지 않아요." confirmLabel="챌린지 종료" danger busy={remove.isPending} error={remove.isError ? userErrorMessage(remove.error, "챌린지를 종료하지 못했어요.") : ""} onClose={() => setConfirmingDelete(false)} onConfirm={() => remove.mutate()} />}
    </main>
  );
}

function ChallengeStateCard({ title, body }: { title: string; body: string }) {
  return <section className="challenge-state-card surface-card" role="status"><Clock3 aria-hidden /><div><h2>{title}</h2><p>{body}</p></div></section>;
}

function rewardLabel(status: string, kind: Challenge["kind"]) {
  if (kind === "COMMUNITY" && status === "APPROVED") return "완주 확정";
  return ({ NOT_ELIGIBLE: "완주 조건 확인 중", ELIGIBLE: "보상 대상", REVIEWING: "검수 중", APPROVED: "지급 승인", REJECTED: "지급 제외", PAID: "지급 완료" } as Record<string, string>)[status] ?? status;
}

function CheckInSheet({ challenge, retryCheckInId, onClose, onDone }: { challenge: Challenge; retryCheckInId?: string; onClose: () => void; onDone: () => Promise<void> }) {
  const [note, setNote] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [progress, setProgress] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [uploadedMediaId, setUploadedMediaId] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState("");
  const [discardOpen, setDiscardOpen] = useState(false);
  const photoRequired = challenge.verificationMode === "PEER_PHOTO" || Boolean(retryCheckInId);
  useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl); }, [previewUrl]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (photoRequired && !file) return setError("사진을 한 장 선택해주세요.");
    setBusy(true);
    setError("");
    try {
      let mediaId = uploadedMediaId;
      if (file && !mediaId) {
        mediaId = await uploadImage(file, setProgress);
        setUploadedMediaId(mediaId);
      }
      await apiFetch(retryCheckInId ? `/challenge-verifications/check-ins/${retryCheckInId}/resubmit` : `/challenges/${challenge.id}/check-in`, { method: "POST", body: JSON.stringify({ note: note.trim() || undefined, mediaId }) });
      await onDone();
      onClose();
    } catch (cause) {
      setError(userErrorMessage(cause, "인증을 남기지 못했어요."));
    } finally {
      setBusy(false);
    }
  }

  const chooseFile = (next: File | null) => { setFile(next); setPreviewUrl(next ? URL.createObjectURL(next) : ""); setUploadedMediaId(null); setProgress(0); setError(""); };
  const clearFile = () => chooseFile(null);
  const dirty = Boolean(note || file);

  return (<>
    <Sheet title={retryCheckInId ? "새 사진으로 다시 인증" : "오늘의 챌린지 인증"} onClose={() => { if (busy) return; if (dirty) setDiscardOpen(true); else onClose(); }}>
      <form className="composer-form" onSubmit={submit}>
        <div className="photo-picker-shell"><label className="photo-picker"><input type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif" disabled={busy} onChange={(event) => chooseFile(event.target.files?.[0] ?? null)} required={photoRequired} />{previewUrl ? <Image className="publish-photo-preview" src={previewUrl} alt="제출할 인증 사진 미리보기" width={72} height={72} unoptimized /> : <Camera />}<span><b>{file ? file.name : photoRequired ? "인증 사진을 선택해주세요" : "사진 추가 (선택)"}</b><small>10MB 이하 · 업로드 후 안전하게 확인해요</small></span></label>{file && <button type="button" className="publish-photo-remove" disabled={busy} onClick={clearFile} aria-label="인증 사진 제거"><XCircle /></button>}</div>
        {busy && progress > 0 && <div className="upload-progress"><i style={{ width: `${progress}%` }} /><span>{progress}%</span></div>}
        <label className="field"><span>오늘의 한마디 (선택)</span><textarea value={note} disabled={busy} onChange={(event) => setNote(event.target.value)} maxLength={180} placeholder="오늘 실천은 어땠나요?" /></label>
        {error && <p className="form-error" role="alert">{error}</p>}
        {challenge.verificationMode === "PEER_PHOTO" && <p className="form-help">사진은 작성자 정보 없이 같은 챌린지 참여자에게 표시되고, 기준별 투표로 자동 판정돼요.</p>}
        <button className="button full" disabled={busy}>{busy ? "인증하는 중…" : retryCheckInId ? "새 사진으로 다시 요청" : "오늘 인증 남기기"}</button>
      </form>
    </Sheet>
    {discardOpen && <ConfirmSheet title="인증 작성을 닫을까요?" body="선택한 사진과 입력한 한마디는 저장되지 않아요." confirmLabel="작성 내용 버리기" danger onClose={() => setDiscardOpen(false)} onConfirm={onClose} />}
  </>);
}

function VerificationQueueSheet({ challengeId, onClose, onDone }: { challengeId: string; onClose: () => void; onDone: (count: number) => void }) {
  const query = useQuery({ queryKey: ["challenge-verifications", challengeId], queryFn: () => apiFetch<ChallengeVerificationQueue>(`/challenge-verifications/queue?challengeId=${challengeId}&limit=1`) });
  const item = query.data?.items[0];
  type ReviewState = { checkInId: string; answers: Record<number, "MET" | "NOT_MET" | "UNSURE">; step: number };
  const [review, setReview] = useState<ReviewState>({ checkInId: "", answers: {}, step: 0 });
  const [reporting, setReporting] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const activeReview: ReviewState = review.checkInId === item?.checkInId ? review : { checkInId: item?.checkInId ?? "", answers: {}, step: 0 };
  const { answers, step } = activeReview;
  const setAnswers = (update: (current: ReviewState["answers"]) => ReviewState["answers"]) => setReview((current) => {
    const base = current.checkInId === item?.checkInId ? current : activeReview;
    return { ...base, answers: update(base.answers) };
  });
  const setStep = (update: (current: number) => number) => setReview((current) => {
    const base = current.checkInId === item?.checkInId ? current : activeReview;
    return { ...base, step: update(base.step) };
  });
  const vote = useMutation({
    mutationFn: () => apiFetch<{ contributionCount: number }>(`/challenge-verifications/${item!.checkInId}/vote`, { method: "POST", body: JSON.stringify({ answers: item!.criteria.map((_, criterionIndex) => ({ criterionIndex, result: answers[criterionIndex] })) }) }),
    onSuccess: async (result) => { onDone(result.contributionCount); setReview({ checkInId: "", answers: {}, step: 0 }); await query.refetch(); },
  });
  const criterion = item?.criteria[step];
  const currentAnswer = answers[step];
  const isLastStep = Boolean(item && step === item.criteria.length - 1);
  const choices = [
    { value: "MET" as const, label: "확인돼요", description: "기준에 맞는 내용이 보여요", icon: CheckCircle2 },
    { value: "NOT_MET" as const, label: "확인되지 않아요", description: "기준과 다른 내용이 보여요", icon: XCircle },
    { value: "UNSURE" as const, label: "판단하기 어려워요", description: "사진만으로는 확신하기 어려워요", icon: CircleHelp },
  ];
  return <Sheet title="사진 인증 함께 확인하기" onClose={onClose}>
    <div className="verification-queue">
      <div className="verification-anonymous-note"><ShieldCheck aria-hidden /><p><b>사진만 보고 익명으로 확인해요</b><span>작성자와 현재 투표 수는 보이지 않아요. 확실하지 않다면 판단하기 어려워요를 선택해도 괜찮아요.</span></p></div>
      {query.isLoading ? <PageLoading /> : query.isError ? <ErrorState message="확인할 인증을 불러오지 못했어요." onRetry={() => query.refetch()} /> : !item ? <EmptyState title="지금 확인할 사진이 없어요" body={`참여 가능한 새 인증이 생기면 다시 보여드릴게요. 지금까지 ${query.data?.contributionCount ?? 0}회 도왔어요.`} /> : <form onSubmit={(event) => { event.preventDefault(); if (!isLastStep || !item.criteria.every((_, index) => answers[index])) return; vote.mutate(); }}>
        <div className="verification-photo-wrap"><button type="button" className="verification-photo" aria-label="인증 사진 크게 보기" onClick={() => setExpanded(true)}><Image src={item.mediaUrl} alt={`${item.challenge.title} 참여자 인증 사진`} width={720} height={540} unoptimized /><span><Expand aria-hidden /> 크게 보기</span></button><button type="button" onClick={() => setReporting(true)}><Flag /> 이 사진 신고</button></div>
        <div className="verification-progress" aria-label={`확인 기준 ${step + 1}/${item.criteria.length}`}><div><span>확인 기준</span><strong>{step + 1} / {item.criteria.length}</strong></div><i aria-hidden><b style={{ width: `${((step + 1) / item.criteria.length) * 100}%` }} /></i></div>
        {criterion && <fieldset className="verification-question"><legend><span>{step + 1}</span>{criterion}</legend><div>{choices.map(({ value, label, description, icon: Icon }) => <button type="button" key={value} aria-pressed={currentAnswer === value} className={currentAnswer === value ? "selected" : ""} onClick={() => setAnswers((current) => ({ ...current, [step]: value }))}><Icon aria-hidden /><span><b>{label}</b><small>{description}</small></span>{currentAnswer === value && <Check className="verification-selected-mark" aria-hidden />}</button>)}</div></fieldset>}
        {vote.isError && <p className="form-error" role="alert">{userErrorMessage(vote.error, "투표를 저장하지 못했어요.")}</p>}
        <div className={`verification-step-actions ${step === 0 ? "first" : ""}`}>{step > 0 && <button type="button" className="verification-back" onClick={() => setStep((current) => Math.max(0, current - 1))}><ChevronLeft />이전 기준</button>}<button className="button full" type={isLastStep ? "submit" : "button"} disabled={!currentAnswer || vote.isPending} onClick={isLastStep ? undefined : () => setStep((current) => Math.min(item.criteria.length - 1, current + 1))}>{vote.isPending ? "의견을 보내는 중…" : isLastStep ? "익명으로 의견 보내기" : <>다음 기준<ChevronRight /></>}</button></div>
      </form>}
      {expanded && item && <Sheet title="인증 사진 크게 보기" onClose={() => setExpanded(false)}><div className="verification-photo-expanded"><Image src={item.mediaUrl} alt={`${item.challenge.title} 참여자 인증 사진 크게 보기`} width={1200} height={1200} unoptimized /></div></Sheet>}
      {reporting && item && <ReportSheet targetType="CHALLENGE_CHECK_IN" targetId={item.checkInId} onClose={() => setReporting(false)} onReported={onClose} />}
    </div>
  </Sheet>;
}
