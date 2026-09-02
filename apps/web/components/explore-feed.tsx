"use client";

import { useState } from "react";
import Link from "next/link";
import { InfiniteData, useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { BookOpen, Brain, BriefcaseBusiness, Check, Clock3, Dumbbell, GraduationCap, Grid2X2, HeartPulse, House, Palette, Search, SlidersHorizontal, Sparkles } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { apiFetch } from "@/lib/api";
import type { FeedPage, FeedPost } from "@/lib/types";
import { TODO_CATEGORIES } from "@/lib/todo-options";
import { useSession } from "@/components/app-providers";
import { FeedCard } from "@/components/feed-card";
import { Sheet } from "@/components/sheet";
import { EmptyState, ErrorState, ListSkeleton } from "@/components/states";

const categoryOptions = [
  { value: "전체", icon: Grid2X2 }, { value: "생활", icon: House }, { value: "건강", icon: HeartPulse },
  { value: "운동", icon: Dumbbell }, { value: "공부", icon: GraduationCap }, { value: "독서", icon: BookOpen },
  { value: "마음", icon: Brain }, { value: "커리어", icon: BriefcaseBusiness }, { value: "취미", icon: Palette },
] as const;

export function ExploreFeed() {
  const { status } = useSession();
  const router = useRouter();
  const params = useSearchParams();
  const queryClient = useQueryClient();
  const requestedCategory = params.get("category") ?? "전체";
  const category = requestedCategory === "전체" || TODO_CATEGORIES.includes(requestedCategory as (typeof TODO_CATEGORIES)[number]) ? requestedCategory : "전체";
  const mode = params.get("mode") === "mix" ? "mix" : "recent";
  const endpoint = status === "authenticated" ? "/feed" : "/public/feed";
  const [filterOpen, setFilterOpen] = useState(false);
  const activeFilterCount = Number(category !== "전체") + Number(mode !== "recent");
  const filterSummary = [category !== "전체" ? category : null, mode === "mix" ? "추천순" : null].filter(Boolean).join(" · ");

  const feed = useInfiniteQuery({ queryKey: ["feed", endpoint, category, mode], initialPageParam: "", queryFn: ({ pageParam }) => apiFetch<FeedPage>(`${endpoint}?limit=10&mode=${mode}&category=${encodeURIComponent(category)}${pageParam ? `&cursor=${pageParam}` : ""}`), getNextPageParam: (last) => last.nextCursor ?? undefined });
  const requireLogin = () => { router.push(`/start?returnTo=${encodeURIComponent(`/explore${params.size ? `?${params}` : ""}`)}`); };
  const cheer = useMutation({ mutationFn: (post: FeedPost) => apiFetch(`/feed/posts/${post.id}/cheer`, { method: "POST" }), onMutate: async (post) => { if (status !== "authenticated") { requireLogin(); throw new Error("LOGIN_REQUIRED"); } await queryClient.cancelQueries({ queryKey: ["feed"] }); const snapshots = queryClient.getQueriesData<InfiniteData<FeedPage>>({ queryKey: ["feed"] }); queryClient.setQueriesData<InfiniteData<FeedPage>>({ queryKey: ["feed"] }, (data) => data ? { ...data, pages: data.pages.map((page) => ({ ...page, items: page.items.map((item) => item.id === post.id ? { ...item, cheered: !item.cheered, cheerCount: item.cheerCount + (item.cheered ? -1 : 1) } : item) })) } : data); return { snapshots }; }, onError: (error, _post, context) => { if (error instanceof Error && error.message === "LOGIN_REQUIRED") return; context?.snapshots.forEach(([key, data]) => queryClient.setQueryData(key, data)); } });
  const posts = feed.data?.pages.flatMap((page) => page.items) ?? [];
  const openImport = (post: FeedPost) => { if (status !== "authenticated") { requireLogin(); return; } router.push(`/todos/import?postId=${post.id}`); };

  const applyFilter = (nextCategory: string, nextMode: "recent" | "mix") => {
    const next = new URLSearchParams();
    if (nextCategory !== "전체") next.set("category", nextCategory);
    if (nextMode !== "recent") next.set("mode", nextMode);
    router.replace(`/explore${next.size ? `?${next}` : ""}`);
    setFilterOpen(false);
  };

  return <main className="app-page explore-page"><header className="explore-minimal-header"><div><span>좋은 실천을 가볍게 둘러보세요</span><h1>탐색</h1>{filterSummary && <small><SlidersHorizontal aria-hidden />{filterSummary}</small>}</div><div className="explore-header-actions"><button className="explore-tool-button" aria-label={`피드 필터${activeFilterCount ? ` ${activeFilterCount}개 적용됨` : ""}`} onClick={() => setFilterOpen(true)}><SlidersHorizontal aria-hidden />{activeFilterCount > 0 && <i aria-hidden>{activeFilterCount}</i>}</button><Link href="/explore/search" className="explore-tool-button" aria-label="검색 화면 열기"><Search aria-hidden /></Link></div></header>
    {feed.isLoading ? <ListSkeleton /> : feed.isError ? <ErrorState onRetry={() => void feed.refetch()} /> : posts.length === 0 ? <EmptyState title="조건에 맞는 실천이 없어요" body={activeFilterCount ? "필터를 바꾸면 다른 실천을 만날 수 있어요." : "첫 번째 실천이 올라오면 여기에서 만날 수 있어요."} /> : <div className="feed-stack explore-feed-stack" aria-label="공개 실천 피드">{posts.map((post) => <FeedCard key={post.id} post={post} pending={cheer.isPending} onCheer={() => cheer.mutate(post)} onCopy={() => openImport(post)} />)}{feed.hasNextPage && <button className="load-more" onClick={() => void feed.fetchNextPage()} disabled={feed.isFetchingNextPage}>{feed.isFetchingNextPage ? "불러오는 중…" : "실천 더 보기"}</button>}</div>}
    {filterOpen && <FeedFilterSheet category={category} mode={mode} onClose={() => setFilterOpen(false)} onApply={applyFilter} />}
  </main>;
}

function FeedFilterSheet({ category, mode, onClose, onApply }: { category: string; mode: "recent" | "mix"; onClose: () => void; onApply: (category: string, mode: "recent" | "mix") => void }) {
  const [draftCategory, setDraftCategory] = useState(category);
  const [draftMode, setDraftMode] = useState(mode);
  const reset = () => { setDraftCategory("전체"); setDraftMode("recent"); };
  return <Sheet title="피드 필터" onClose={onClose}><div className="feed-filter-form"><fieldset><legend>관심사</legend><div className="feed-category-grid">{categoryOptions.map((option) => { const Icon = option.icon; const selected = draftCategory === option.value; return <button type="button" key={option.value} className={selected ? "selected" : ""} aria-pressed={selected} onClick={() => setDraftCategory(option.value)}><Icon aria-hidden /><span>{option.value}</span>{selected && <Check aria-hidden />}</button>; })}</div></fieldset><fieldset><legend>정렬</legend><div className="feed-sort-options"><button type="button" className={draftMode === "recent" ? "selected" : ""} aria-pressed={draftMode === "recent"} onClick={() => setDraftMode("recent")}><Clock3 aria-hidden /><span><b>최신순</b><small>새로 올라온 실천부터 봐요</small></span>{draftMode === "recent" && <Check aria-hidden />}</button><button type="button" className={draftMode === "mix" ? "selected" : ""} aria-pressed={draftMode === "mix"} onClick={() => setDraftMode("mix")}><Sparkles aria-hidden /><span><b>추천순</b><small>관심사에 가까운 실천을 봐요</small></span>{draftMode === "mix" && <Check aria-hidden />}</button></div></fieldset><div className="feed-filter-actions"><button type="button" className="filter-reset" onClick={reset}>초기화</button><button type="button" className="button" onClick={() => onApply(draftCategory, draftMode)}>필터 적용</button></div></div></Sheet>;
}
