"use client";

import { FormEvent, Suspense } from "react";
import { InfiniteData, useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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
  const category = params.get("category") ?? "전체"; const mode = params.get("mode") ?? "mix"; const searchQuery = params.get("query")?.trim() ?? ""; const endpoint = status === "authenticated" ? "/feed" : "/public/feed";
  const feed = useInfiniteQuery({ queryKey: ["feed", endpoint, category, mode], initialPageParam: "", queryFn: ({ pageParam }) => apiFetch<FeedPage>(`${endpoint}?limit=10&mode=${mode}&category=${encodeURIComponent(category)}${pageParam ? `&cursor=${pageParam}` : ""}`), getNextPageParam: (last) => last.nextCursor ?? undefined });
  const search = useQuery({ queryKey: ["public-search", searchQuery], queryFn: () => apiFetch<{ users: Array<{ id: string; nickname: string; handle: string; avatarUrl?: string | null; cloudRank: string }>; posts: FeedPost[] }>(`/public/search?query=${encodeURIComponent(searchQuery)}&limit=20`), enabled: searchQuery.length >= 2 });
  const requireLogin = () => { router.push(`/start?returnTo=${encodeURIComponent("/explore")}`); };
  const cheer = useMutation({ mutationFn: (post: FeedPost) => apiFetch(`/feed/posts/${post.id}/cheer`, { method: "POST" }), onMutate: async (post) => { if (status !== "authenticated") { requireLogin(); throw new Error("LOGIN_REQUIRED"); } await queryClient.cancelQueries({ queryKey: ["feed"] }); const snapshots = queryClient.getQueriesData<InfiniteData<FeedPage>>({ queryKey: ["feed"] }); queryClient.setQueriesData<InfiniteData<FeedPage>>({ queryKey: ["feed"] }, (data) => data ? { ...data, pages: data.pages.map((page) => ({ ...page, items: page.items.map((item) => item.id === post.id ? { ...item, cheered: !item.cheered, cheerCount: item.cheerCount + (item.cheered ? -1 : 1) } : item) })) } : data); return { snapshots }; }, onError: (error, _post, context) => { if (error instanceof Error && error.message === "LOGIN_REQUIRED") return; context?.snapshots.forEach(([key, data]) => queryClient.setQueryData(key, data)); } });
  const posts = feed.data?.pages.flatMap((page) => page.items) ?? [];
  const visiblePosts = searchQuery.length >= 2 ? search.data?.posts ?? [] : posts;
  const featuredRoutine = posts.find((post) => post.todoList)?.todoList;
  const setParam = (key: string, value: string) => { const next = new URLSearchParams(params.toString()); next.set(key, value); router.replace(`/explore?${next}`); };
  const submitSearch = (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); const value = String(new FormData(event.currentTarget).get("query") ?? "").trim(); const next = new URLSearchParams(params.toString()); if (value) next.set("query", value); else next.delete("query"); router.replace(`/explore?${next}`); };
  const openImport = (post: FeedPost) => { if (status !== "authenticated") { requireLogin(); return; } router.push(`/todos/import?postId=${post.id}`); };
  return <main className="app-page explore-page"><header className="page-intro compact"><div><span>자극보다 따라 할 수 있는 실천</span><h1>탐색</h1></div></header>
    <form className="explore-search" role="search" onSubmit={submitSearch}><Search /><input name="query" defaultValue={searchQuery} minLength={2} placeholder="습관, 사용자 또는 주제 검색" aria-label="습관 검색" /><button type="submit">검색</button></form>
    <div className="interest-row" aria-label="관심사 필터">{interests.map((item) => <button key={item} className={category === item ? "active" : ""} onClick={() => setParam("category", item)}>{item}</button>)}</div>
    {!searchQuery && featuredRoutine && <section className="routine-feature"><span>지금 주목받는 루틴</span><h2>{featuredRoutine.title}</h2><p>{featuredRoutine.description || `${featuredRoutine.items.length}개의 TODO를 한 번에 가져갈 수 있어요.`}</p><i>추천 루틴</i></section>}
    {searchQuery.length >= 2 && Boolean(search.data?.users.length) && <section className="search-people"><div className="section-heading"><div><h2>사용자</h2><span>{search.data?.users.length}명</span></div></div>{search.data?.users.map((person) => <button key={person.id} onClick={() => router.push(`/people/${person.handle}`)}><span className="avatar">{person.nickname.slice(0, 1)}</span><div><b>{person.nickname}</b><small>@{person.handle} · {person.cloudRank}</small></div></button>)}</section>}
    <div className="section-heading"><div><h2>오늘의 실천</h2><span>관심사에 맞춰 골랐어요</span></div><button className="soft-button" onClick={() => setParam("mode", mode === "recent" ? "mix" : "recent")}><SlidersHorizontal />{mode === "recent" ? "최신순" : "추천순"}</button></div>
    {(searchQuery.length >= 2 ? search.isLoading : feed.isLoading) ? <ListSkeleton /> : (searchQuery.length >= 2 ? search.isError : feed.isError) ? <ErrorState onRetry={() => searchQuery.length >= 2 ? void search.refetch() : void feed.refetch()} /> : visiblePosts.length === 0 ? <EmptyState title={searchQuery ? "검색 결과가 없어요" : "아직 올라온 실천이 없어요"} body={searchQuery ? "다른 단어나 관심사로 찾아보세요." : "첫 번째 실천을 공유해보세요."} /> : <div className="feed-stack">{visiblePosts.map((post) => <FeedCard key={post.id} post={post} pending={cheer.isPending} onCheer={() => cheer.mutate(post)} onCopy={() => openImport(post)} />)}{!searchQuery && feed.hasNextPage && <button className="load-more" onClick={() => void feed.fetchNextPage()} disabled={feed.isFetchingNextPage}>{feed.isFetchingNextPage ? "불러오는 중…" : "실천 더 보기"}</button>}</div>}
  </main>;
}
