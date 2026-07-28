import type { Challenge, Comment, FeedPage, FeedPost, SessionUser, TodoDto, TodoListDto } from "./types";

export const DEMO_MODE_KEY = "mungsil_demo_mode";
const DEMO_DATA_KEY = "mungsil_demo_data_v2";
export const demoAvailable = process.env.NODE_ENV === "development" || process.env.NEXT_PUBLIC_ENABLE_DEMO === "true";

type DemoNotification = { id: string; type: "CHEER" | "COMMENT" | "COPY" | "FOLLOW" | "MESSAGE" | "CHALLENGE" | "RANK" | "SYSTEM"; title: string; body: string; referenceId?: string | null; readAt?: string | null; createdAt: string };
type DemoState = {
  day: string;
  user: SessionUser;
  todos: TodoDto[];
  lists: TodoListDto[];
  feed: FeedPost[];
  comments: Record<string, Comment[]>;
  challenges: Challenge[];
  notifications: DemoNotification[];
  following: string[];
};

const uid = (prefix: string) => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const dayKey = (value = new Date()) => {
  const local = new Date(value.getTime() - value.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
};
const at = (offset: number, hour: number, minute = 0) => {
  const value = new Date();
  value.setDate(value.getDate() + offset);
  value.setHours(hour, minute, 0, 0);
  return value.toISOString();
};

function initialState(): DemoState {
  const user: SessionUser = {
    id: "demo-me",
    email: "demo@mungsil.local",
    nickname: "몽글이",
    handle: "mongsil.day",
    role: "USER",
    availablePoints: 320,
    lifetimePower: 186,
    recentVitality: 78,
    bio: "조급하지 않게, 오늘 할 수 있는 만큼 실천해요.",
    interests: ["운동", "독서", "마음"],
  };
  const todos: TodoDto[] = [
    { id: "demo-todo-walk", title: "출근 전 20분 산책", dueDate: at(0, 8), completedAt: at(0, 8, 24), visibility: "PRIVATE", repeatRule: "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR", category: "운동" },
    { id: "demo-todo-words", title: "영어 단어 30개 복습", dueDate: at(0, 12, 30), completedAt: at(0, 12, 48), visibility: "PRIVATE", repeatRule: "FREQ=DAILY", category: "공부" },
    { id: "demo-todo-water", title: "물 1.5L 마시기", dueDate: at(0, 18), visibility: "PRIVATE", repeatRule: "FREQ=DAILY", category: "건강" },
    { id: "demo-todo-book", title: "잠들기 전 책 10쪽", notes: "휴대폰은 거실에 두기", dueDate: at(0, 22, 30), visibility: "PRIVATE", repeatRule: "FREQ=DAILY", category: "독서" },
    { id: "demo-todo-plan", title: "다음 주 우선순위 세 가지 정리", dueDate: at(1, 19), visibility: "PRIVATE", category: "커리어" },
    { id: "demo-todo-stretch", title: "목과 어깨 스트레칭 10분", dueDate: at(-1, 21), completedAt: at(-1, 21, 12), visibility: "PRIVATE", category: "건강" },
  ];
  const morningList: TodoListDto = { id: "demo-list-morning", title: "가볍게 여는 아침", description: "바쁜 날에도 부담 없이 몸과 머리를 깨우는 루틴", visibility: "PRIVATE", copyCount: 14, items: [todos[0], todos[1], todos[2]].map((todo, order) => ({ order, todo })) };
  const nightList: TodoListDto = { id: "demo-list-night", title: "화면 없이 잠드는 밤", description: "하루의 속도를 천천히 낮추는 30분", visibility: "PRIVATE", copyCount: 31, items: [todos[3], todos[5]].map((todo, order) => ({ order, todo })) };
  const authors = {
    hana: { id: "demo-user-hana", nickname: "하나", handle: "hana.moves", avatarUrl: "/demo/avatar-flower.jpg", cloudRank: "포근구름", lifetimePower: 742 },
    june: { id: "demo-user-june", nickname: "준", handle: "june.reads", avatarUrl: "/demo/avatar-cloud.jpg", cloudRank: "뭉게구름", lifetimePower: 418 },
    sol: { id: "demo-user-sol", nickname: "솔", handle: "slow.sol", avatarUrl: "/demo/avatar-mint.jpg", cloudRank: "조각구름", lifetimePower: 156 },
  };
  const publicWalk: TodoDto = { id: "demo-public-walk", title: "제철 과일 요거트볼 만들기", dueDate: at(0, 8), completedAt: at(0, 8, 22), visibility: "PUBLIC", repeatRule: "FREQ=DAILY", category: "건강" };
  const publicRead: TodoDto = { id: "demo-public-read", title: "하루 한 챕터 읽기", dueDate: at(0, 21), completedAt: at(0, 21, 35), visibility: "PUBLIC", category: "독서" };
  const publicList: TodoListDto = { id: "demo-public-list", title: "퇴근 후 30분 회복 루틴", description: "업무의 긴장을 집까지 가져오지 않는 짧은 루틴", visibility: "PUBLIC", copyCount: 128, items: [
    { order: 0, todo: { id: "demo-public-breathe", title: "3분 깊게 호흡하기", dueDate: at(0, 19), visibility: "PUBLIC", category: "마음" } },
    { order: 1, todo: { id: "demo-public-shower", title: "따뜻한 물로 샤워하기", dueDate: at(0, 19, 10), visibility: "PUBLIC", category: "건강" } },
    { order: 2, todo: { id: "demo-public-journal", title: "오늘 잘한 일 하나 적기", dueDate: at(0, 19, 25), visibility: "PUBLIC", category: "마음" } },
  ] };
  const feed: FeedPost[] = [
    { id: "demo-post-routine", author: authors.sol, caption: "퇴근 후 멍하니 휴대폰을 보던 시간을 짧은 회복 루틴으로 바꿨어요. 완벽하지 않아도 개운해요.", mediaUrl: "/demo/stretch.jpg", todoList: publicList, todos: publicList.items.map((item) => item.todo), cheerCount: 84, commentCount: 5, copyCount: 128, createdAt: at(0, 19, 31), cheered: false },
    { id: "demo-post-walk", author: authors.hana, caption: "아침을 대충 넘기지 않으려고 좋아하는 과일을 가볍게 담았어요. 하루를 잘 돌보는 기분이에요.", mediaUrl: "/demo/breakfast.jpg", todos: [publicWalk], cheerCount: 46, commentCount: 3, copyCount: 22, createdAt: at(0, 8, 24), cheered: true },
    { id: "demo-post-read", author: authors.june, caption: "짧게라도 매일 펼치니 어느새 이번 달 세 번째 책입니다 📚", mediaUrl: "/demo/study.jpg", todos: [publicRead], cheerCount: 31, commentCount: 2, copyCount: 17, createdAt: at(-1, 21, 38), cheered: false },
  ];
  const comments: Record<string, Comment[]> = {
    "demo-post-routine": [
      { id: "demo-comment-1", body: "저도 오늘부터 따라 해볼게요!", createdAt: at(0, 20), author: authors.hana },
      { id: "demo-comment-2", body: "오늘 잘한 일 적기, 정말 좋네요.", createdAt: at(0, 20, 10), author: authors.june },
    ],
    "demo-post-walk": [{ id: "demo-comment-3", body: "한 정거장 먼저 내리기 좋은 아이디어예요.", createdAt: at(0, 14), author: authors.sol }],
    "demo-post-read": [],
  };
  const challenges: Challenge[] = [
    { id: "demo-challenge-official", title: "매일 7천 보, 가벼운 한 달", description: "하루 7천 보를 채우며 생활 속 움직임을 되찾아요.", kind: "OFFICIAL", verificationMode: "OPTIONAL_PHOTO", startsAt: at(-8, 0), endsAt: at(22, 23, 59), rewardLabel: "완주 리워드", joined: true, _count: { participants: 1842, checkIns: 12840 } },
    { id: "demo-challenge-book", title: "잠들기 전 10쪽", description: "화면을 내려놓고 책으로 하루를 마무리해요.", kind: "COMMUNITY", verificationMode: "CHECK", startsAt: at(-3, 0), endsAt: at(18, 23, 59), rewardLabel: "밤독서가 칭호", joined: false, _count: { participants: 326, checkIns: 1840 } },
    { id: "demo-challenge-water", title: "물 한 잔으로 시작하기", description: "아침 첫 커피 전에 물 한 잔을 마시는 작은 약속이에요.", kind: "COMMUNITY", verificationMode: "CHECK", startsAt: at(-12, 0), endsAt: at(12, 23, 59), joined: true, _count: { participants: 94, checkIns: 672 } },
  ];
  const notifications: DemoNotification[] = [
    { id: "demo-notice-1", type: "CHEER", title: "새로운 응원을 받았어요", body: "하나님이 ‘출근 전 20분 산책’을 응원했어요.", referenceId: "demo-post-walk", createdAt: at(0, 14, 2) },
    { id: "demo-notice-2", type: "COPY", title: "내 루틴이 새로운 하루로", body: "3명이 ‘화면 없이 잠드는 밤’을 가져갔어요.", createdAt: at(-1, 18), readAt: at(-1, 20) },
    { id: "demo-notice-3", type: "RANK", title: "조각구름이 되었어요", body: "작은 실천이 모여 새로운 뭉실 등급에 도착했어요.", createdAt: at(-3, 12), readAt: at(-3, 13) },
  ];
  return { day: dayKey(), user, todos, lists: [morningList, nightList], feed, comments, challenges, notifications, following: [] };
}

export function isDemoMode() {
  return demoAvailable && typeof window !== "undefined" && window.localStorage.getItem(DEMO_MODE_KEY) === "1";
}

export function initializeDemoData(reset = false) {
  if (typeof window === "undefined") return;
  const saved = window.localStorage.getItem(DEMO_DATA_KEY);
  if (!reset && saved) {
    try {
      const parsed = JSON.parse(saved) as DemoState;
      if (parsed.day === dayKey()) return;
    } catch { /* 새 체험 데이터로 복구합니다. */ }
  }
  window.localStorage.setItem(DEMO_DATA_KEY, JSON.stringify(initialState()));
}

function readState() {
  initializeDemoData();
  return JSON.parse(window.localStorage.getItem(DEMO_DATA_KEY) ?? "null") as DemoState;
}

function writeState(state: DemoState) {
  window.localStorage.setItem(DEMO_DATA_KEY, JSON.stringify(state));
}

function bodyOf(init: RequestInit) {
  if (typeof init.body !== "string" || !init.body) return {} as Record<string, unknown>;
  return JSON.parse(init.body) as Record<string, unknown>;
}

const clone = <T,>(value: T): T => structuredClone(value);

export async function demoApiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  await new Promise((resolve) => setTimeout(resolve, 120));
  const state = readState();
  const method = (init.method ?? "GET").toUpperCase();
  const url = new URL(path, "http://demo.mungsil.local");
  const pathname = url.pathname;
  const body = bodyOf(init);

  if (pathname === "/auth/me") return clone(state.user) as T;
  if (pathname === "/auth/logout" || pathname === "/auth/delete-account") return {} as T;
  if (pathname === "/me" && method === "GET") return clone({ ...state.user, rank: "조각구름", _count: { followers: 48, following: 31, posts: 12 } }) as T;
  if (pathname === "/me" && method === "PATCH") {
    state.user = { ...state.user, ...body } as SessionUser;
    writeState(state);
    return clone(state.user) as T;
  }
  if (pathname === "/me/notifications" && method === "GET") return clone(state.notifications) as T;
  if (pathname === "/me/notifications/read" && method === "POST") {
    state.notifications = state.notifications.map((item) => ({ ...item, readAt: item.readAt ?? new Date().toISOString() }));
    writeState(state);
    return {} as T;
  }

  if (pathname === "/todos" && method === "GET") {
    const from = url.searchParams.get("from"); const to = url.searchParams.get("to");
    return clone(state.todos.filter((todo) => (!from || new Date(todo.dueDate) >= new Date(from)) && (!to || new Date(todo.dueDate) <= new Date(to)))) as T;
  }
  if (pathname === "/todos" && method === "POST") {
    const todo: TodoDto = { id: uid("demo-todo"), title: String(body.title), notes: body.notes ? String(body.notes) : null, dueDate: String(body.dueDate), visibility: (body.visibility as TodoDto["visibility"]) ?? "PRIVATE", repeatRule: body.repeatRule ? String(body.repeatRule) : null, category: String(body.category ?? "기타") };
    state.todos.push(todo); writeState(state); return clone(todo) as T;
  }
  const todoMatch = pathname.match(/^\/todos\/([^/]+)$/);
  if (todoMatch && method === "PATCH") {
    const index = state.todos.findIndex((item) => item.id === todoMatch[1]);
    if (index < 0) throw new Error("TODO를 찾지 못했어요.");
    state.todos[index] = { ...state.todos[index], ...body } as TodoDto; writeState(state); return clone(state.todos[index]) as T;
  }
  if (todoMatch && method === "DELETE") {
    state.todos = state.todos.filter((item) => item.id !== todoMatch[1]); writeState(state); return {} as T;
  }
  const completeMatch = pathname.match(/^\/todos\/([^/]+)\/complete$/);
  if (completeMatch && method === "POST") {
    const todo = state.todos.find((item) => item.id === completeMatch[1]);
    if (!todo) throw new Error("TODO를 찾지 못했어요.");
    todo.completedAt = todo.completedAt ?? new Date().toISOString();
    if (body.share && !state.feed.some((post) => post.todos.some((item) => item.id === todo.id))) {
      state.feed.unshift({ id: uid("demo-post"), author: { id: state.user.id, nickname: state.user.nickname, handle: state.user.handle, avatarUrl: state.user.avatarUrl, cloudRank: "조각구름", lifetimePower: state.user.lifetimePower }, caption: body.caption ? String(body.caption) : null, mediaUrl: body.mediaKey ? String(body.mediaKey) : null, todos: [todo], cheerCount: 0, commentCount: 0, copyCount: 0, createdAt: new Date().toISOString(), cheered: false });
    }
    writeState(state); return clone(todo) as T;
  }
  const todoCloneMatch = pathname.match(/^\/todos\/([^/]+)\/clone$/);
  if (todoCloneMatch && method === "POST") {
    const source = state.todos.find((item) => item.id === todoCloneMatch[1]) ?? state.feed.flatMap((post) => post.todos).find((item) => item.id === todoCloneMatch[1]);
    if (!source) throw new Error("가져올 TODO를 찾지 못했어요.");
    const todo: TodoDto = { ...source, id: uid("demo-copy"), title: body.title ? String(body.title) : source.title, category: body.category ? String(body.category) : source.category, dueDate: body.dueDate ? String(body.dueDate) : at(0, 20), repeatRule: body.keepRepeat === false ? null : body.repeatRule ? String(body.repeatRule) : source.repeatRule, completedAt: null, visibility: "PRIVATE", sourceTodoId: source.id };
    state.todos.push(todo); writeState(state); return clone(todo) as T;
  }

  if (pathname === "/todo-lists" && method === "GET") return clone(state.lists) as T;
  if (pathname === "/todo-lists" && method === "POST") {
    const ids = Array.isArray(body.todoIds) ? body.todoIds.map(String) : [];
    const list: TodoListDto = { id: uid("demo-list"), title: String(body.title), description: body.description ? String(body.description) : null, visibility: (body.visibility as TodoListDto["visibility"]) ?? "PRIVATE", copyCount: 0, items: ids.map((id, order) => ({ order, todo: state.todos.find((todo) => todo.id === id)! })).filter((item) => item.todo) };
    state.lists.unshift(list); writeState(state); return clone(list) as T;
  }
  const listCloneMatch = pathname.match(/^\/todo-lists\/([^/]+)\/clone$/);
  if (listCloneMatch && method === "POST") {
    const source = state.lists.find((item) => item.id === listCloneMatch[1]) ?? state.feed.map((post) => post.todoList).find((item) => item?.id === listCloneMatch[1]);
    if (!source) throw new Error("가져올 루틴을 찾지 못했어요.");
    const baseDate = body.dueDate ? new Date(String(body.dueDate)) : new Date(at(0, 19));
    const copiedTodos = source.items.map((item, order) => ({ ...item.todo, id: uid(`demo-list-copy-${order}`), dueDate: new Date(baseDate.getTime() + order * 15 * 60_000).toISOString(), completedAt: null, visibility: "PRIVATE" as const, sourceTodoId: item.todo.id }));
    state.todos.push(...copiedTodos);
    const list: TodoListDto = { ...source, id: uid("demo-list-copy"), title: body.title ? String(body.title) : source.title, visibility: "PRIVATE", sourceTodoListId: source.id, copyCount: 0, items: copiedTodos.map((todo, order) => ({ order, todo })) };
    state.lists.unshift(list); writeState(state); return clone(list) as T;
  }

  if ((pathname === "/feed" || pathname === "/public/feed") && method === "GET") {
    const category = url.searchParams.get("category");
    const items = category && category !== "전체" ? state.feed.filter((post) => post.todos.some((todo) => todo.category === category)) : state.feed;
    return clone({ items, nextCursor: null } satisfies FeedPage) as T;
  }
  if (pathname === "/feed/posts" && method === "POST") {
    const list = state.lists.find((item) => item.id === body.todoListId);
    if (!list) throw new Error("공유할 루틴을 찾지 못했어요.");
    const post: FeedPost = { id: uid("demo-post"), author: { id: state.user.id, nickname: state.user.nickname, handle: state.user.handle, cloudRank: "조각구름", lifetimePower: state.user.lifetimePower }, caption: body.caption ? String(body.caption) : null, mediaUrl: body.mediaKey ? String(body.mediaKey) : null, todoList: list, todos: list.items.map((item) => item.todo), cheerCount: 0, commentCount: 0, copyCount: 0, createdAt: new Date().toISOString(), cheered: false };
    state.feed.unshift(post); state.comments[post.id] = []; writeState(state); return clone(post) as T;
  }
  const cheerMatch = pathname.match(/^\/feed\/posts\/([^/]+)\/cheer$/);
  if (cheerMatch && method === "POST") {
    const post = state.feed.find((item) => item.id === cheerMatch[1]); if (!post) throw new Error("게시물을 찾지 못했어요.");
    post.cheered = !post.cheered; post.cheerCount += post.cheered ? 1 : -1; writeState(state); return clone({ cheered: post.cheered, cheerCount: post.cheerCount }) as T;
  }
  const commentsMatch = pathname.match(/^\/(?:feed|public)\/posts\/([^/]+)\/comments$/);
  if (commentsMatch && method === "GET") return clone(state.comments[commentsMatch[1]] ?? []) as T;
  if (commentsMatch && method === "POST") {
    const item: Comment = { id: uid("demo-comment"), body: String(body.body), createdAt: new Date().toISOString(), author: { id: state.user.id, nickname: state.user.nickname, handle: state.user.handle, cloudRank: "조각구름", lifetimePower: state.user.lifetimePower } };
    state.comments[commentsMatch[1]] = [...(state.comments[commentsMatch[1]] ?? []), item];
    const post = state.feed.find((entry) => entry.id === commentsMatch[1]); if (post) post.commentCount += 1;
    writeState(state); return clone(item) as T;
  }
  const postMatch = pathname.match(/^\/(?:feed|public)\/posts\/([^/]+)$/);
  if (postMatch && method === "GET") {
    const post = state.feed.find((item) => item.id === postMatch[1]); if (!post) throw new Error("게시물을 찾지 못했어요."); return clone(post) as T;
  }

  if ((pathname === "/challenges" || pathname === "/public/challenges") && method === "GET") return clone(state.challenges) as T;
  const joinMatch = pathname.match(/^\/challenges\/([^/]+)\/join$/);
  if (joinMatch && method === "POST") {
    const challenge = state.challenges.find((item) => item.id === joinMatch[1]); if (!challenge) throw new Error("챌린지를 찾지 못했어요.");
    if (!challenge.joined) { challenge.joined = true; challenge._count.participants += 1; } writeState(state); return clone(challenge) as T;
  }
  const checkInMatch = pathname.match(/^\/challenges\/([^/]+)\/check-in$/);
  if (checkInMatch && method === "POST") {
    const challenge = state.challenges.find((item) => item.id === checkInMatch[1]); if (!challenge) throw new Error("챌린지를 찾지 못했어요.");
    challenge._count.checkIns += 1; writeState(state); return clone({ checkedIn: true }) as T;
  }

  const profileMatch = pathname.match(/^\/public\/users\/([^/]+)$/);
  if (profileMatch && method === "GET") {
    const author = state.feed.map((post) => post.author).find((item) => item.handle === profileMatch[1]);
    if (!author && profileMatch[1] !== state.user.handle) throw new Error("프로필을 찾지 못했어요.");
    const person = author ?? { id: state.user.id, nickname: state.user.nickname, handle: state.user.handle, avatarUrl: state.user.avatarUrl, cloudRank: "조각구름", lifetimePower: state.user.lifetimePower };
    return clone({ ...person, rank: person.cloudRank, recentVitality: 72, bio: "작은 실천을 내 속도로 이어가고 있어요.", _count: { followers: author ? 132 : 48, following: author ? 86 : 31, posts: author ? 24 : 12 } }) as T;
  }
  if (pathname === "/social/follow" && method === "POST") {
    const userId = String(body.userId); const following = !state.following.includes(userId);
    state.following = following ? [...state.following, userId] : state.following.filter((id) => id !== userId); writeState(state); return clone({ following }) as T;
  }

  throw new Error(`체험 모드에서 준비되지 않은 요청이에요: ${method} ${pathname}`);
}
