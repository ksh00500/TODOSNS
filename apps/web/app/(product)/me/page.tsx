"use client";

import Link from "next/link";
import Image from "next/image";
import { FormEvent, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Award,
  ChevronRight,
  CopyPlus,
  Flame,
  HeartHandshake,
  ImagePlus,
  Pencil,
  Settings,
  Sparkles,
  Trophy,
} from "lucide-react";
import { apiFetch, uploadImage } from "@/lib/api";
import type { FeedPage, SessionUser, TodoListDto } from "@/lib/types";
import { useSession } from "@/components/app-providers";
import { AuthGate, ErrorState, ListSkeleton } from "@/components/states";
import { CloudMark } from "@/components/cloud-mark";
import { Sheet } from "@/components/sheet";

type Profile = SessionUser & {
  rank: string;
  _count: { followers: number; following: number; posts: number };
  stats: { completedCount: number; receivedCheers: number; copiedCount: number };
};

const interestOptions = ["운동", "공부", "독서", "식단", "수면", "마음 관리", "커리어", "일상 관리"];

export default function MePage() {
  const { status, refresh } = useSession();
  const client = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [notice, setNotice] = useState("");
  const profile = useQuery({
    queryKey: ["me", "profile"],
    queryFn: () => apiFetch<Profile>("/me"),
    enabled: status === "authenticated",
  });
  const lists = useQuery({
    queryKey: ["todo-lists"],
    queryFn: () => apiFetch<TodoListDto[]>("/todo-lists"),
    enabled: status === "authenticated",
  });
  const posts = useQuery({
    queryKey: ["me", "posts", profile.data?.handle],
    queryFn: () => apiFetch<FeedPage>(`/public/users/${profile.data?.handle}/posts?limit=6`),
    enabled: status === "authenticated" && Boolean(profile.data?.handle),
  });

  if (status === "loading") return <main className="app-page"><ListSkeleton /></main>;
  if (status === "guest") {
    return <main className="app-page"><AuthGate title="나의 기록은 로그인 후 확인할 수 있어요" /></main>;
  }
  if (profile.isError) {
    return <main className="app-page"><ErrorState onRetry={() => void profile.refetch()} /></main>;
  }
  const me = profile.data;
  if (!me) return <main className="app-page"><ListSkeleton /></main>;
  const nextRank =
    me.lifetimePower < 100
      ? 100
      : me.lifetimePower < 300
        ? 300
        : me.lifetimePower < 800
          ? 800
          : me.lifetimePower < 2000
            ? 2000
            : 5000;
  const rankProgress = Math.min(100, Math.round((me.lifetimePower / nextRank) * 100));

  return (
    <main className="app-page me-page">
      <header className="simple-header">
        <h1>마이</h1>
        <div className="header-actions">
          <button className="round-button" onClick={() => setEditing(true)} aria-label="프로필 편집">
            <Pencil />
          </button>
          <Link href="/settings" className="round-button" aria-label="설정">
            <Settings />
          </Link>
        </div>
      </header>
      {notice && <button className="notice" onClick={() => setNotice("")}>{notice}</button>}
      <section className="profile-card">
        <div className="profile-avatar">
          {me.avatarUrl ? (
            <Image src={me.avatarUrl} alt="" width={82} height={82} unoptimized />
          ) : (
            me.nickname.slice(0, 1)
          )}
          <CloudMark compact />
        </div>
        <h2>{me.nickname}</h2>
        <p>@{me.handle}</p>
        <span>{me.bio || "작은 실천을 오래 이어가는 중이에요."}</span>
        <div className="profile-numbers">
          <div><b>{me._count.posts}</b><small>공유</small></div>
          <Link href={`/people/${me.handle}/connections?type=followers`}><b>{me._count.followers}</b><small>팔로워</small></Link>
          <Link href={`/people/${me.handle}/connections?type=following`}><b>{me._count.following}</b><small>팔로잉</small></Link>
        </div>
      </section>
      <section className="rank-card">
        <span className="rank-cloud"><CloudMark /><Sparkles /></span>
        <div>
          <small>나의 뭉실 등급</small>
          <h3>{me.rank}<b>{me.lifetimePower.toLocaleString()} 뭉실</b></h3>
          <div className="rank-progress"><i style={{ width: `${rankProgress}%` }} /></div>
          <p>다음 구름까지 {Math.max(0, nextRank - me.lifetimePower)} 뭉실</p>
        </div>
        <ChevronRight />
      </section>
      <div className="stat-grid three">
        <article><span className="blue"><Flame /></span><div><small>완료한 실천</small><b>{me.stats.completedCount}</b></div></article>
        <article><span className="pink"><HeartHandshake /></span><div><small>받은 응원</small><b>{me.stats.receivedCheers}</b></div></article>
        <article><span className="mint"><CopyPlus /></span><div><small>가져간 실천</small><b>{me.stats.copiedCount}</b></div></article>
      </div>
      <div className="section-heading spaced">
        <div><h2>나의 루틴 보드</h2><span>{lists.data?.length ?? 0}개의 루틴</span></div>
        <Link href="/todos" className="soft-button">전체보기 <ChevronRight /></Link>
      </div>
      <div className="my-routines">
        {lists.data?.slice(0, 3).map((list, index) => (
          <article className={["blue", "pink", "mint"][index % 3]} key={list.id}>
            <span>{list.items.length}개의 TODO</span>
            <h3>{list.title}</h3>
            <p>{list.description || "꾸준히 이어가는 나만의 루틴"}</p>
            <small><CopyPlus />{list.copyCount ?? list._count?.copies ?? 0}명이 가져감</small>
          </article>
        ))}
        {!lists.isLoading && !lists.data?.length && (
          <div className="inline-empty">아직 만든 루틴이 없어요.</div>
        )}
      </div>
      <section className="shared-records">
        <div className="section-heading spaced">
          <div><h2>공유한 실천</h2><span>{posts.data?.items.length ?? 0}개의 최근 기록</span></div>
        </div>
        {posts.isLoading ? (
          <ListSkeleton count={2} />
        ) : !posts.data?.items.length ? (
          <div className="inline-empty">완료한 TODO를 공유하면 이곳에 기록돼요.</div>
        ) : (
          <div className="profile-post-grid">
            {posts.data.items.map((post) => (
              <Link href={`/posts/${post.id}`} key={post.id}>
                {post.thumbnailUrl || post.mediaUrl ? (
                  <Image src={post.thumbnailUrl ?? post.mediaUrl!} alt="" width={180} height={150} unoptimized />
                ) : (
                  <CloudMark />
                )}
                <b>{post.todoList?.title ?? post.todos[0]?.title}</b>
                <small>{post.cheerCount}개의 응원</small>
              </Link>
            ))}
          </div>
        )}
      </section>
      <section className="badge-section">
        <div className="section-heading"><div><h2>나의 배지</h2><span>실천으로 얻은 기록</span></div></div>
        <div className="badges">
          <span className={me._count.posts > 0 ? "" : "locked"}><Award /><b>첫 공유</b></span>
          <span className={(lists.data?.length ?? 0) > 0 ? "" : "locked"}><Trophy /><b>루틴 메이커</b></span>
          <span className={me.lifetimePower >= 100 ? "" : "locked"}><Award /><b>조각구름</b></span>
        </div>
      </section>
      {editing && (
        <ProfileEditor
          profile={me}
          onClose={() => setEditing(false)}
          onSaved={async () => {
            setEditing(false);
            setNotice("프로필을 저장했어요.");
            await Promise.all([
              client.invalidateQueries({ queryKey: ["me"] }),
              refresh(),
            ]);
          }}
        />
      )}
    </main>
  );
}

