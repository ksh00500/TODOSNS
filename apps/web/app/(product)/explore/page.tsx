import { Suspense } from "react";
import { redirect } from "next/navigation";
import { ExploreFeed } from "@/components/explore-feed";
import { ListSkeleton } from "@/components/states";

type ExplorePageProps = { searchParams: Promise<Record<string, string | string[] | undefined>> };
const first = (value: string | string[] | undefined) => Array.isArray(value) ? value[0] : value;

export default async function ExplorePage({ searchParams }: ExplorePageProps) {
  const params = await searchParams;
  const legacyQuery = first(params.query)?.trim();
  if (legacyQuery) {
    const next = new URLSearchParams({ query: legacyQuery });
    const type = first(params.type);
    if (type) next.set("type", type);
    redirect(`/explore/search?${next}`);
  }
  return <Suspense fallback={<main className="app-page"><ListSkeleton /></main>}><ExploreFeed /></Suspense>;
}
