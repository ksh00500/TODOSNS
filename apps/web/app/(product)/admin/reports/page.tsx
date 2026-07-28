"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Eye, ShieldAlert, XCircle } from "lucide-react";
import { useState } from "react";
import { useSession } from "@/components/app-providers";
import { AuthGate, EmptyState, ErrorState, PageLoading } from "@/components/states";
import { apiFetch } from "@/lib/api";
import type { Challenge } from "@/lib/types";

type Report = {
  id: string;
  targetType: string;
  targetId: string;
  reason: string;
  description?: string | null;
  status: string;
  createdAt: string;
  reporter: { id: string; nickname: string; handle: string };
};
type RewardParticipant = { userId: string; rewardStatus: string; joinedAt: string; checkInCount: number; user: { nickname: string; handle: string; email: string } };

export default function AdminReportsPage() {
  const { status, user } = useSession();
  const queryClient = useQueryClient();
  const permitted = user?.role === "ADMIN" || user?.role === "MODERATOR";
  const [selectedChallenge, setSelectedChallenge] = useState("");
  const reports = useQuery({
    queryKey: ["admin", "reports"],
    queryFn: () => apiFetch<{ items: Report[] }>("/admin/reports"),
    enabled: status === "authenticated" && permitted,
  });
  const update = useMutation({
    mutationFn: ({ id, nextStatus }: { id: string; nextStatus: string }) =>
      apiFetch(`/admin/reports/${id}`, { method: "PATCH", body: JSON.stringify({ status: nextStatus, resolution: `운영자 상태 변경: ${nextStatus}` }) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["admin", "reports"] }),
  });
  const challenges = useQuery({ queryKey: ["admin", "official-challenges"], queryFn: () => apiFetch<Challenge[]>("/challenges"), enabled: status === "authenticated" && permitted });
  const official = challenges.data?.filter((item) => item.kind === "OFFICIAL") ?? [];
  const challengeId = selectedChallenge || official[0]?.id || "";
  const participants = useQuery({
    queryKey: ["admin", "challenge-participants", challengeId],
    queryFn: () => apiFetch<{ items: RewardParticipant[] }>(`/admin/challenges/${challengeId}/participants`),
    enabled: Boolean(challengeId),
  });
  const reward = useMutation({
    mutationFn: ({ userId, nextStatus }: { userId: string; nextStatus: string }) => apiFetch(`/admin/challenges/${challengeId}/participants/${userId}/reward`, { method: "PATCH", body: JSON.stringify({ status: nextStatus }) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["admin", "challenge-participants", challengeId] }),
  });

  if (status === "guest") return <main className="app-page"><AuthGate /></main>;
  if (status === "loading") return <main className="app-page"><PageLoading /></main>;
  if (!permitted) {
    return <main className="app-page"><ErrorState message="운영자만 신고함을 확인할 수 있어요." /></main>;
  }

  return (
    <main className="app-page admin-page">
      <header className="simple-header">
        <div>
          <span className="eyebrow">운영 도구</span>
          <h1>신고함</h1>
        </div>
        <ShieldAlert aria-hidden />
      </header>
      {reports.isLoading ? <PageLoading /> : reports.isError ? (
        <ErrorState message="신고를 불러오지 못했어요." onRetry={() => reports.refetch()} />
      ) : !reports.data?.items.length ? (
        <EmptyState title="처리할 신고가 없어요" body="새로운 신고가 접수되면 여기에 나타나요." />
      ) : (
        <div className="report-list">
          {reports.data.items.map((report) => (
            <article className="surface-card report-card" key={report.id}>
              <div className="report-card-head">
                <span className={`status-pill status-${report.status.toLowerCase()}`}>{report.status}</span>
                <time>{new Date(report.createdAt).toLocaleString("ko-KR")}</time>
              </div>
              <h2>{report.targetType} · {report.reason}</h2>
              <p>{report.description || "상세 설명이 없어요."}</p>
              <small>@{report.reporter.handle} 님이 신고 · 대상 {report.targetId}</small>
              <div className="report-actions">
                <button onClick={() => update.mutate({ id: report.id, nextStatus: "REVIEWING" })} disabled={update.isPending}>
                  <Eye aria-hidden /> 검토
                </button>
                <button onClick={() => update.mutate({ id: report.id, nextStatus: "RESOLVED" })} disabled={update.isPending}>
                  <CheckCircle2 aria-hidden /> 처리
                </button>
                <button onClick={() => update.mutate({ id: report.id, nextStatus: "DISMISSED" })} disabled={update.isPending}>
                  <XCircle aria-hidden /> 기각
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
      <section className="reward-admin">
        <div className="section-heading spaced"><div><h2>공식 챌린지 보상</h2><span>검수부터 지급까지 상태를 관리해요</span></div></div>
        {!official.length ? <div className="inline-empty">진행 중인 공식 챌린지가 없어요.</div> : <>
          <label className="field"><span>공식 챌린지</span><select value={challengeId} onChange={(event) => setSelectedChallenge(event.target.value)}>{official.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>
          {participants.isLoading ? <PageLoading /> : participants.isError ? <ErrorState message="참여자 보상 정보를 불러오지 못했어요." onRetry={() => participants.refetch()} /> : <div className="reward-list">{participants.data?.items.map((item) => <article className="surface-card" key={item.userId}><div><b>{item.user.nickname}</b><small>@{item.user.handle} · {item.checkInCount}회 인증</small></div><span className={`status-pill status-${item.rewardStatus.toLowerCase()}`}>{item.rewardStatus}</span><div className="report-actions"><button onClick={() => reward.mutate({ userId: item.userId, nextStatus: "REVIEWING" })}>검수</button><button onClick={() => reward.mutate({ userId: item.userId, nextStatus: "APPROVED" })}>승인</button><button onClick={() => reward.mutate({ userId: item.userId, nextStatus: "PAID" })}>지급</button></div></article>)}</div>}
        </>}
      </section>
    </main>
  );
}
