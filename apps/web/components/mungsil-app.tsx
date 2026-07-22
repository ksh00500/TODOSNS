"use client";

import {
  Bell,
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleUserRound,
  Clock3,
  Compass,
  CopyPlus,
  Ellipsis,
  HeartHandshake,
  House,
  ImagePlus,
  LockKeyhole,
  MessageCircle,
  MessagesSquare,
  MoreHorizontal,
  Plus,
  Search,
  Send,
  Settings,
  ShieldCheck,
  Sparkles,
  Trophy,
  Users,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { apiFetch } from "../lib/api";
import { CloudMark } from "./cloud-mark";

type TabId = "today" | "explore" | "planner" | "messages" | "profile";
type ModalKind = "todo" | "share" | "copy" | null;
type Todo = {
  id: string | number;
  title: string;
  category: string;
  time: string;
  done: boolean;
  repeat?: string;
};
type FeedPost = {
  id: string | number;
  sourceTodoId?: string;
  author: string;
  handle: string;
  rank: string;
  time: string;
  caption: string;
  todo: string;
  category: string;
  cheers: number;
  comments: number;
  copies: number;
  tone: string;
  cheered?: boolean;
};

const initialTodos: Todo[] = [
  { id: 1, title: "출근 전 20분 산책", category: "운동", time: "07:30", done: true, repeat: "평일" },
  { id: 2, title: "영어 단어 30개 복습", category: "공부", time: "12:30", done: true },
  { id: 3, title: "물 2L 마시기", category: "건강", time: "하루 종일", done: false },
  { id: 4, title: "미뤄둔 이메일 답장", category: "커리어", time: "18:00", done: false },
  { id: 5, title: "잠들기 전 책 10쪽", category: "마음", time: "22:30", done: false, repeat: "매일" },
];

const initialFeed: FeedPost[] = [
  {
    id: 1,
    author: "서윤",
    handle: "@seoyoon.day",
    rank: "뭉게구름",
    time: "18분 전",
    caption: "비가 와도 우산 쓰고 걸었어요. 완벽하지 않아도 밖으로 나온 것에 의미를!",
    todo: "퇴근 후 30분 걷기",
    category: "운동",
    cheers: 84,
    comments: 12,
    copies: 37,
    tone: "walk",
  },
  {
    id: 2,
    author: "민호",
    handle: "@slow.mino",
    rank: "솜구름",
    time: "1시간 전",
    caption: "오늘도 딱 한 장. 작은 기록이 쌓이는 중입니다.",
    todo: "하루 한 장 드로잉",
    category: "취미",
    cheers: 46,
    comments: 7,
    copies: 19,
    tone: "draw",
  },
  {
    id: 3,
    author: "하린",
    handle: "@harin.study",
    rank: "노을구름",
    time: "2시간 전",
    caption: "퇴근하고 집중하기 어렵다면 15분 타이머부터 시작해보세요.",
    todo: "15분만 자격증 공부하기",
    category: "공부",
    cheers: 121,
    comments: 23,
    copies: 68,
    tone: "study",
  },
];

const challenges = [
  { id: 1, kind: "공식", title: "14일 아침 걷기", meta: "1,248명 참여", days: "D-9", progress: 5, total: 14, tone: "morning" },
  { id: 2, kind: "비공식", title: "매일 책 10쪽", meta: "86명 참여", days: "D-21", progress: 8, total: 30, tone: "book" },
  { id: 3, kind: "공식", title: "물 한 잔으로 시작", meta: "3,102명 참여", days: "D-4", progress: 3, total: 7, tone: "water" },
];

const categoryColors: Record<string, string> = {
  운동: "mint",
  공부: "violet",
  건강: "blue",
  커리어: "orange",
  마음: "pink",
  취미: "yellow",
};

export function MungsilApp() {
  const [tab, setTab] = useState<TabId>("today");
  const [todos, setTodos] = useState(initialTodos);
  const [feed, setFeed] = useState(initialFeed);
  const [modal, setModal] = useState<ModalKind>(null);
  const [draftTitle, setDraftTitle] = useState("");
  const [draftCaption, setDraftCaption] = useState("");
  const [selectedTodo, setSelectedTodo] = useState<Todo | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [joined, setJoined] = useState<number[]>([1, 2]);
  const completed = todos.filter((todo) => todo.done).length;
  const progress = Math.round((completed / todos.length) * 100);
  const connected = typeof window !== "undefined" && Boolean(window.localStorage.getItem("mungsil_access_token"));

  useEffect(() => {
    if (!connected) return;
    const today = new Date(); const from = new Date(today); from.setHours(0, 0, 0, 0); const to = new Date(today); to.setHours(23, 59, 59, 999);
    Promise.all([
      apiFetch<Array<{ id: string; title: string; category: string; dueDate: string; completedAt: string | null; repeatRule?: string }>>(`/todos?from=${from.toISOString()}&to=${to.toISOString()}`),
      apiFetch<{ items: Array<{ id: string; caption?: string; createdAt: string; author: { nickname: string; handle: string }; rank: string; cheered: boolean; _count: { cheers: number; comments: number }; todos: Array<{ todo: { id: string; title: string; category: string; copies?: unknown[] } }> }> }>("/feed"),
    ]).then(([todoRows, feedRows]) => {
      setTodos(todoRows.map((todo) => ({ id: todo.id, title: todo.title, category: todo.category, time: new Date(todo.dueDate).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" }), done: Boolean(todo.completedAt), repeat: todo.repeatRule })));
      setFeed(feedRows.items.map((post) => ({ id: post.id, sourceTodoId: post.todos[0]?.todo.id, author: post.author.nickname, handle: `@${post.author.handle}`, rank: post.rank, time: new Date(post.createdAt).toLocaleDateString("ko-KR"), caption: post.caption ?? "오늘의 작은 실천을 완료했어요.", todo: post.todos[0]?.todo.title ?? "완료한 TODO", category: post.todos[0]?.todo.category ?? "생활", cheers: post._count.cheers, comments: post._count.comments, copies: 0, tone: "sky", cheered: post.cheered })));
    }).catch(() => showToast("서버 연결을 확인해주세요"));
  }, [connected]);

  const showToast = (message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(null), 2200);
  };

  const toggleTodo = async (todo: Todo) => {
    if (connected && !todo.done) await apiFetch(`/todos/${todo.id}/complete`, { method: "POST", body: JSON.stringify({ share: false }) }).catch((error) => showToast(error.message));
    setTodos((current) => current.map((item) => (item.id === todo.id ? { ...item, done: !item.done } : item)));
    if (!todo.done) {
      setSelectedTodo({ ...todo, done: true });
      setDraftCaption("");
      window.setTimeout(() => setModal("share"), 180);
    }
  };

  const openTodoModal = (title = "", kind: ModalKind = "todo") => {
    setDraftTitle(title);
    setModal(kind);
  };

  const saveTodo = async () => {
    if (!draftTitle.trim()) return;
    if (connected) {
      try {
        const created = modal === "copy" && selectedTodo?.id
          ? await apiFetch<{ id: string }>(`/todos/${selectedTodo.id}/clone`, { method: "POST", body: JSON.stringify({ title: draftTitle.trim(), dueDate: new Date().toISOString() }) })
          : await apiFetch<{ id: string }>("/todos", { method: "POST", body: JSON.stringify({ title: draftTitle.trim(), dueDate: new Date().toISOString() }) });
        setTodos((current) => [...current, { id: created.id, title: draftTitle.trim(), category: "생활", time: "시간 없음", done: false }]);
        setModal(null); showToast(modal === "copy" ? "내 TODO에 가져왔어요" : "새 TODO를 추가했어요"); return;
      } catch (error) { showToast(error instanceof Error ? error.message : "저장하지 못했어요"); return; }
    }
    setTodos((current) => [
      ...current,
      { id: Date.now(), title: draftTitle.trim(), category: "생활", time: "시간 없음", done: false },
    ]);
    setModal(null);
    showToast(modal === "copy" ? "내 TODO에 가져왔어요" : "새 TODO를 추가했어요");
  };

  const shareTodo = async () => {
    if (!selectedTodo) return;
    if (connected) {
      try { await apiFetch(`/todos/${selectedTodo.id}/complete`, { method: "POST", body: JSON.stringify({ share: true, caption: draftCaption }) }); }
      catch (error) { showToast(error instanceof Error ? error.message : "공유하지 못했어요"); return; }
    }
    const newPost: FeedPost = {
      id: Date.now(),
      author: "지우",
      handle: "@jiwoo.cloud",
      rank: "솜구름",
      time: "방금",
      caption: draftCaption || "오늘의 작은 실천을 완료했어요.",
      todo: selectedTodo.title,
      category: selectedTodo.category,
      cheers: 0,
      comments: 0,
      copies: 0,
      tone: "mine",
    };
    setFeed((current) => [newPost, ...current]);
    setModal(null);
    showToast("오늘의 실천을 공유했어요");
  };

  const cheer = (id: string | number) => {
    if (connected) void apiFetch(`/feed/posts/${id}/cheer`, { method: "POST" }).catch((error) => showToast(error.message));
    setFeed((current) => current.map((post) => post.id === id
      ? { ...post, cheered: !post.cheered, cheers: post.cheers + (post.cheered ? -1 : 1) }
      : post));
  };

  const copyPost = (post: FeedPost) => {
    setDraftTitle(post.todo);
    setSelectedTodo({ id: post.sourceTodoId ?? post.id, title: post.todo, category: post.category, time: "오늘", done: false });
    setModal("copy");
  };

  const content = useMemo(() => {
    if (tab === "today") return <TodayView todos={todos} progress={progress} completed={completed} onToggle={toggleTodo} onAdd={() => openTodoModal()} onShare={(todo) => { setSelectedTodo(todo); setModal("share"); }} />;
    if (tab === "explore") return <ExploreView feed={feed} joined={joined} onCheer={cheer} onCopy={copyPost} onJoin={(id) => { setJoined((items) => items.includes(id) ? items.filter((item) => item !== id) : [...items, id]); showToast(joined.includes(id) ? "챌린지 참여를 취소했어요" : "챌린지에 참여했어요"); }} />;
    if (tab === "planner") return <PlannerView todos={todos} onToggle={toggleTodo} onAdd={() => openTodoModal()} />;
    if (tab === "messages") return <MessagesView onToast={showToast} />;
    return <ProfileView completed={completed} />;
  }, [tab, todos, feed, joined, completed, progress]);

  return (
    <div className="app-shell">
      <div className="ambient-cloud cloud-a" />
      <div className="ambient-cloud cloud-b" />
      <header className="topbar">
        <button className="brand" onClick={() => setTab("today")} aria-label="뭉실 오늘 화면">
          <CloudMark />
          <span>뭉실</span>
        </button>
        <div className="top-actions">
          <button className="icon-button" aria-label="검색"><Search size={20} /></button>
          <button className="icon-button has-dot" aria-label="알림"><Bell size={20} /></button>
          <button className="avatar-button" aria-label="내 프로필" onClick={() => setTab("profile")}>지</button>
        </div>
      </header>
      <main className="main-content">{content}</main>
      <nav className="bottom-nav" aria-label="주요 메뉴">
        <NavButton active={tab === "today"} icon={<House />} label="오늘" onClick={() => setTab("today")} />
        <NavButton active={tab === "explore"} icon={<Compass />} label="탐색" onClick={() => setTab("explore")} />
        <NavButton active={tab === "planner"} icon={<CalendarDays />} label="TODO" onClick={() => setTab("planner")} />
        <NavButton active={tab === "messages"} icon={<MessagesSquare />} label="메시지" onClick={() => setTab("messages")} badge />
        <NavButton active={tab === "profile"} icon={<CircleUserRound />} label="마이" onClick={() => setTab("profile")} />
      </nav>
      {modal && (
        <ComposerModal kind={modal} title={draftTitle} caption={draftCaption} selectedTodo={selectedTodo}
          onTitle={setDraftTitle} onCaption={setDraftCaption} onClose={() => setModal(null)}
          onSubmit={modal === "share" ? shareTodo : saveTodo} />
      )}
      {toast && <div className="toast"><Check size={17} />{toast}</div>}
    </div>
  );
}

function NavButton({ active, icon, label, onClick, badge = false }: { active: boolean; icon: React.ReactNode; label: string; onClick: () => void; badge?: boolean }) {
  return <button className={active ? "nav-item active" : "nav-item"} onClick={onClick}>{badge && <i className="nav-dot" />}{icon}<span>{label}</span></button>;
}

function SectionTitle({ title, action }: { title: string; action?: string }) {
  return <div className="section-title"><h2>{title}</h2>{action && <button>{action}<ChevronRight size={16} /></button>}</div>;
}

function TodayView({ todos, progress, completed, onToggle, onAdd, onShare }: { todos: Todo[]; progress: number; completed: number; onToggle: (todo: Todo) => void; onAdd: () => void; onShare: (todo: Todo) => void }) {
  return <div className="page today-page">
    <section className="greeting"><p>7월 22일 수요일</p><h1>오늘도 가볍게,<br /><strong>한 뭉실</strong> 시작해볼까요?</h1></section>
    <section className="progress-card">
      <div className="progress-copy"><span>오늘의 뭉실</span><b>{completed}<small> / {todos.length}</small></b><p>{progress === 100 ? "오늘의 구름을 모두 채웠어요!" : `${todos.length - completed}개만 더하면 오늘의 구름이 완성돼요`}</p></div>
      <div className="cloud-progress" style={{ "--progress": `${progress}%` } as React.CSSProperties}><CloudMark /><strong>{progress}%</strong></div>
    </section>
    <SectionTitle title="오늘 할 일" action="순서 바꾸기" />
    <section className="todo-list">
      {todos.map((todo) => <TodoRow key={todo.id} todo={todo} onToggle={onToggle} onShare={onShare} />)}
      <button className="add-row" onClick={onAdd}><Plus size={18} /> 새 TODO 추가</button>
    </section>
    <section className="daily-note"><Sparkles size={18} /><div><b>어제보다 12% 더 뭉실해졌어요</b><p>완료 2개가 솜구름 등급에 반영됐어요.</p></div><ChevronRight size={18} /></section>
  </div>;
}

function TodoRow({ todo, onToggle, onShare }: { todo: Todo; onToggle: (todo: Todo) => void; onShare?: (todo: Todo) => void }) {
  return <article className={todo.done ? "todo-row done" : "todo-row"}>
    <button className="check-button" onClick={() => onToggle(todo)} aria-label={`${todo.title} ${todo.done ? "완료 취소" : "완료"}`}>{todo.done && <Check size={17} />}</button>
    <div className="todo-info"><div><span className={`category-dot ${categoryColors[todo.category] ?? "gray"}`} />{todo.category}{todo.repeat && <em>{todo.repeat}</em>}</div><h3>{todo.title}</h3><p><Clock3 size={13} />{todo.time}</p></div>
    {todo.done && onShare ? <button className="share-mini" onClick={() => onShare(todo)}>공유</button> : <button className="more-button" aria-label="할 일 메뉴"><MoreHorizontal size={20} /></button>}
  </article>;
}

function ExploreView({ feed, joined, onCheer, onCopy, onJoin }: { feed: FeedPost[]; joined: number[]; onCheer: (id: string | number) => void; onCopy: (post: FeedPost) => void; onJoin: (id: number) => void }) {
  const [filter, setFilter] = useState("추천");
  return <div className="page explore-page">
    <div className="page-heading"><div><span>좋은 습관을 발견해요</span><h1>탐색</h1></div><button className="round-action"><Search size={20} /></button></div>
    <div className="segmented">{["추천", "관심사", "챌린지"].map((item) => <button className={filter === item ? "active" : ""} key={item} onClick={() => setFilter(item)}>{item}</button>)}</div>
    {filter !== "관심사" && <><SectionTitle title="지금 함께하는 챌린지" action="전체보기" /><div className="challenge-scroll">{challenges.map((challenge) => <ChallengeCard key={challenge.id} challenge={challenge} joined={joined.includes(challenge.id)} onJoin={() => onJoin(challenge.id)} />)}</div></>}
    {filter !== "챌린지" && <><SectionTitle title={filter === "관심사" ? "내 관심사 피드" : "오늘의 실천 피드"} action="필터" /><div className="feed-list">{feed.map((post) => <FeedCard key={post.id} post={post} onCheer={() => onCheer(post.id)} onCopy={() => onCopy(post)} />)}</div></>}
  </div>;
}

function ChallengeCard({ challenge, joined, onJoin }: { challenge: typeof challenges[number]; joined: boolean; onJoin: () => void }) {
  return <article className={`challenge-card ${challenge.tone}`}>
    <div className="challenge-top"><span>{challenge.kind}</span><b>{challenge.days}</b></div>
    <div className="challenge-art"><CloudMark compact /><i /></div>
    <h3>{challenge.title}</h3><p><Users size={14} />{challenge.meta}</p>
    <div className="challenge-progress"><i style={{ width: `${challenge.progress / challenge.total * 100}%` }} /></div>
    <button className={joined ? "joined" : ""} onClick={onJoin}>{joined ? `${challenge.progress}일째 참여 중` : "참여하기"}</button>
  </article>;
}

function FeedCard({ post, onCheer, onCopy }: { post: FeedPost; onCheer: () => void; onCopy: () => void }) {
  return <article className="feed-card">
    <header><div className={`profile-bubble ${post.tone}`}>{post.author[0]}</div><div><b>{post.author}<small>{post.rank}</small></b><p>{post.handle} · {post.time}</p></div><button aria-label="게시물 메뉴"><Ellipsis size={21} /></button></header>
    <p className="post-caption">{post.caption}</p>
    <div className={`post-visual ${post.tone}`}><span>{post.category}</span><div className="visual-sun" /><div className="visual-ground" /><p>오늘의 작은 실천</p></div>
    <div className="shared-todo"><span className={`category-dot ${categoryColors[post.category] ?? "gray"}`} /><div><small>완료한 TODO</small><b>{post.todo}</b></div><Check size={18} /></div>
    <footer><button className={post.cheered ? "cheered" : ""} onClick={onCheer}><HeartHandshake size={19} />응원 {post.cheers}</button><button><MessageCircle size={18} />댓글 {post.comments}</button><button className="copy-action" onClick={onCopy}><CopyPlus size={18} />나도 할래요 <b>{post.copies}</b></button></footer>
  </article>;
}

function PlannerView({ todos, onToggle, onAdd }: { todos: Todo[]; onToggle: (todo: Todo) => void; onAdd: () => void }) {
  const days = Array.from({ length: 35 }, (_, index) => index - 2);
  return <div className="page planner-page">
    <div className="page-heading"><div><span>미리 보고 가볍게 계획해요</span><h1>TODO / 캘린더</h1></div><button className="primary-round" onClick={onAdd}><Plus size={21} /></button></div>
    <section className="calendar-card"><header><button><ChevronLeft size={19} /></button><h2>2026년 7월</h2><button><ChevronRight size={19} /></button></header><div className="week-labels">{"월화수목금토일".split("").map((day) => <b key={day}>{day}</b>)}</div><div className="calendar-grid">{days.map((day, index) => <button key={index} className={day === 22 ? "selected" : day < 1 || day > 31 ? "muted" : ""}>{day < 1 ? 30 + day : day > 31 ? day - 31 : day}{[4, 7, 11, 15, 18, 22, 25, 29].includes(day) && <i />}</button>)}</div></section>
    <div className="date-title"><div><b>22</b><span>수요일<small>오늘</small></span></div><button onClick={onAdd}><Plus size={17} />추가</button></div>
    <section className="todo-list compact-list">{todos.map((todo) => <TodoRow key={todo.id} todo={todo} onToggle={onToggle} />)}</section>
  </div>;
}

function MessagesView({ onToast }: { onToast: (message: string) => void }) {
  const [section, setSection] = useState("채팅");
  const [activeChat, setActiveChat] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const conversations = [
    { name: "서윤", message: "산책 TODO 가져가도 좋죠! 😊", time: "오후 8:41", unread: 2, online: true },
    { name: "민호", message: "오늘 그림도 기대할게요", time: "어제", unread: 0, online: false },
    { name: "하린", message: "같이 14일 완주해봐요!", time: "월", unread: 0, online: true },
  ];
  if (activeChat) return <div className="page chat-page"><header className="chat-header"><button onClick={() => setActiveChat(null)}><ChevronLeft /></button><div className="profile-bubble study">{activeChat[0]}</div><div><b>{activeChat}</b><span>활동 중</span></div><button><Ellipsis /></button></header><div className="chat-body"><span className="day-divider">오늘</span><div className="bubble theirs">안녕하세요! 산책 TODO 가져가도 좋죠?<small>오후 8:39</small></div><div className="bubble mine">그럼요! 내일도 같이 걸어요 ☁️<small>오후 8:40</small></div><div className="bubble theirs">좋아요, 완주하면 서로 알려주기!<small>오후 8:41</small></div></div><form className="chat-input" onSubmit={(event) => { event.preventDefault(); if (message.trim()) { setMessage(""); onToast("메시지를 보냈어요"); } }}><button type="button"><Plus /></button><input value={message} onChange={(event) => setMessage(event.target.value)} placeholder="메시지 보내기" /><button className="send-button"><Send size={18} /></button></form></div>;
  return <div className="page messages-page"><div className="page-heading"><div><span>함께하면 더 오래 가요</span><h1>메시지</h1></div><button className="round-action"><Search size={20} /></button></div><div className="segmented two"><button className={section === "채팅" ? "active" : ""} onClick={() => setSection("채팅")}>채팅</button><button className={section === "활동" ? "active" : ""} onClick={() => setSection("활동")}>활동 <i /></button></div>{section === "채팅" ? <><div className="message-request"><div><Users size={19} /><span><b>새 메시지 요청 1개</b><small>요청을 확인하고 대화를 시작하세요</small></span></div><ChevronRight size={18} /></div><div className="conversation-list">{conversations.map((item) => <button key={item.name} onClick={() => setActiveChat(item.name)}><div className="profile-bubble"><span>{item.name[0]}</span>{item.online && <i />}</div><div><b>{item.name}</b><p>{item.message}</p></div><span>{item.time}{item.unread > 0 && <em>{item.unread}</em>}</span></button>)}</div></> : <ActivityList />}</div>;
}

function ActivityList() {
  const activities = [
    { icon: <CopyPlus />, title: "하린님이 내 TODO를 가져갔어요", text: "잠들기 전 책 10쪽", time: "12분 전" },
    { icon: <HeartHandshake />, title: "서윤님 외 8명이 응원했어요", text: "출근 전 20분 산책", time: "1시간 전" },
    { icon: <Trophy />, title: "솜구름 등급이 되었어요", text: "다음은 뭉게구름이에요", time: "어제" },
  ];
  return <div className="activity-list">{activities.map((item, index) => <article key={index}><span>{item.icon}</span><div><b>{item.title}</b><p>{item.text}</p></div><small>{item.time}</small></article>)}</div>;
}

function ProfileView({ completed }: { completed: number }) {
  return <div className="page profile-page"><header className="profile-toolbar"><h1>마이</h1><button><Settings size={21} /></button></header><section className="profile-hero"><div className="large-avatar">지<CloudMark compact /></div><h2>지우</h2><p>@jiwoo.cloud</p><span>작은 실천을 오래 이어가는 중이에요 ☁️</span><div className="profile-stats"><div><b>128</b><small>완료</small></div><div><b>42</b><small>공유</small></div><div><b>19</b><small>가져온 TODO</small></div></div></section><section className="power-card"><div className="rank-cloud"><CloudMark /><Sparkles size={15} /></div><div><span>나의 뭉실력</span><h3>솜구름 <b>1,280</b></h3><div className="power-bar"><i /></div><p>뭉게구름까지 220 뭉실</p></div><button><ChevronRight /></button></section><section className="vitality-card"><div><b>최근 30일 활동도</b><span>꾸준히 피어나는 중</span></div><strong>82<small>/100</small></strong></section><div className="profile-tabs"><button className="active">공유한 실천</button><button>완료 기록</button><button>배지</button></div><div className="profile-grid"><div className="grid-tile sky"><span>운동</span><b>출근 전<br />20분 산책</b></div><div className="grid-tile peach"><span>마음</span><b>잠들기 전<br />책 10쪽</b></div><div className="grid-tile mint"><span>건강</span><b>물 2L<br />마시기</b></div><div className="grid-tile violet"><span>공부</span><b>영어 단어<br />30개</b></div></div><p className="profile-summary">오늘 완료한 TODO {completed}개</p></div>;
}

function ComposerModal({ kind, title, caption, selectedTodo, onTitle, onCaption, onClose, onSubmit }: { kind: Exclude<ModalKind, null>; title: string; caption: string; selectedTodo: Todo | null; onTitle: (value: string) => void; onCaption: (value: string) => void; onClose: () => void; onSubmit: () => void }) {
  const isShare = kind === "share";
  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section className="composer" role="dialog" aria-modal="true" aria-label={isShare ? "완료 공유" : "TODO 추가"}><div className="drag-handle" /><header><button onClick={onClose}><X size={21} /></button><h2>{isShare ? "완료한 TODO 공유" : kind === "copy" ? "내 TODO로 가져오기" : "새 TODO"}</h2><button className="text-action" onClick={onSubmit}>{isShare ? "공유" : "저장"}</button></header>{isShare ? <><div className="celebrate"><div><CloudMark /><Check /></div><h3>해냈어요!</h3><p>오늘의 작은 실천을 가볍게 나눠보세요.</p></div><div className="selected-todo-card"><small>완료한 TODO</small><b>{selectedTodo?.title}</b><span>{selectedTodo?.category} · 전체 공개</span></div><textarea value={caption} onChange={(event) => onCaption(event.target.value)} placeholder="오늘의 실천은 어땠나요? (선택)" maxLength={180} /><button className="media-button"><ImagePlus size={21} /><span><b>사진 추가</b><small>선택 사항 · 최대 1장</small></span><ChevronRight /></button></> : <><label>TODO 제목<input autoFocus value={title} onChange={(event) => onTitle(event.target.value)} placeholder="무엇을 실천할까요?" /></label><div className="form-grid"><label>날짜<button>오늘 <ChevronRight size={16} /></button></label><label>시간<button>시간 없음 <ChevronRight size={16} /></button></label><label>반복<button>{kind === "copy" ? "원본 설정 유지" : "반복 안 함"}<ChevronRight size={16} /></button></label><label>공개 범위<button><LockKeyhole size={15} />나만 보기 <ChevronRight size={16} /></button></label></div>{kind === "copy" && <p className="source-note"><CopyPlus size={16} />원본과 연결되어 몇 명이 함께 실천했는지 기록돼요.</p>}<button className="modal-primary" onClick={onSubmit}>{kind === "copy" ? "내 TODO에 추가" : "TODO 만들기"}</button></>}</section></div>;
}
