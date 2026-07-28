"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarCheck, Check, ChevronRight, ShieldCheck, Sparkles, Trophy, Users } from "lucide-react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/api";
import type { Challenge } from "@/lib/types";
import { useSession } from "@/components/app-providers";
import { EmptyState, ErrorState, ListSkeleton } from "@/components/states";

export default function ChallengesPage() {
  const { status } = useSession(); const router = useRouter(); const queryClient = useQueryClient(); const [filter, setFilter] = useState<"all" | "joined" | "official" | "community">("all"); const [notice, setNotice] = useState(""); const [now] = useState(() => Date.now());
  const endpoint = status === "authenticated" ? "/challenges" : "/public/challenges";
  const query = useQuery({ queryKey: ["challenges", endpoint], queryFn: () => apiFetch<Challenge[]>(endpoint) });
  const join = useMutation({ mutationFn: (id: string) => { if (status !== "authenticated") { router.push(`/start?returnTo=${encodeURIComponent("/challenges")}`); throw new Error("LOGIN_REQUIRED"); } return apiFetch(`/challenges/${id}/join`, { method: "POST" }); }, onSuccess: () => { setNotice("챌린지에 참여했어요. 오늘부터 함께해요!"); void queryClient.invalidateQueries({ queryKey: ["challenges"] }); } });
  const checkIn = useMutation({ mutationFn: (id: string) => apiFetch(`/challenges/${id}/check-in`, { method: "POST", body: JSON.stringify({}) }), onSuccess: () => { setNotice("오늘의 인증을 남겼어요."); void queryClient.invalidateQueries({ queryKey: ["challenges"] }); } });
  const challenges = (query.data ?? []).map((item) => ({ ...item, joined: item.joined ?? Boolean(item.participants?.length) })).filter((item) => filter === "all" || filter === "joined" && item.joined || filter === "official" && item.kind === "OFFICIAL" || filter === "community" && item.kind === "COMMUNITY");
  const featured = query.data?.find((item) => item.kind === "OFFICIAL") ?? query.data?.[0];
  return <main className="app-page challenges-page"><header className="page-intro compact"><div><span>같이 하면 더 오래 이어져요</span><h1>함께 만드는 변화</h1></div><span className="rank-icon"><Trophy /></span></header>
    {featured && <section className="challenge-hero"><span><Sparkles /> 지금 주목받는 챌린지</span><h2>{featured.title}</h2><p>{featured.description}</p><div><b>{featured._count.participants.toLocaleString()}명 참여 중</b><button onClick={() => join.mutate(featured.id)} disabled={join.isPending}>참여하기 <ChevronRight /></button></div></section>}
    <div className="chip-tabs">{[["all","전체"],["joined","참여 중"],["official","공식"],["community","커뮤니티"]].map(([id,label]) => <button key={id} className={filter === id ? "active" : ""} onClick={() => setFilter(id as typeof filter)}>{label}</button>)}</div>
    {notice && <button className="notice" onClick={() => setNotice("")}>{notice}</button>}
    {query.isLoading ? <ListSkeleton /> : query.isError ? <ErrorState onRetry={() => void query.refetch()} /> : challenges.length === 0 ? <EmptyState title="조건에 맞는 챌린지가 없어요" body="다른 분류를 둘러보거나 새로운 챌린지를 기다려주세요." /> : <div className="challenge-list">{challenges.map((challenge) => { const start = new Date(challenge.startsAt); const end = new Date(challenge.endsAt); const total = Math.max(1, Math.ceil((end.getTime() - start.getTime()) / 86400000)); const elapsed = Math.max(0, Math.min(total, Math.ceil((now - start.getTime()) / 86400000))); const progress = Math.round(elapsed / total * 100); return <article key={challenge.id}><header><span className={challenge.kind === "OFFICIAL" ? "official" : "community"}>{challenge.kind === "OFFICIAL" ? <><ShieldCheck />공식</> : "커뮤니티"}</span><small>D-{Math.max(0, Math.ceil((end.getTime() - now) / 86400000))}</small></header><h2>{challenge.title}</h2><p>{challenge.description}</p><div className="challenge-meta"><span><Users />{challenge._count.participants.toLocaleString()}명</span><span><CalendarCheck />{total}일</span>{challenge.rewardLabel && <span><Trophy />{challenge.rewardLabel}</span>}</div>{challenge.joined ? <><div className="challenge-progress"><i style={{ width: `${progress}%` }} /></div><footer><span>{elapsed}일째 함께하는 중</span><button onClick={() => checkIn.mutate(challenge.id)} disabled={checkIn.isPending}><Check />오늘 인증</button></footer></> : <button className="button full secondary" onClick={() => join.mutate(challenge.id)} disabled={join.isPending}>이 챌린지 시작하기</button>}</article>; })}</div>}
  </main>;
}
