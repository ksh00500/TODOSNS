"use client";

import Link from "next/link";
import Image from "next/image";
import { Check, CopyPlus, HeartHandshake, MessageCircle } from "lucide-react";
import type { FeedPost } from "@/lib/types";

const relative = (value: string) => { const minutes = Math.floor((Date.now() - new Date(value).getTime()) / 60_000); if (minutes < 1) return "방금"; if (minutes < 60) return `${minutes}분 전`; if (minutes < 1440) return `${Math.floor(minutes / 60)}시간 전`; return new Date(value).toLocaleDateString("ko-KR", { month: "short", day: "numeric" }); };

export function FeedCard({ post, onCheer, onCopy, pending }: { post: FeedPost; onCheer: () => void; onCopy: () => void; pending?: boolean }) {
  const todoTitle = post.todoList?.title ?? post.todos[0]?.title ?? "오늘의 실천";
  const category = post.todos[0]?.category ?? "루틴";
  return <article className="feed-card">
    <header><Link href={`/people/${post.author.handle}`} className="avatar">{post.author.avatarUrl ? <Image src={post.author.avatarUrl} alt="" width={42} height={42} unoptimized /> : post.author.nickname.slice(0, 1)}</Link><div><Link href={`/people/${post.author.handle}`}><b>{post.author.nickname}</b></Link><span>@{post.author.handle} · {relative(post.createdAt)}</span></div><small>{post.author.cloudRank}</small></header>
    {post.mediaUrl ? <Link href={`/posts/${post.id}`} className="feed-photo"><Image src={post.mediaUrl} alt={`${post.author.nickname}님의 ${todoTitle} 인증`} width={394} height={260} unoptimized /></Link> : <Link href={`/posts/${post.id}`} className="feed-photo placeholder"><Check /><span>{post.todoList ? `${post.todoList.items.length}개로 만든 루틴` : "오늘 완료한 TODO"}</span><b>{todoTitle}</b></Link>}
    <div className="feed-body"><div className="feed-todo-title"><span>{category}</span><Link href={`/posts/${post.id}`}>{todoTitle}</Link><small>{post.todoList ? `TODO ${post.todoList.items.length}개` : "단일 TODO"}</small></div>{post.caption && <p>{post.caption}</p>}{post.hashtags.length > 0 && <div className="feed-tags" aria-label="해시태그">{post.hashtags.map((tag) => <Link key={tag} href={`/explore/search?query=${encodeURIComponent(`#${tag}`)}&type=tags`}>#{tag}</Link>)}</div>}<div className="feed-copy-count"><Check /><span>{post.copyCount}명이 자신의 하루에 담았어요</span></div></div>
    <footer><button className={post.cheered ? "active" : ""} onClick={onCheer} disabled={pending}><HeartHandshake /> <span>{post.cheerCount}</span></button><Link href={`/posts/${post.id}`}><MessageCircle /> <span>{post.commentCount}</span></Link><button className="copy-primary" onClick={onCopy} disabled={pending}><CopyPlus /> 나도 할래요</button></footer>
  </article>;
}
