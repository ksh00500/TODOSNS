"use client";

import { use, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Ban, Flag, HeartHandshake, UserPlus } from "lucide-react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import { apiFetch } from "@/lib/api";
import type { FeedPage, FeedPost } from "@/lib/types";
import { EmptyState, ErrorState, ListSkeleton } from "@/components/states";
import { CloudMark } from "@/components/cloud-mark";
import { useSession } from "@/components/app-providers";
import { FeedCard } from "@/components/feed-card";
import { ReportSheet } from "@/components/report-sheet";

type PublicProfile = {
  id: string;
  nickname: string;
  handle: string;
  avatarUrl?: string | null;
  bio?: string | null;
  rank: string;
  lifetimePower: number;
  recentVitality: number;
  _count: { followers: number; following: number; posts: number };
};

type FollowState = {
  following: boolean;
  blocked: boolean;
  followerCount: number;
  followingCount: number;
};

export default function PersonPage({ params }: { params: Promise<{ handle: string }> }) {
  const { handle } = use(params);
  const { status, user } = useSession();
  const router = useRouter();
  const client = useQueryClient();
  const [reporting, setReporting] = useState(false);
  const [notice, setNotice] = useState("");
  const query = useQuery({
    queryKey: ["people", handle],
    queryFn: () => apiFetch<PublicProfile>(`/public/users/${handle}`),
  });
  const posts = useQuery({
    queryKey: ["people", handle, "posts"],
    queryFn: () => apiFetch<FeedPage>(`/public/users/${handle}/posts?limit=12`),
  });
  const followState = useQuery({
    queryKey: ["follow-state", query.data?.id],
    queryFn: () => apiFetch<FollowState>(`/social/follow-state/${query.data?.id}`),
    enabled: status === "authenticated" && Boolean(query.data?.id) && query.data?.id !== user?.id,
  });
  const requireLogin = () =>
    router.push(`/start?returnTo=${encodeURIComponent(`/people/${handle}`)}`);
  const follow = useMutation({
    mutationFn: () => {
      if (status !== "authenticated") {
        requireLogin();
        throw new Error("LOGIN_REQUIRED");
      }
      return apiFetch<{ following: boolean }>("/social/follow", {
        method: "POST",
        body: JSON.stringify({ userId: query.data?.id }),
      });
    },
    onSuccess: () => {
      void followState.refetch();
      void query.refetch();
    },
  });
  const block = useMutation({
    mutationFn: () =>
      apiFetch("/social/block", {
        method: "POST",
        body: JSON.stringify({ userId: query.data?.id }),
      }),
    onSuccess: () => router.replace("/explore"),
  });
  const cheer = useMutation({
    mutationFn: (post: FeedPost) =>
      apiFetch(`/feed/posts/${post.id}/cheer`, { method: "POST" }),
    onSuccess: () => void client.invalidateQueries({ queryKey: ["people", handle, "posts"] }),
  });

  if (query.isLoading) return <main className="app-page"><ListSkeleton /></main>;
  if (query.isError || !query.data) {
    return (
      <main className="app-page">
        <ErrorState onRetry={() => void query.refetch()} message="프로필을 찾지 못했어요." />
      </main>
    );
  }
  const person = query.data;
  const isMe = person.id === user?.id;
  const following = followState.data?.following ?? false;

  return (
    <main className="app-page person-page">
      <section className="profile-card public">
        <div className="profile-avatar">
          {person.avatarUrl ? (
            <Image src={person.avatarUrl} alt="" width={82} height={82} unoptimized />
          ) : (
            person.nickname.slice(0, 1)
          )}
          <CloudMark compact />
        </div>
        <h1>{person.nickname}</h1>
        <p>@{person.handle}</p>
        <span>{person.bio || "작은 실천을 오래 이어가는 중이에요."}</span>
        <div className="profile-numbers">
          <div><b>{person._count.posts}</b><small>공유</small></div>
          <Link href={`/people/${handle}/connections?type=followers`}><b>{followState.data?.followerCount ?? person._count.followers}</b><small>팔로워</small></Link>
          <Link href={`/people/${handle}/connections?type=following`}><b>{followState.data?.followingCount ?? person._count.following}</b><small>팔로잉</small></Link>
        </div>
        {!isMe && (
          <>
            <button
              className={`button full ${following ? "secondary" : ""}`}
              onClick={() => follow.mutate()}
              disabled={follow.isPending}
            >
              <UserPlus /> {following ? "팔로잉" : "팔로우"}
            </button>
            {status === "authenticated" && (
              <div className="safety-actions">
                <button onClick={() => setReporting(true)}><Flag /> 신고</button>
                <button onClick={() => block.mutate()} disabled={block.isPending}><Ban /> 차단</button>
              </div>
            )}
          </>
        )}
      </section>
      <section className="public-rank">
        <CloudMark />
        <div>
          <small>뭉실 등급</small>
          <b>{person.rank}</b>
          <p>{person.lifetimePower.toLocaleString()} 뭉실을 차곡차곡 쌓았어요.</p>
        </div>
        <HeartHandshake />
      </section>
      {notice && <button className="notice" onClick={() => setNotice("")}>{notice}</button>}
      <div className="section-heading spaced">
        <div><h2>공유한 실천</h2><span>{person._count.posts}개의 기록</span></div>
      </div>
      {posts.isLoading ? (
        <ListSkeleton />
      ) : posts.isError ? (
        <ErrorState onRetry={() => void posts.refetch()} />
      ) : !posts.data?.items.length ? (
        <EmptyState title="아직 공유한 실천이 없어요" body="첫 실천이 올라오면 이곳에서 볼 수 있어요." />
      ) : (
        <div className="feed-stack">
          {posts.data.items.map((post) => (
            <FeedCard
              key={post.id}
              post={post}
              pending={cheer.isPending}
              onCheer={() => {
                if (status !== "authenticated") return requireLogin();
                cheer.mutate(post);
              }}
              onCopy={() => {
                if (status !== "authenticated") return requireLogin();
                router.push(`/todos/import?postId=${post.id}`);
              }}
            />
          ))}
        </div>
      )}
      {reporting && (
        <ReportSheet
          targetType="USER"
          targetId={person.id}
          onClose={() => setReporting(false)}
          onReported={() => setNotice("신고를 접수했어요. 운영팀이 확인할게요.")}
        />
      )}
    </main>
  );
}
