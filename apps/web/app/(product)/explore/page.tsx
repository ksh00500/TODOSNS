"use client";

import { Suspense } from "react";
import { InfiniteData, useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Search, SlidersHorizontal } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { apiFetch } from "@/lib/api";
import type { FeedPage, FeedPost } from "@/lib/types";
import { useSession } from "@/components/app-providers";
import { FeedCard } from "@/components/feed-card";
import { EmptyState, ErrorState, ListSkeleton } from "@/components/states";

const interests = ["전체", "운동", "공부", "독서", "건강", "마음", "커리어"];

export default function ExplorePage() { return <Suspense fallback={<main className="app-page"><ListSkeleton /></main>}><ExploreContent /></Suspense>; }

function ExploreContent() {
  const { status } = useSession(); const router = useRouter(); const params = useSearchParams(); const queryClient = useQueryClient();
  const category = params.get("category") ?? "전체"; const mode = params.get("mode") ?? "mix"; const endpoint = status === "authenticated" ? "/feed" : "/public/feed";
  const feed = useInfiniteQuery({ queryKey: ["feed", endpoint, category, mode], initialPageParam: "", queryFn: ({ pageParam }) => apiFetch<FeedPage>(`${endpoint}?limit=10&mode=${mode}&category=${encodeURIComponent(category)}${pageParam ? `&cursor=${pageParam}` : ""}`), getNextPageParam: (last) => last.nextCursor ?? undefined });
  const requireLogin = () => { router.push(`/start?returnTo=${encodeURIComponent("/explore")}`); };
  const cheer = useMutation({ mutationFn: (post: FeedPost) => apiFetch(`/feed/posts/${post.id}/cheer`, { method: "POST" }), onMutate: async (post) => { if (status !== "authenticated") { requireLogin(); throw new Error("LOGIN_REQUIRED"); } await queryClient.cancelQueries({ queryKey: ["feed"] }); const snapshots = queryClient.getQueriesData<InfiniteData<FeedPage>>({ queryKey: ["feed"] }); queryClient.setQueriesData<InfiniteData<FeedPage>>({ queryKey: ["feed"] }, (data) => data ? { ...data, pages: data.pages.map((page) => ({ ...page, items: page.items.map((item) => item.id === post.id ? { ...item, cheered: !item.cheered, cheerCount: item.cheerCount + (item.cheered ? -1 : 1) } : item) })) } : data); return { snapshots }; }, onError: (error, _post, context) => { if (error instanceof Error && error.message === "LOGIN_REQUIRED") return; context?.snapshots.forEach(([key, data]) => queryClient.setQueryData(key, data)); } });
  const posts = feed.data?.pages.flatMap((page) => page.items) ?? [];
  const featuredRoutine = posts.find((post) => post.todoList)?.todoList;
  const setParam = (key: string, value: string) => { const next = new URLSearchParams(params.toString()); next.set(key, value); router.replace(`/explore?${next}`); };
  const openImport = (post: FeedPost) => { if (status !== "authenticated") { requireLogin(); return; } router.push(`/todos/import?postId=${post.id}`); };
  return <main className="app-page explore-page"><header className="page-intro compact"><div><span>자극보다 따라 할 수 있는 실천</span><h1>탐색</h1></div></header>
    <button className="explore-search" type="button" aria-label="습관 검색"><Search /><span>습관, 사용자 또는 주제 검색</span></button>
    <div className="interest-row" aria-label="관심사 필터">{interests.map((item) => <button key={item} className={category === item ? "active" : ""} onClick={() => setParam("category", item)}>{item}</button>)}</div>
    {featuredRoutine && <section className="routine-feature"><span>지금 주목받는 루틴</span><h2>{featuredRoutine.title}</h2><p>{featuredRoutine.description || `${featuredRoutine.items.length}개의 TODO를 한 번에 가져갈 수 있어요.`}</p><i>추천 루틴</i></section>}
    <div className="section-heading"><div><h2>오늘의 실천</h2><span>관심사에 맞춰 골랐어요</span></div><button className="soft-button" onClick={() => setParam("mode", mode === "recent" ? "mix" : "recent")}><SlidersHorizontal />{mode === "recent" ? "최신순" : "추천순"}</button></div>
    {feed.isLoading ? <ListSkeleton /> : feed.isError ? <ErrorState onRetry={() => void feed.refetch()} /> : posts.length === 0 ? <EmptyState title="아직 올라온 실천이 없어요" body="첫 번째 실천을 공유해보세요." /> : <div className="feed-stack">{posts.map((post) => <FeedCard key={post.id} post={post} pending={cheer.isPending} onCheer={() => cheer.mutate(post)} onCopy={() => openImport(post)} />)}{feed.hasNextPage && <button className="load-more" onClick={() => void feed.fetchNextPage()} disabled={feed.isFetchingNextPage}>{feed.isFetchingNextPage ? "불러오는 중…" : "실천 더 보기"}</button>}</div>}
  </main>;
}
