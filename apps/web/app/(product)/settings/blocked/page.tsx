"use client";

import Link from "next/link";
import { useState } from "react";
import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Ban, ChevronLeft } from "lucide-react";
import type { BlockedUserPageDto } from "@mungsil/contracts";
import { apiFetch, userErrorMessage } from "@/lib/api";
import { useSession } from "@/components/app-providers";
import { AuthGate, EmptyState, ErrorState, ListSkeleton } from "@/components/states";

export default function BlockedUsersPage() {
  const { status } = useSession();
  const client = useQueryClient();
  const [error, setError] = useState("");
  const blocks = useInfiniteQuery({
    queryKey: ["blocked-users"], initialPageParam: "",
    queryFn: ({ pageParam }) => apiFetch<BlockedUserPageDto>(`/social/blocks?limit=20${pageParam ? `&cursor=${encodeURIComponent(pageParam)}` : ""}`),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    enabled: status === "authenticated",
  });
  const unblock = useMutation({
    mutationFn: (id: string) => apiFetch(`/social/blocks/${encodeURIComponent(id)}`, { method: "DELETE" }),
    onSuccess: async () => {
      setError("");
      await client.invalidateQueries();
    },
    onError: (cause) => setError(userErrorMessage(cause, "차단을 해제하지 못했어요. 다시 시도해주세요.")),
  });
  if (status === "guest") return <main className="app-page"><AuthGate /></main>;
  const items = blocks.data?.pages.flatMap((page) => page.items) ?? [];
  return <main className="app-page blocked-users-page">
    <header className="simple-header"><Link className="back-link" href="/settings" aria-label="설정으로 돌아가기"><ChevronLeft aria-hidden /></Link><div><span>내가 차단한 계정</span><h1>차단한 사용자</h1></div></header>
    <p className="subtle-copy">차단을 해제해도 이전 팔로우는 복원되지 않아요.</p>
    {error && <p className="form-error" role="alert">{error}</p>}
    {blocks.isPending ? <ListSkeleton /> : blocks.isError ? <ErrorState onRetry={() => void blocks.refetch()} /> : !items.length ? <EmptyState title="차단한 사용자가 없어요" body="차단한 사용자가 생기면 여기에서 관리할 수 있어요." /> : <div className="blocked-user-list">{items.map((item) => <article key={item.userId} className="blocked-user-row"><Ban aria-hidden /><div><b>{item.user?.nickname ?? "이용할 수 없는 사용자"}</b><small>{item.user ? `@${item.user.handle}` : "탈퇴했거나 접근할 수 없는 계정"}</small></div><button type="button" disabled={unblock.isPending} onClick={() => { setError(""); unblock.mutate(item.userId); }}>{unblock.isPending && unblock.variables === item.userId ? "처리 중…" : "차단 해제"}</button></article>)}</div>}
    {blocks.hasNextPage && <button className="load-more" disabled={blocks.isFetchingNextPage} onClick={() => void blocks.fetchNextPage()}>{blocks.isFetchingNextPage ? "불러오는 중…" : "더 보기"}</button>}
    {blocks.isFetchNextPageError && <p className="form-error" role="alert">목록을 더 불러오지 못했어요. <button type="button" onClick={() => void blocks.fetchNextPage()}>다시 시도</button></p>}
  </main>;
}
