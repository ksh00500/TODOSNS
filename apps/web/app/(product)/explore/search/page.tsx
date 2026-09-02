"use client";

import { FormEvent, Suspense, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight, Clock3, Hash, Layers3, Search, Sparkles, Trophy, UserRound, X } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { apiFetch } from "@/lib/api";
import type { FeedPost, SearchResults, SearchSuggestions } from "@/lib/types";
import { useSession } from "@/components/app-providers";
import { FeedCard } from "@/components/feed-card";
import { EmptyState, ErrorState, ListSkeleton } from "@/components/states";

const RECENT_SEARCH_KEY = "mungsil_recent_searches";
const RECENT_SEARCH_EVENT = "mungsil:recent-searches";
type SearchTab = "all" | "users" | "posts" | "routines" | "tags" | "challenges";
const SEARCH_TABS: SearchTab[] = ["all", "users", "posts", "routines", "tags", "challenges"];

const subscribeRecentSearches = (notify: () => void) => {
  window.addEventListener("storage", notify);
  window.addEventListener(RECENT_SEARCH_EVENT, notify);
  return () => { window.removeEventListener("storage", notify); window.removeEventListener(RECENT_SEARCH_EVENT, notify); };
};
const recentSearchSnapshot = () => window.localStorage.getItem(RECENT_SEARCH_KEY) ?? "[]";
const writeRecentSearches = (items: string[]) => { window.localStorage.setItem(RECENT_SEARCH_KEY, JSON.stringify(items)); window.dispatchEvent(new Event(RECENT_SEARCH_EVENT)); };

export default function ExploreSearchPage() { return <Suspense fallback={<main className="app-page"><ListSkeleton /></main>}><ExploreSearchContent /></Suspense>; }

