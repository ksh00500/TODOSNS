"use client";

import { use, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { HeartHandshake, UserPlus } from "lucide-react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { apiFetch } from "@/lib/api";
import { ErrorState, ListSkeleton } from "@/components/states";
import { CloudMark } from "@/components/cloud-mark";
import { useSession } from "@/components/app-providers";

type PublicProfile = { id: string; nickname: string; handle: string; avatarUrl?: string | null; bio?: string | null; rank: string; lifetimePower: number; recentVitality: number; _count: { followers: number; following: number; posts: number } };

export default function PersonPage({ params }: { params: Promise<{ handle: string }> }) {
  const { handle } = use(params); const { status } = useSession(); const router = useRouter(); const [following, setFollowing] = useState(false); const query = useQuery({ queryKey: ["people", handle], queryFn: () => apiFetch<PublicProfile>(`/public/users/${handle}`) }); const follow = useMutation({ mutationFn: () => { if (status !== "authenticated") { router.push(`/start?returnTo=${encodeURIComponent(`/people/${handle}`)}`); throw new Error("LOGIN_REQUIRED"); } return apiFetch<{ following: boolean }>("/social/follow", { method: "POST", body: JSON.stringify({ userId: query.data?.id }) }); }, onSuccess: (result) => setFollowing(result.following) });
  if (query.isLoading) return <main className="app-page"><ListSkeleton /></main>; if (query.isError || !query.data) return <main className="app-page"><ErrorState onRetry={() => void query.refetch()} message="프로필을 찾지 못했어요." /></main>; const person = query.data;
  return <main className="app-page person-page"><section className="profile-card public"><div className="profile-avatar">{person.avatarUrl ? <Image src={person.avatarUrl} alt="" width={82} height={82} unoptimized /> : person.nickname.slice(0,1)}<CloudMark compact /></div><h1>{person.nickname}</h1><p>@{person.handle}</p><span>{person.bio || "작은 실천을 오래 이어가는 중이에요."}</span><div className="profile-numbers"><div><b>{person._count.posts}</b><small>공유</small></div><div><b>{person._count.followers}</b><small>팔로워</small></div><div><b>{person._count.following}</b><small>팔로잉</small></div></div><button className={`button full ${following ? "secondary" : ""}`} onClick={() => follow.mutate()} disabled={follow.isPending}><UserPlus /> {following ? "팔로잉" : "팔로우"}</button></section><section className="public-rank"><CloudMark /><div><small>뭉실 등급</small><b>{person.rank}</b><p>{person.lifetimePower.toLocaleString()} 뭉실을 차곡차곡 쌓았어요.</p></div><HeartHandshake /></section></main>;
}
