"use client";

import Link from "next/link";
import Image from "next/image";
import { use, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import type { UserSummary } from "@/lib/types";
import { useSession } from "@/components/app-providers";
import { AuthGate, EmptyState, ErrorState, ListSkeleton } from "@/components/states";

type PublicProfile = { id: string; nickname: string; handle: string };

export default function ConnectionsPage({ params, searchParams }: { params: Promise<{ handle: string }>; searchParams: Promise<{ type?: string }> }) {
  const { handle } = use(params);
  const search = use(searchParams);
  const { status } = useSession();
  const [kind, setKind] = useState<"followers" | "following">(search.type === "following" ? "following" : "followers");
  const profile = useQuery({ queryKey: ["people", handle], queryFn: () => apiFetch<PublicProfile>(`/public/users/${handle}`) });
  const connections = useQuery({
    queryKey: ["connections", profile.data?.id, kind],
    queryFn: () => apiFetch<{ items: UserSummary[]; nextCursor: string | null }>(`/social/${kind}/${profile.data?.id}?limit=50`),
    enabled: status === "authenticated" && Boolean(profile.data?.id),
  });
  if (status === "guest") return <main className="app-page"><AuthGate title="팔로우 목록은 로그인 후 볼 수 있어요" /></main>;
  return <main className="app-page connections-page"><header className="simple-header"><div><span>@{handle}</span><h1>함께하는 구름</h1></div></header><div className="calendar-switch"><button className={kind === "followers" ? "active" : ""} onClick={() => setKind("followers")}>팔로워</button><button className={kind === "following" ? "active" : ""} onClick={() => setKind("following")}>팔로잉</button></div>{profile.isLoading || connections.isLoading ? <ListSkeleton /> : profile.isError || connections.isError ? <ErrorState message="팔로우 목록을 불러오지 못했어요." onRetry={() => { void profile.refetch(); void connections.refetch(); }} /> : !connections.data?.items.length ? <EmptyState title="아직 함께하는 구름이 없어요" body="좋은 실천을 발견하면 가볍게 팔로우해보세요." /> : <div className="connection-list">{connections.data.items.map((person) => <Link href={`/people/${person.handle}`} key={person.id}>{person.avatarUrl ? <Image src={person.avatarUrl} alt="" width={44} height={44} unoptimized /> : <span>{person.nickname.slice(0, 1)}</span>}<div><b>{person.nickname}</b><small>@{person.handle} · {person.cloudRank}</small></div></Link>)}</div>}</main>;
}