function ProfileEditor({
  profile,
  onClose,
  onSaved,
}: {
  profile: Profile;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [nickname, setNickname] = useState(profile.nickname);
  const [bio, setBio] = useState(profile.bio ?? "");
  const [interests, setInterests] = useState(profile.interests ?? []);
  const [file, setFile] = useState<File | null>(null);
  const [progress, setProgress] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const avatarMediaId = file ? await uploadImage(file, setProgress) : undefined;
      await apiFetch("/me", {
        method: "PATCH",
        body: JSON.stringify({ nickname, bio, interests, avatarMediaId }),
      });
      await onSaved();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "프로필을 저장하지 못했어요.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet title="프로필 편집" onClose={onClose}>
      <form className="composer-form" onSubmit={submit}>
        <label className="photo-picker compact">
          <input type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif" onChange={(event) => setFile(event.target.files?.[0] ?? null)} />
          <ImagePlus />
          <span><b>{file ? file.name : "프로필 사진 바꾸기"}</b><small>정사각형 사진을 추천해요</small></span>
        </label>
        {busy && file && <div className="upload-progress"><i style={{ width: `${progress}%` }} /><span>{progress}%</span></div>}
        <label className="field">
          <span>닉네임</span>
          <input value={nickname} onChange={(event) => setNickname(event.target.value)} minLength={2} maxLength={20} required />
        </label>
        <label className="field">
          <span>소개</span>
          <textarea value={bio} onChange={(event) => setBio(event.target.value)} maxLength={160} placeholder="어떤 실천을 이어가고 있나요?" />
        </label>
        <fieldset className="profile-interest-picker">
          <legend>관심사</legend>
          {interestOptions.map((interest) => (
            <button
              type="button"
              key={interest}
              className={interests.includes(interest) ? "active" : ""}
              onClick={() => setInterests((current) => current.includes(interest) ? current.filter((item) => item !== interest) : [...current, interest])}
            >
              {interest}
            </button>
          ))}
        </fieldset>
        {error && <p className="form-error">{error}</p>}
        <button className="button full" disabled={busy}>{busy ? "저장 중…" : "프로필 저장"}</button>
      </form>
    </Sheet>
  );
}