function ExploreSearchContent() {
  const { status } = useSession();
  const router = useRouter();
  const params = useSearchParams();
  const queryClient = useQueryClient();
  const searchQuery = params.get("query")?.trim() ?? "";
  const requestedTab = params.get("type") as SearchTab | null;
  const searchTab: SearchTab = requestedTab && SEARCH_TABS.includes(requestedTab) ? requestedTab : "all";
  const recentSearchValue = useSyncExternalStore(subscribeRecentSearches, recentSearchSnapshot, () => "[]");
  let recentSearches: string[] = [];
  try { recentSearches = JSON.parse(recentSearchValue) as string[]; } catch { recentSearches = []; }

  const suggestions = useQuery({ queryKey: ["search-suggestions"], queryFn: () => apiFetch<SearchSuggestions>("/public/search/suggestions?limit=10"), staleTime: 60_000 });
  const search = useQuery({ queryKey: ["public-search", searchQuery], queryFn: () => apiFetch<SearchResults>(`/public/search?query=${encodeURIComponent(searchQuery)}&limit=20`), enabled: searchQuery.length >= 1 });
  const currentPath = `/explore/search${params.size ? `?${params}` : ""}`;
  const requireLogin = () => { router.push(`/start?returnTo=${encodeURIComponent(currentPath)}`); };
  const cheer = useMutation({ mutationFn: (post: FeedPost) => apiFetch(`/feed/posts/${post.id}/cheer`, { method: "POST" }), onMutate: (post) => { if (status !== "authenticated") { requireLogin(); throw new Error("LOGIN_REQUIRED"); } return post; }, onSuccess: () => { void queryClient.invalidateQueries({ queryKey: ["public-search", searchQuery] }); }, onError: (error) => { if (error instanceof Error && error.message === "LOGIN_REQUIRED") return; } });

  const replaceParams = (changes: Record<string, string | null>) => {
    const next = new URLSearchParams(params.toString());
    Object.entries(changes).forEach(([key, value]) => value ? next.set(key, value) : next.delete(key));
    router.replace(`/explore/search${next.size ? `?${next}` : ""}`);
  };
  const rememberSearch = (value: string) => {
    const next = [value, ...recentSearches.filter((item) => item !== value)].slice(0, 6);
    writeRecentSearches(next);
  };
  const runSearch = (value: string, preferredTab?: SearchTab) => {
    const query = value.trim();
    if (!query) { replaceParams({ query: null, type: null }); return; }
    rememberSearch(query);
    const inferred = query.startsWith("#") ? "tags" : query.startsWith("@") ? "users" : preferredTab ?? "all";
    replaceParams({ query, type: inferred });
  };
  const openImport = (post: FeedPost) => { if (status !== "authenticated") { requireLogin(); return; } router.push(`/todos/import?postId=${post.id}`); };

  return <main className="app-page explore-search-page"><header className="search-page-header"><Link href="/explore" aria-label="피드로 돌아가기"><ArrowLeft aria-hidden /><span>피드</span></Link><div><span>탐색</span><h1>검색</h1></div></header><SearchBox key={searchQuery} initialValue={searchQuery} onSearch={runSearch} onClear={() => replaceParams({ query: null, type: null })} />
    {searchQuery ? <SearchExperience query={searchQuery} tab={searchTab} data={search.data} loading={search.isLoading} error={search.isError} onRetry={() => void search.refetch()} onTab={(tab) => replaceParams({ type: tab })} onSearch={runSearch} onPerson={(handle) => router.push(`/people/${handle}`)} onChallenge={(id) => router.push(`/challenges/${id}`)} onCheer={(post) => cheer.mutate(post)} onCopy={openImport} pending={cheer.isPending} /> : <section className="search-discovery" aria-label="검색 추천">
      {recentSearches.length > 0 && <div className="search-discovery-block"><div><Clock3 aria-hidden /><b>최근 검색</b><button onClick={() => writeRecentSearches([])}>모두 지우기</button></div><div className="search-suggestion-row">{recentSearches.map((item) => <button key={item} onClick={() => runSearch(item)}>{item}</button>)}</div></div>}
      {suggestions.isLoading ? <div className="search-tab-skeleton" /> : suggestions.data?.trendingTags.length ? <div className="search-discovery-block"><div><Sparkles aria-hidden /><b>요즘 많이 찾는 태그</b></div><div className="trending-tag-grid">{suggestions.data.trendingTags.map((tag, index) => <button key={tag.id} onClick={() => runSearch(`#${tag.name}`, "tags")}><i>{index + 1}</i><span>#{tag.name}<small>{tag.postCount}개 게시물</small></span><ArrowRight aria-hidden /></button>)}</div></div> : suggestions.isError ? <ErrorState onRetry={() => void suggestions.refetch()} /> : <EmptyState title="아직 인기 태그가 없어요" body="새로운 실천이 게시되면 여기에서 소개할게요." />}
    </section>}
  </main>;
}

function SearchBox({ initialValue, onSearch, onClear }: { initialValue: string; onSearch: (value: string) => void; onClear: () => void }) {
  const [value, setValue] = useState(initialValue);
  const submit = (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); onSearch(value); };
  return <form className="explore-search" role="search" onSubmit={submit}><Search aria-hidden /><input value={value} onChange={(event) => setValue(event.target.value)} maxLength={60} placeholder="사용자, 실천, 루틴, #해시태그 검색" aria-label="통합 검색" />{value && <button className="search-clear" type="button" aria-label="검색어 지우기" onClick={() => { setValue(""); onClear(); }}><X aria-hidden /></button>}<button className="search-submit" type="submit">검색</button></form>;
}

function SearchExperience({ query, tab, data, loading, error, pending, onRetry, onTab, onSearch, onPerson, onChallenge, onCheer, onCopy }: { query: string; tab: SearchTab; data?: SearchResults; loading: boolean; error: boolean; pending: boolean; onRetry: () => void; onTab: (tab: SearchTab) => void; onSearch: (value: string, tab?: SearchTab) => void; onPerson: (handle: string) => void; onChallenge: (id: string) => void; onCheer: (post: FeedPost) => void; onCopy: (post: FeedPost) => void }) {
  if (loading) return <><div className="search-tab-skeleton" /><ListSkeleton /></>;
  if (error || !data) return <ErrorState onRetry={onRetry} />;
  const tabs: Array<{ id: SearchTab; label: string; count: number }> = [
    { id: "all", label: "통합", count: data.counts.all }, { id: "users", label: "사용자", count: data.counts.users }, { id: "posts", label: "실천", count: data.counts.posts }, { id: "routines", label: "루틴", count: data.counts.routines }, { id: "tags", label: "해시태그", count: data.counts.tags }, { id: "challenges", label: "챌린지", count: data.counts.challenges },
  ];
  const activeCount = tabs.find((item) => item.id === tab)?.count ?? 0;
  return <section className="search-results" aria-label={`${query} 검색 결과`}><div className="search-summary"><span><Search aria-hidden /></span><div><b>‘{query}’ 검색 결과</b><small>{data.counts.all}개의 공개 결과를 찾았어요</small></div></div><div className="search-tabs" role="tablist" aria-label="검색 결과 종류">{tabs.map((item) => <button key={item.id} role="tab" aria-selected={tab === item.id} className={tab === item.id ? "active" : ""} onClick={() => onTab(item.id)}>{item.label}<span>{item.count}</span></button>)}</div>
    {data.counts.all === 0 ? <EmptyState title="검색 결과가 없어요" body="다른 단어를 쓰거나 #해시태그로 찾아보세요." /> : activeCount === 0 ? <EmptyState title="이 종류의 결과는 없어요" body="통합 결과에서 다른 종류를 확인해보세요." /> : <div className="search-result-content">
      {(tab === "all" || tab === "users") && data.users.length > 0 && <ResultSection title="사용자" icon={UserRound} count={data.counts.users} onMore={tab === "all" ? () => onTab("users") : undefined}><div className="people-results">{data.users.map((person) => <button key={person.id} onClick={() => onPerson(person.handle)}><span className="avatar">{person.nickname.slice(0, 1)}</span><span><b>{person.nickname}</b><small>@{person.handle} · {person.cloudRank}</small></span><ArrowRight aria-hidden /></button>)}</div></ResultSection>}
      {(tab === "all" || tab === "tags") && data.tags.length > 0 && <ResultSection title="해시태그" icon={Hash} count={data.counts.tags} onMore={tab === "all" ? () => onTab("tags") : undefined}><div className="hashtag-results">{data.tags.map((tag) => <button key={tag.id} onClick={() => onSearch(`#${tag.name}`, "tags")}><Hash aria-hidden /><span><b>#{tag.name}</b><small>{tag.postCount}개 공개 게시물</small></span></button>)}</div></ResultSection>}
      {(tab === "all" || tab === "posts") && data.posts.length > 0 && <ResultSection title="실천" icon={Search} count={data.counts.posts} onMore={tab === "all" ? () => onTab("posts") : undefined}><div className="feed-stack">{data.posts.slice(0, tab === "all" ? 3 : undefined).map((post) => <FeedCard key={post.id} post={post} pending={pending} onCheer={() => onCheer(post)} onCopy={() => onCopy(post)} />)}</div></ResultSection>}
      {(tab === "all" || tab === "routines") && data.routines.length > 0 && <ResultSection title="루틴" icon={Layers3} count={data.counts.routines} onMore={tab === "all" ? () => onTab("routines") : undefined}><div className="feed-stack">{data.routines.slice(0, tab === "all" ? 2 : undefined).map((post) => <FeedCard key={post.id} post={post} pending={pending} onCheer={() => onCheer(post)} onCopy={() => onCopy(post)} />)}</div></ResultSection>}
      {(tab === "all" || tab === "challenges") && data.challenges.length > 0 && <ResultSection title="챌린지" icon={Trophy} count={data.counts.challenges} onMore={tab === "all" ? () => onTab("challenges") : undefined}><div className="challenge-search-results">{data.challenges.map((challenge) => <button key={challenge.id} onClick={() => onChallenge(challenge.id)}><span><Trophy aria-hidden /></span><div><b>{challenge.title}</b><small>{challenge.kind === "OFFICIAL" ? "공식" : "커뮤니티"} · {challenge._count.participants}명 참여</small><p>{challenge.description}</p></div><ArrowRight aria-hidden /></button>)}</div></ResultSection>}
    </div>}
  </section>;
}

function ResultSection({ title, icon: Icon, count, onMore, children }: { title: string; icon: typeof Search; count: number; onMore?: () => void; children: React.ReactNode }) {
  return <section className="typed-result-section"><header><span><Icon aria-hidden /></span><div><h2>{title}</h2><small>{count}개 결과</small></div>{onMore && <button onClick={onMore}>더보기<ArrowRight aria-hidden /></button>}</header>{children}</section>;
}
