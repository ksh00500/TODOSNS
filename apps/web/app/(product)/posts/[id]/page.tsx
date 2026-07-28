"use client";

import { FormEvent, use, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { MessageCircle, Send } from "lucide-react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/api";
import type { Comment, FeedPost } from "@/lib/types";
import { useSession } from "@/components/app-providers";
import { FeedCard } from "@/components/feed-card";
import { EmptyState, ErrorState, ListSkeleton } from "@/components/states";

export default function PostPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params); const { status } = useSession(); const router = useRouter(); const client = useQueryClient(); const [body, setBody] = useState(""); const endpoint = status === "authenticated" ? "/feed/posts" : "/public/posts";
  const post = useQuery({ queryKey: ["post", id, endpoint], queryFn: () => apiFetch<FeedPost>(`${endpoint}/${id}`) }); const comments = useQuery({ queryKey: ["comments", id, endpoint], queryFn: () => apiFetch<Comment[]>(`${endpoint}/${id}/comments`) });
  const requireLogin = () => router.push(`/start?returnTo=${encodeURIComponent(`/posts/${id}`)}`);
  const cheer = useMutation({ mutationFn: () => { if (status !== "authenticated") { requireLogin(); throw new Error("LOGIN_REQUIRED"); } return apiFetch(`/feed/posts/${id}/cheer`, { method: "POST" }); }, onSuccess: () => { void client.invalidateQueries({ queryKey: ["post", id] }); } });
  const openImport = () => { if (status !== "authenticated") { requireLogin(); return; } router.push(`/todos/import?postId=${id}`); };
  const comment = useMutation({ mutationFn: () => apiFetch(`/feed/posts/${id}/comments`, { method: "POST", body: JSON.stringify({ body: body.trim() }) }), onSuccess: () => { setBody(""); void comments.refetch(); void client.invalidateQueries({ queryKey: ["post", id] }); } });
  const submit = (event: FormEvent) => { event.preventDefault(); if (status !== "authenticated") { requireLogin(); return; } if (body.trim()) comment.mutate(); };
  return <main className="app-page post-page"><header className="simple-header"><div><span>실천 상세</span><h1>오늘의 기록</h1></div></header>{post.isLoading ? <ListSkeleton /> : post.isError || !post.data ? <ErrorState onRetry={() => void post.refetch()} /> : <FeedCard post={post.data} pending={cheer.isPending} onCheer={() => cheer.mutate()} onCopy={openImport} />}
    <section className="comments-section"><div className="section-heading"><div><h2>따뜻한 한마디</h2><span>{comments.data?.length ?? 0}개의 응원</span></div><MessageCircle /></div><div className="quick-comments">{["응원해요!", "꾸준함이 멋져요", "저도 해볼래요"].map((text) => <button key={text} onClick={() => setBody(text)}>{text}</button>)}</div>{comments.isLoading ? <ListSkeleton count={2} /> : comments.isError ? <ErrorState onRetry={() => void comments.refetch()} /> : !comments.data?.length ? <EmptyState title="첫 응원을 기다리고 있어요" body="부담 없이 따뜻한 한마디를 남겨보세요." /> : <div className="comment-list">{comments.data.map((item) => <article key={item.id}><span className="avatar">{item.author.nickname.slice(0,1)}</span><div><b>{item.author.nickname}<small>@{item.author.handle}</small></b><p>{item.body}</p><time>{new Date(item.createdAt).toLocaleDateString("ko-KR")}</time></div></article>)}</div>}<form className="comment-form" onSubmit={submit}><input value={body} onChange={(event) => setBody(event.target.value)} maxLength={300} placeholder="가볍게 응원 한마디 남기기" /><button aria-label="댓글 보내기" disabled={!body.trim() || comment.isPending}><Send /></button></form></section>
  </main>;
}
