"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Check, ChevronRight, Cloud, Sparkles } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { CLOUD_RANKS, nextRankFor, rankIndexFor, rankProgressFor } from "@/lib/ranks";
import { useSession } from "@/components/app-providers";
import { AuthGate, ErrorState, ListSkeleton } from "@/components/states";
import { CloudMark } from "@/components/cloud-mark";

type RankProfile = { rank: string; lifetimePower: number };

export default function RankDetailPage() {
  const { status } = useSession();
  const profile = useQuery({ queryKey: ["me", "profile"], queryFn: () => apiFetch<RankProfile>("/me"), enabled: status === "authenticated" });

  if (status === "loading") return <main className="app-page"><ListSkeleton /></main>;
  if (status === "guest") return <main className="app-page"><AuthGate title="나의 등급은 로그인 후 확인할 수 있어요" /></main>;
  if (profile.isError) return <main className="app-page"><ErrorState message="등급 정보를 불러오지 못했어요." onRetry={() => void profile.refetch()} /></main>;
  if (!profile.data) return <main className="app-page"><ListSkeleton /></main>;

  const power = profile.data.lifetimePower;
  const currentIndex = rankIndexFor(power);
  const current = CLOUD_RANKS[currentIndex];
  const next = nextRankFor(power);
  const progress = rankProgressFor(power);

  return <main className="app-page rank-detail-page">
    <header className="detail-toolbar rank-detail-toolbar"><Link href="/me" className="icon-button" aria-label="마이로 돌아가기"><ArrowLeft /></Link><div><span>나의 성장</span><h1>뭉실 등급</h1></div><i /></header>
    <section className="rank-detail-hero surface-card">
      <span className="rank-cloud"><CloudMark /><Sparkles aria-hidden /></span>
      <small>현재 등급</small>
      <h2>{current.name}</h2>
      <p>{current.description}</p>
      <strong>{power.toLocaleString()} <span>뭉실</span></strong>
      <div className="rank-progress" aria-label={next ? `${next.name}까지 ${progress}%` : "최고 등급 달성"}><i style={{ width: `${progress}%` }} /></div>
      <small>{next ? `${next.name}까지 ${(next.minimum - power).toLocaleString()} 뭉실` : "가장 높은 구름에 도착했어요"}</small>
    </section>
    <section className="rank-guide surface-card" aria-labelledby="power-guide-title">
      <div><Cloud aria-hidden /><h2 id="power-guide-title">뭉실력은 이렇게 쌓여요</h2></div>
      <ul><li><b>TODO 완료</b><span>하루 최대 5번, 한 번에 10 뭉실</span></li><li><b>완료한 실천 게시</b><span>하루 최대 2번, 한 번에 5 뭉실</span></li><li><b>응원과 댓글</b><span>하루 합산 최대 5번, 한 번에 1 뭉실</span></li><li><b>내 실천 가져가기</b><span>다른 사람이 가져가면 한 번에 5 뭉실</span></li></ul>
      <p>누적 뭉실력은 등급을 정하고 줄어들지 않아요. 사용할 수 있는 포인트와는 별도로 기록돼요.</p>
    </section>
    <section className="rank-roadmap" aria-labelledby="rank-roadmap-title">
      <div className="section-heading"><div><h2 id="rank-roadmap-title">구름이 자라는 길</h2><span>혜택 경쟁보다 나의 꾸준함을 보여줘요</span></div></div>
      <div>{CLOUD_RANKS.map((rank, index) => { const achieved = index <= currentIndex; const active = index === currentIndex; return <article key={rank.name} className={`${achieved ? "achieved" : ""} ${active ? "current" : ""}`}><span>{achieved ? <Check aria-hidden /> : index + 1}</span><div><b>{rank.name}{active && <em>현재</em>}</b><small>{rank.description}</small></div><strong>{rank.minimum.toLocaleString()}<small> 뭉실부터</small></strong>{index < CLOUD_RANKS.length - 1 && <ChevronRight aria-hidden />}</article>; })}</div>
    </section>
  </main>;
}
