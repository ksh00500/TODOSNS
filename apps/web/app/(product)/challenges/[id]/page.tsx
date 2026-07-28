"use client";

import { FormEvent, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, CalendarCheck, Camera, Check, Flag, ShieldCheck, Trophy, Users } from "lucide-react";
import Link from "next/link";
import Image from "next/image";
import { useParams, useRouter } from "next/navigation";
import { useSession } from "@/components/app-providers";
import { ReportSheet } from "@/components/report-sheet";
import { Sheet } from "@/components/sheet";
import { EmptyState, ErrorState, PageLoading } from "@/components/states";
import { apiFetch, uploadImage } from "@/lib/api";
import type { Challenge } from "@/lib/types";

export default function ChallengeDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { status } = useSession();
  const queryClient = useQueryClient();
  const [checking, setChecking] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [notice, setNotice] = useState("");
  const endpoint = status === "authenticated" ? `/challenges/${id}` : `/public/challenges/${id}`;
  const query = useQuery({ queryKey: ["challenge", id, status], queryFn: () => apiFetch<Challenge>(endpoint), enabled: Boolean(id) && status !== "loading" });
  const refresh = async () => { await Promise.all([queryClient.invalidateQueries({ queryKey: ["challenge", id] }), queryClient.invalidateQueries({ queryKey: ["challenges"] })]); };
  const join = useMutation({ mutationFn: () => apiFetch(`/challenges/${id}/join`, { method: "POST" }), onSuccess: async () => { setNotice("오늘부터 함께해요!"); await refresh(); } });
  const leave = useMutation({ mutationFn: () => apiFetch(`/challenges/${id}/join`, { method: "DELETE" }), onSuccess: async () => { setNotice("참여를 취소했어요."); await refresh(); } });

  if (query.isLoading || status === "loading") return <main className="app-page"><PageLoading /></main>;
  if (query.isError || !query.data) return <main className="app-page"><ErrorState message="챌린지를 불러오지 못했어요." onRetry={() => query.refetch()} /></main>;
  const challenge = query.data;
  const totalDays = Math.max(1, Math.ceil((new Date(challenge.endsAt).getTime() - new Date(challenge.startsAt).getTime()) / 86_400_000));
  const authAction = (action: () => void) => status === "authenticated" ? action() : router.push(`/start?returnTo=${encodeURIComponent(`/challenges/${id}`)}`);

  return (
    <main className="app-page challenge-detail-page">
      <header className="detail-toolbar"><Link href="/challenges" className="icon-button" aria-label="챌린지 목록"><ArrowLeft /></Link><button className="icon-button" aria-label="신고" onClick={() => authAction(() => setReporting(true))}><Flag /></button></header>
      <section className={`challenge-detail-hero ${challenge.kind.toLowerCase()}`}>
        <span>{challenge.kind === "OFFICIAL" ? <><ShieldCheck /> 공식 챌린지</> : "커뮤니티 챌린지"}</span>
        <h1>{challenge.title}</h1><p>{challenge.description}</p>
        <div><span><Users />{challenge._count.participants.toLocaleString()}명</span><span><CalendarCheck />{totalDays}일</span>{challenge.rewardLabel && <span><Trophy />{challenge.rewardLabel}</span>}</div>
      </section>
      {notice && <button className="notice" onClick={() => setNotice("")}>{notice}</button>}
      {challenge.joined ? (
        <>
          <section className="challenge-my-progress surface-card"><div><span>나의 성공률</span><strong>{challenge.successRate ?? 0}%</strong><small>{challenge.myCheckInCount ?? 0}일 인증했어요</small></div><div className="progress-ring" style={{ "--progress": `${challenge.successRate ?? 0}%` } as React.CSSProperties}><i><Check /></i></div></section>
          <button className="button full" disabled={challenge.todayCheckedIn} onClick={() => setChecking(true)}>{challenge.todayCheckedIn ? <><Check /> 오늘 인증 완료</> : <><Camera /> 오늘 인증하기</>}</button>
          <div className="section-heading"><div><h2>나의 인증 기록</h2><span>작은 실천이 쌓인 날들이에요</span></div></div>
          {!challenge.checkIns?.length ? <EmptyState title="아직 인증 기록이 없어요" body="오늘 첫 인증을 남겨보세요." /> : <div className="checkin-history">{challenge.checkIns.map((item) => <article key={item.id}>{item.mediaUrl ? <Image src={item.mediaUrl} alt="" width={52} height={52} unoptimized /> : <span><Check /></span>}<div><b>{new Date(item.checkInDate).toLocaleDateString("ko-KR")}</b><p>{item.note || "오늘의 약속을 지켰어요."}</p></div></article>)}</div>}
          <button className="danger-link subtle" disabled={leave.isPending} onClick={() => { if (window.confirm("참여를 취소하면 이 챌린지의 내 인증 기록도 삭제돼요. 계속할까요?")) leave.mutate(); }}>{leave.isPending ? "취소 중…" : "챌린지 참여 취소"}</button>
        </>
      ) : (
        <section className="join-challenge-card surface-card"><Trophy /><h2>오늘부터 같이 시작할까요?</h2><p>참여 후 매일 한 번 인증할 수 있어요. 기간 안에는 언제든 참여를 취소할 수 있어요.</p><button className="button full" disabled={join.isPending} onClick={() => authAction(() => join.mutate())}>{join.isPending ? "참여 중…" : "챌린지 시작하기"}</button></section>
      )}
      {checking && <CheckInSheet challenge={challenge} onClose={() => setChecking(false)} onDone={async () => { setNotice("오늘의 인증을 남겼어요."); await refresh(); }} />}
      {reporting && <ReportSheet targetType="CHALLENGE" targetId={id} onClose={() => setReporting(false)} onReported={() => setNotice("신고가 접수됐어요.")} />}
    </main>
  );
}

function CheckInSheet({ challenge, onClose, onDone }: { challenge: Challenge; onClose: () => void; onDone: () => Promise<void> }) {
  const [note, setNote] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [progress, setProgress] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const photoRequired = challenge.verificationMode === "REQUIRED_PHOTO";

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (photoRequired && !file) return setError("사진을 한 장 선택해주세요.");
    setBusy(true);
    setError("");
    try {
      const mediaId = file ? await uploadImage(file, setProgress) : null;
      await apiFetch(`/challenges/${challenge.id}/check-in`, { method: "POST", body: JSON.stringify({ note: note.trim() || undefined, mediaId }) });
      await onDone();
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "인증을 남기지 못했어요.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet title="오늘의 챌린지 인증" onClose={onClose}>
      <form className="composer-form" onSubmit={submit}>
        <label className="photo-picker"><input type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif" onChange={(event) => setFile(event.target.files?.[0] ?? null)} required={photoRequired} /><Camera /><span><b>{file ? file.name : photoRequired ? "인증 사진을 선택해주세요" : "사진 추가 (선택)"}</b><small>10MB 이하 · 업로드 후 안전하게 확인해요</small></span></label>
        {busy && progress > 0 && <div className="upload-progress"><i style={{ width: `${progress}%` }} /><span>{progress}%</span></div>}
        <label className="field"><span>오늘의 한마디 (선택)</span><textarea value={note} onChange={(event) => setNote(event.target.value)} maxLength={180} placeholder="오늘 실천은 어땠나요?" /></label>
        {error && <p className="form-error">{error}</p>}
        <button className="button full" disabled={busy}>{busy ? "인증하는 중…" : "오늘 인증 남기기"}</button>
      </form>
    </Sheet>
  );
}
