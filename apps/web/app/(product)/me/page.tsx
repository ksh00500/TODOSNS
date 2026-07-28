"use client";

import Link from "next/link";
import Image from "next/image";
import { useQuery } from "@tanstack/react-query";
import { Award, ChevronRight, CopyPlus, Flame, HeartHandshake, Settings, Sparkles, Trophy } from "lucide-react";
import { apiFetch } from "@/lib/api";
import type { SessionUser, TodoListDto } from "@/lib/types";
import { useSession } from "@/components/app-providers";
import { AuthGate, ErrorState, ListSkeleton } from "@/components/states";
import { CloudMark } from "@/components/cloud-mark";

type Profile = SessionUser & { rank: string; _count: { followers: number; following: number; posts: number } };

export default function MePage() {
  const { status } = useSession(); const profile = useQuery({ queryKey: ["me", "profile"], queryFn: () => apiFetch<Profile>("/me"), enabled: status === "authenticated" }); const lists = useQuery({ queryKey: ["todo-lists"], queryFn: () => apiFetch<TodoListDto[]>("/todo-lists"), enabled: status === "authenticated" });
  if (status === "loading") return <main className="app-page"><ListSkeleton /></main>; if (status === "guest") return <main className="app-page"><AuthGate title="나의 기록은 로그인 후 확인할 수 있어요" /></main>; if (profile.isError) return <main className="app-page"><ErrorState onRetry={() => void profile.refetch()} /></main>; const me = profile.data; if (!me) return <main className="app-page"><ListSkeleton /></main>;
  const nextRank = me.lifetimePower < 100 ? 100 : me.lifetimePower < 300 ? 300 : me.lifetimePower < 800 ? 800 : me.lifetimePower < 2000 ? 2000 : 5000; const rankProgress = Math.min(100, Math.round(me.lifetimePower / nextRank * 100));
  return <main className="app-page me-page"><header className="simple-header"><h1>마이</h1><Link href="/settings" className="round-button" aria-label="설정"><Settings /></Link></header><section className="profile-card"><div className="profile-avatar">{me.avatarUrl ? <Image src={me.avatarUrl} alt="" width={82} height={82} unoptimized /> : me.nickname.slice(0,1)}<CloudMark compact /></div><h2>{me.nickname}</h2><p>@{me.handle}</p><span>{me.bio || "작은 실천을 오래 이어가는 중이에요."}</span><div className="profile-numbers"><div><b>{me._count.posts}</b><small>공유</small></div><div><b>{me._count.followers}</b><small>팔로워</small></div><div><b>{me._count.following}</b><small>팔로잉</small></div></div></section>
    <section className="rank-card"><span className="rank-cloud"><CloudMark /><Sparkles /></span><div><small>나의 뭉실 등급</small><h3>{me.rank}<b>{me.lifetimePower.toLocaleString()} 뭉실</b></h3><div className="rank-progress"><i style={{ width: `${rankProgress}%` }} /></div><p>다음 구름까지 {Math.max(0, nextRank - me.lifetimePower)} 뭉실</p></div><ChevronRight /></section>
    <div className="stat-grid"><article><span className="blue"><Flame /></span><div><small>최근 활동도</small><b>{me.recentVitality}<em>/100</em></b></div></article><article><span className="pink"><HeartHandshake /></span><div><small>받은 응원</small><b>—</b></div></article></div>
    <div className="section-heading spaced"><div><h2>나의 루틴 보드</h2><span>{lists.data?.length ?? 0}개의 루틴</span></div><Link href="/todos" className="soft-button">전체보기 <ChevronRight /></Link></div>
    <div className="my-routines">{lists.data?.slice(0, 3).map((list, index) => <article className={["blue","pink","mint"][index % 3]} key={list.id}><span>{list.items.length}개의 TODO</span><h3>{list.title}</h3><p>{list.description || "꾸준히 이어가는 나만의 루틴"}</p><small><CopyPlus />{list.copyCount ?? list._count?.copies ?? 0}명이 가져감</small></article>)}{!lists.isLoading && !lists.data?.length && <div className="inline-empty">아직 만든 루틴이 없어요.</div>}</div>
    <section className="badge-section"><div className="section-heading"><div><h2>나의 배지</h2><span>실천으로 얻은 기록</span></div></div><div className="badges"><span className={me._count.posts > 0 ? "" : "locked"}><Award /><b>첫 공유</b></span><span className={(lists.data?.length ?? 0) > 0 ? "" : "locked"}><Trophy /><b>루틴 메이커</b></span><span className={me.lifetimePower >= 100 ? "" : "locked"}><Award /><b>조각구름</b></span></div></section>
  </main>;
}
