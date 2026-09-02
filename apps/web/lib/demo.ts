import type { Challenge, ChallengeChatMessage, ChatInboxItem, ChatNotificationLevel, Comment, DirectChatMessage, DirectConversation, DirectMessageRequest, FeedPage, FeedPost, SearchResults, SessionUser, TodoDto, TodoListDto, UserSummary } from "./types";

export const DEMO_MODE_KEY = "mungsil_demo_mode";
const DEMO_DATA_KEY = "mungsil_demo_data_v8";
export const demoAvailable = process.env.NODE_ENV === "development" || process.env.NEXT_PUBLIC_ENABLE_DEMO === "true";
const demoAdminPreview = process.env.NODE_ENV === "development" && process.env.NEXT_PUBLIC_DEMO_ADMIN === "true";

type DemoNotification = { id: string; type: "CHEER" | "COMMENT" | "COPY" | "FOLLOW" | "MESSAGE" | "CHALLENGE" | "RANK" | "SYSTEM"; title: string; body: string; referenceId?: string | null; targetType?: string | null; targetId?: string | null; href?: string | null; readAt?: string | null; createdAt: string };
type DemoState = {
  day: string;
  user: SessionUser;
  todos: TodoDto[];
  deletedTodos: TodoDto[];
  lists: TodoListDto[];
  feed: FeedPost[];
  comments: Record<string, Comment[]>;
  challenges: Challenge[];
  chats: Record<string, ChallengeChatMessage[]>;
  chatSettings: Record<string, ChatNotificationLevel>;
  chatMutes: Record<string, Record<string, string>>;
  chatRevisions: Record<string, Array<{ id: string; body?: string | null; createdAt: string }>>;
  directMessages: Record<string, DirectChatMessage[]>;
  directPeople: Record<string, UserSummary>;
  directRequests: DirectMessageRequest[];
  blockedUsers: string[];
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
    role: demoAdminPreview ? "ADMIN" : "USER",
    availablePoints: 320,
    lifetimePower: 186,
    recentVitality: 78,
    bio: "조급하지 않게, 오늘 할 수 있는 만큼 실천해요.",
    interests: ["운동", "독서", "마음"],
  };
  const todos: TodoDto[] = [
    { id: "demo-todo-walk", seriesId: "demo-series-walk", title: "출근 전 20분 산책", dueDate: at(0, 8), completedAt: at(0, 8, 24), visibility: "PRIVATE", repeatRule: "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR", category: "운동" },
    { id: "demo-todo-words", seriesId: "demo-series-words", title: "영어 단어 30개 복습", dueDate: at(0, 12, 30), completedAt: at(0, 12, 48), visibility: "PRIVATE", repeatRule: "FREQ=DAILY", category: "공부" },
    { id: "demo-todo-water", seriesId: "demo-series-water", title: "물 1.5L 마시기", dueDate: at(0, 18), visibility: "PRIVATE", repeatRule: "FREQ=DAILY", category: "건강" },
    { id: "demo-todo-book", seriesId: "demo-series-book", title: "잠들기 전 책 10쪽", notes: "휴대폰은 거실에 두기", dueDate: at(0, 22, 30), visibility: "PRIVATE", repeatRule: "FREQ=DAILY", category: "독서" },
    { id: "demo-todo-plan", title: "다음 주 우선순위 세 가지 정리", dueDate: at(1, 19), visibility: "PRIVATE", category: "커리어" },
    { id: "demo-todo-stretch", title: "목과 어깨 스트레칭 10분", dueDate: at(-1, 21), completedAt: at(-1, 21, 12), visibility: "PRIVATE", category: "건강" },
  ];
  const morningList: TodoListDto = { id: "demo-list-morning", title: "가볍게 여는 아침", description: "바쁜 날에도 부담 없이 몸과 머리를 깨우는 루틴", visibility: "PRIVATE", copyCount: 14, items: [todos[0], todos[1], todos[2]].map((todo, order) => ({ order, todo })) };
  const nightList: TodoListDto = { id: "demo-list-night", title: "화면 없이 잠드는 밤", description: "하루의 속도를 천천히 낮추는 30분", visibility: "PRIVATE", copyCount: 31, items: [todos[3], todos[5]].map((todo, order) => ({ order, todo })) };
  const authors = {
    hana: { id: "demo-user-hana", nickname: "윤슬", handle: "yoonseul.moves", avatarUrl: "/demo/avatar-flower.jpg", cloudRank: "포근구름", lifetimePower: 742 },
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
    { id: "demo-post-routine", author: authors.sol, caption: "퇴근 후 멍하니 휴대폰을 보던 시간을 짧은 회복 루틴으로 바꿨어요. 완벽하지 않아도 개운해요.", hashtags: ["회복루틴", "마음챙김"], mediaUrl: "/demo/stretch.jpg", todoList: publicList, todos: publicList.items.map((item) => item.todo), cheerCount: 84, commentCount: 5, copyCount: 128, createdAt: at(0, 19, 31), cheered: false },
    { id: "demo-post-walk", author: authors.hana, caption: "아침을 대충 넘기지 않으려고 좋아하는 과일을 가볍게 담았어요. 하루를 잘 돌보는 기분이에요.", hashtags: ["건강한아침", "요거트볼"], mediaUrl: "/demo/breakfast.jpg", todos: [publicWalk], cheerCount: 46, commentCount: 3, copyCount: 22, createdAt: at(0, 8, 24), cheered: true },
    { id: "demo-post-read", author: authors.june, caption: "짧게라도 매일 펼치니 어느새 이번 달 세 번째 책입니다 📚", hashtags: ["매일독서", "독서습관"], mediaUrl: "/demo/study.jpg", todos: [publicRead], cheerCount: 31, commentCount: 2, copyCount: 17, createdAt: at(-1, 21, 38), cheered: false },
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
    { id: "demo-challenge-official", title: "매일 7천 보, 가벼운 한 달", description: "하루 7천 보를 채우며 생활 속 움직임을 되찾아요.", kind: "OFFICIAL", verificationMode: "PEER_PHOTO", verificationCriteria: ["사진에서 걸음 수 또는 산책 기록을 확인할 수 있나요?", "사진이 오늘의 걷기 실천과 맞나요?", "재사용하거나 조작한 흔적 없이 자연스러운 인증인가요?"], minimumParticipants: 8, startsAt: at(-8, 0), endsAt: at(22, 23, 59), completionThreshold: 80, rewardLabel: "완주 리워드", rewardTerms: "완주율 80% 이상 달성 후 순차 지급해요.", creator: { id: "demo-official-admin", nickname: "뭉실 운영팀", handle: "mungsil.official" }, joined: true, todayCheckedIn: false, myCheckInCount: 7, successRate: 88, myRewardStatus: "NOT_ELIGIBLE", checkIns: [{ id: "demo-checkin-1", checkInDate: at(-1, 0), note: "점심시간에 공원을 크게 한 바퀴 걸었어요.", mediaUrl: "/demo/stretch.jpg", status: "APPROVED" }], _count: { participants: 1842, checkIns: 12840 } },
    { id: "demo-challenge-book", title: "잠들기 전 10쪽", description: "화면을 내려놓고 책으로 하루를 마무리해요.", kind: "COMMUNITY", verificationMode: "CHECK", startsAt: at(-3, 0), endsAt: at(18, 23, 59), completionThreshold: 70, firstPlaceTitle: "새벽 독서 구름", secondPlaceTitle: "꾸준한 책 구름", thirdPlaceTitle: "오늘도 독서 구름", creator: { id: "demo-author-sol", nickname: "솔", handle: "slow.sol" }, joined: true, chatUnreadCount: 3, _count: { participants: 326, checkIns: 1840 } },
    { id: "demo-challenge-water", title: "물 한 잔으로 시작하기", description: "아침 첫 커피 전에 물 한 잔을 마시는 작은 약속이에요.", kind: "COMMUNITY", verificationMode: "CHECK", startsAt: at(-12, 0), endsAt: at(12, 23, 59), completionThreshold: 80, firstPlaceTitle: "맑은 아침 구름", creator: { id: "demo-me", nickname: "몽글이", handle: "mongsil.day" }, joined: true, todayCheckedIn: true, myCheckInCount: 11, successRate: 85, checkIns: [{ id: "demo-checkin-water", checkInDate: at(0, 0), note: "눈 뜨자마자 시원하게 한 잔!", mediaUrl: null, status: "APPROVED" }], _count: { participants: 94, checkIns: 672 } },
  ];
  const notifications: DemoNotification[] = [
    { id: "demo-notice-1", type: "CHEER", title: "새로운 응원을 받았어요", body: "윤슬님이 ‘출근 전 20분 산책’을 응원했어요.", referenceId: "demo-post-walk", targetType: "POST", targetId: "demo-post-walk", href: "/posts/demo-post-walk", createdAt: at(0, 14, 2) },
    { id: "demo-notice-2", type: "COPY", title: "내 루틴이 새로운 하루로", body: "3명이 ‘화면 없이 잠드는 밤’을 가져갔어요.", createdAt: at(-1, 18), readAt: at(-1, 20) },
    { id: "demo-notice-3", type: "RANK", title: "조각구름이 되었어요", body: "작은 실천이 모여 새로운 뭉실 등급에 도착했어요.", createdAt: at(-3, 12), readAt: at(-3, 13) },
  ];
  const chatMessage = (value: Partial<ChallengeChatMessage> & Pick<ChallengeChatMessage, "id" | "createdAt">): ChallengeChatMessage => ({ kind: "USER", body: null, sender: authors.sol, replyTo: null, media: [], reactions: [], links: [], editedAt: null, deletedAt: null, hiddenAt: null, blocked: false, canEdit: false, canDelete: false, canModerate: false, ...value });
  const chats: Record<string, ChallengeChatMessage[]> = {
    "demo-challenge-book": [
      chatMessage({ id: "demo-chat-book-system", kind: "SYSTEM", sender: null, body: "챌린지가 시작됐어요. 서로에게 도움이 되는 팁과 경험을 나눠보세요.", createdAt: at(-3, 0) }),
      chatMessage({ id: "demo-chat-book-1", sender: authors.june, body: "전자책으로 읽을 때는 취침 모드를 켜두면 눈이 덜 피곤하더라고요.", reactions: [{ type: "HELPFUL", count: 7, mine: false }], createdAt: at(-1, 21, 10) }),
      chatMessage({ id: "demo-chat-book-2", sender: authors.sol, body: "저는 타이머보다 책갈피에 오늘 목표 쪽수를 적어두는 방식이 좋았어요. https://example.com/reading-tip", links: [{ url: "https://example.com/reading-tip", domain: "example.com" }], reactions: [{ type: "LIKE", count: 4, mine: true }, { type: "SEEN", count: 2, mine: false }], editedAt: at(0, 20, 32), createdAt: at(0, 20, 28) }),
      chatMessage({ id: "demo-chat-book-3", sender: authors.hana, body: "이 조명 밝기면 글씨가 잘 보이는지 한번 봐주세요!", media: [{ id: "demo-chat-media-1", url: "/demo/study.jpg", thumbnailUrl: "/demo/study.jpg" }], createdAt: at(0, 21, 2) }),
      chatMessage({ id: "demo-chat-book-4", sender: { id: user.id, nickname: user.nickname, handle: user.handle, avatarUrl: user.avatarUrl, cloudRank: "조각구름", lifetimePower: user.lifetimePower }, body: "좋은 팁이네요. 오늘부터 저도 책갈피에 적어볼게요.", replyTo: { id: "demo-chat-book-2", body: "저는 타이머보다 책갈피에 오늘 목표 쪽수를 적어두는 방식이 좋았어요.", senderNickname: "솔", deleted: false }, canEdit: true, canDelete: true, createdAt: new Date(Date.now() - 120_000).toISOString() }),
    ],
    "demo-challenge-official": [chatMessage({ id: "demo-chat-official-system", kind: "SYSTEM", sender: null, body: "챌린지가 시작됐어요. 걷기 팁과 안전 정보를 나눠보세요.", createdAt: at(-8, 0) }), chatMessage({ id: "demo-chat-official-1", sender: authors.hana, body: "저녁 산책할 때는 밝은 색 겉옷이 생각보다 중요해요.", reactions: [{ type: "SEEN", count: 12, mine: false }], createdAt: at(0, 19) })],
    "demo-challenge-water": [chatMessage({ id: "demo-chat-water-system", kind: "SYSTEM", sender: null, body: "챌린지가 시작됐어요. 서로의 작은 요령을 나눠보세요.", createdAt: at(-12, 0) }), chatMessage({ id: "demo-chat-water-1", sender: authors.june, body: "침대 옆에 작은 물병을 두니 잊지 않게 돼요.", canModerate: true, createdAt: at(0, 7, 40) })],
  };
  const directMessage = (value: Partial<DirectChatMessage> & Pick<DirectChatMessage, "id" | "createdAt">): DirectChatMessage => ({ kind: "USER", body: null, sender: authors.hana, replyTo: null, media: [], reactions: [], links: [], deletedAt: null, hiddenAt: null, blocked: false, canDelete: false, ...value });
  const directMessages: Record<string, DirectChatMessage[]> = {
    "demo-direct-hana": [
      directMessage({ id: "demo-direct-hana-1", body: "아침 산책 게시물 보고 저도 오늘 한 정거장 먼저 내려봤어요.", sender: authors.hana, createdAt: at(-1, 18, 20) }),
      directMessage({ id: "demo-direct-hana-2", body: "좋네요! 퇴근길에도 무리 없이 천천히 걸어보세요.", sender: { id: user.id, nickname: user.nickname, handle: user.handle, avatarUrl: user.avatarUrl, cloudRank: "조각구름", lifetimePower: user.lifetimePower }, canDelete: true, createdAt: at(-1, 18, 28) }),
      directMessage({ id: "demo-direct-hana-3", body: "고마워요. 오늘은 날씨도 좋아서 기분이 더 좋았어요 ☁️", sender: authors.hana, reactions: [{ type: "LIKE", count: 1, mine: false }], createdAt: at(0, 9, 15) }),
    ],
  };
  return { day: dayKey(), user, todos, deletedTodos: [], lists: [morningList, nightList], feed, comments, challenges, chats, chatSettings: {}, chatMutes: {}, chatRevisions: { "demo-chat-book-2": [{ id: "demo-revision-1", body: "저는 타이머보다 책갈피를 써요.", createdAt: at(0, 20, 30) }, { id: "demo-revision-2", body: "저는 타이머보다 책갈피에 오늘 목표 쪽수를 적어두는 방식이 좋았어요. https://example.com/reading-tip", createdAt: at(0, 20, 32) }] }, directMessages, directPeople: { "demo-direct-hana": authors.hana }, directRequests: [{ id: "demo-request-june", sender: authors.june, createdAt: at(0, 8, 50) }], blockedUsers: [], notifications, following: [] };
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
  const state = JSON.parse(window.localStorage.getItem(DEMO_DATA_KEY) ?? "null") as DemoState;
  state.deletedTodos ??= [];
  state.chats ??= {};
  state.chatSettings ??= {};
  state.chatMutes ??= {};
  state.chatRevisions ??= {};
  state.directMessages ??= {};
  state.directPeople ??= {};
  state.directRequests ??= [];
  state.blockedUsers ??= [];
  state.feed.forEach((post) => { post.hashtags ??= []; });
  state.challenges.forEach((challenge) => {
    challenge.completionThreshold ??= 80;
    challenge.creator ??= challenge.kind === "OFFICIAL" ? { id: "demo-official-admin", nickname: "뭉실 운영팀", handle: "mungsil.official" } : { id: state.user.id, nickname: state.user.nickname, handle: state.user.handle };
    challenge.checkIns?.forEach((item) => { item.status ??= "APPROVED"; });
  });
  return state;
}

function writeState(state: DemoState) {
  window.localStorage.setItem(DEMO_DATA_KEY, JSON.stringify(state));
}

function setDemoTodoList(state: DemoState, todo: TodoDto, todoListId: unknown) {
  for (const list of state.lists) {
    list.items = list.items.filter(({ todo: listed }) => listed.id !== todo.id && !(todo.seriesId && listed.seriesId === todo.seriesId));
  }
  if (typeof todoListId !== "string") return;
  const target = state.lists.find((list) => list.id === todoListId);
  if (!target) throw new Error("루틴 묶음을 찾지 못했어요.");
  target.items.push({ order: target.items.length, todo: { ...todo } });
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
  if (demoAdminPreview && pathname === "/admin/overview" && method === "GET") return clone({ users: { total: 24, newLast7Days: 7, verified: 21, suspended: 1, activeLast7Days: 16 }, activity: { completedTodosLast7Days: 138, publishedPostsLast7Days: 52, copiedTodosLast7Days: 31 }, moderation: { openReports: 3, pendingCheckIns: 5 }, invites: { active: 2 } }) as T;
  if (demoAdminPreview && pathname === "/admin/invite-codes" && method === "GET") return clone({ items: [{ id: "preview-invite", label: "1차 내부 테스터", maxUses: 30, uses: 18, expiresAt: at(30, 23, 59), disabledAt: null, createdAt: at(-10, 9), state: "ACTIVE" }] }) as T;
  if (demoAdminPreview && pathname === "/admin/users" && method === "GET") return clone({ items: [{ id: "preview-user", email: "sky@example.com", nickname: "하늘", handle: "sky.todo", role: "USER", emailVerifiedAt: at(-20, 9), suspendedAt: null, createdAt: at(-20, 9), _count: { todos: 42, posts: 12, sessions: 1 } }], nextCursor: null }) as T;
  if (demoAdminPreview && pathname === "/admin/reports" && method === "GET") return clone({ items: [{ id: "preview-message-report", targetType: "MESSAGE", targetId: "demo-chat-book-2", reason: "부적절한 외부 링크가 포함돼 있어요.", status: "OPEN", targetPreview: "저는 타이머보다 책갈피에 오늘 목표 쪽수를 적어두는 방식이 좋았어요.", targetHidden: Boolean(state.chats["demo-challenge-book"]?.find((item) => item.id === "demo-chat-book-2")?.hiddenAt), createdAt: at(0, 11), reporter: { id: "demo-user-hana", nickname: "윤슬", handle: "yoonseul.moves" } }, { id: "preview-report", targetType: "POST", targetId: "demo-post-walk", reason: "광고성 콘텐츠", status: "OPEN", targetPreview: "하루 10분이면 누구나 시작할 수 있어요.", targetHidden: false, createdAt: at(0, 10), reporter: { id: "demo-user-hana", nickname: "윤슬", handle: "yoonseul.moves" } }] }) as T;
  if (demoAdminPreview && pathname === "/admin/reports/preview-message-report/message-context" && method === "GET") {
    const items = state.chats["demo-challenge-book"] ?? [];
    const targetIndex = items.findIndex((item) => item.id === "demo-chat-book-2");
    return clone({ reportId: "preview-message-report", targetMessageId: "demo-chat-book-2", items: items.slice(Math.max(0, targetIndex - 3), targetIndex + 4).map((item) => ({ id: item.id, body: item.body, sender: item.sender, deletedAt: item.deletedAt ?? null, hiddenAt: item.hiddenAt ?? null, createdAt: item.createdAt, media: item.media })), revisions: state.chatRevisions["demo-chat-book-2"] ?? [] }) as T;
  }
  const adminChatVisibilityMatch = pathname.match(/^\/admin\/chat\/messages\/([^/]+)\/visibility$/);
  if (demoAdminPreview && adminChatVisibilityMatch && method === "PATCH") {
    const message = Object.values(state.chats).flat().find((item) => item.id === adminChatVisibilityMatch[1]);
    if (message) message.hiddenAt = body.hidden ? new Date().toISOString() : null;
    writeState(state);
    return clone({ ok: true }) as T;
  }
  if (demoAdminPreview && pathname === "/admin/challenge-verifications" && method === "GET") return clone({ pending: 5, delayed: 1, approved24h: 18, rejected24h: 3, insufficientPools: [], items: [{ id: "preview-checkin", challenge: { id: "demo-challenge-official", title: "매일 7천 보, 가벼운 한 달", _count: { participants: 1842 } }, attempt: 1, reviewSize: 5, validVotes: 3, unsureVotes: 1, submittedAt: at(0, 9) }] }) as T;
  if (demoAdminPreview && pathname === "/admin/content" && method === "GET") return clone({ items: [{ id: "demo-post-walk", type: "POST", preview: "아침을 대충 넘기지 않으려고 좋아하는 과일을 담았어요.", contextId: "demo-post-walk", context: "46개 응원 · 3개 댓글", author: { id: "demo-user-hana", nickname: "윤슬", handle: "yoonseul.moves" }, hiddenAt: null, createdAt: at(0, 8), reportCount: 1 }], nextCursor: null }) as T;
  if (demoAdminPreview && pathname === "/admin/audit-logs" && method === "GET") return clone({ items: [{ id: "preview-audit", action: "INVITE_CODE_CREATED", targetType: "INVITE_CODE", targetId: "preview-invite", summary: "1차 내부 테스터 생성", createdAt: at(-1, 15), admin: { id: state.user.id, nickname: state.user.nickname, handle: state.user.handle } }], nextCursor: null }) as T;
  if (demoAdminPreview && /^\/admin\/challenges\/[^/]+\/(?:participants|check-ins)$/.test(pathname) && method === "GET") return clone({ items: [] }) as T;
  if (pathname === "/auth/logout" || pathname === "/auth/delete-account") return {} as T;
  if (pathname === "/me" && method === "GET") return clone({ ...state.user, rank: "조각구름", _count: { followers: 48, following: 31, posts: state.feed.filter((post) => post.author.id === state.user.id).length }, stats: { completedCount: state.todos.filter((todo) => todo.completedAt).length, receivedCheers: 18, copiedCount: 9 }, earnedTitles: state.challenges.flatMap((challenge) => challenge.titleAwarded ? [{ titleAwarded: challenge.titleAwarded, finalRank: challenge.myRank, challenge: { id: challenge.id, title: challenge.title } }] : []) }) as T;
  if (pathname === "/me" && method === "PATCH") {
    state.user = { ...state.user, ...body } as SessionUser;
    writeState(state);
    return clone(state.user) as T;
  }
  if (pathname === "/me/notifications" && method === "GET") return clone({ items: state.notifications, nextCursor: null, unreadCount: state.notifications.filter((item) => !item.readAt).length }) as T;
  if (pathname === "/me/notifications/unread-count" && method === "GET") return clone({ count: state.notifications.filter((item) => !item.readAt).length }) as T;
  if (pathname === "/me/notifications/read" && method === "POST") {
    state.notifications = state.notifications.map((item) => ({ ...item, readAt: item.readAt ?? new Date().toISOString() }));
    writeState(state);
    return {} as T;
  }

  if (pathname === "/messages/unread-count" && method === "GET") {
    const directCount = Object.entries(state.directMessages).reduce((sum, [conversationId, messages]) => sum + (conversationId === "demo-direct-hana" ? messages.filter((item) => item.sender?.id !== state.user.id && !item.deletedAt && !item.hiddenAt).slice(-1).length : 0), 0);
    const challengeCount = state.challenges.filter((item) => item.joined).reduce((sum, item) => sum + (item.chatUnreadCount ?? 0), 0);
    const count = directCount + challengeCount;
    return clone({ count }) as T;
  }
  if (pathname === "/messages/requests" && method === "GET") return clone(state.directRequests) as T;
  if (pathname === "/messages/requests" && method === "POST") {
    const receiverId = String(body.receiverId);
    const existing = Object.entries(state.directPeople).find(([, person]) => person.id === receiverId);
    if (existing) return clone({ kind: "CONVERSATION", conversationId: existing[0] }) as T;
    const incoming = state.directRequests.find((request) => request.sender.id === receiverId);
    if (incoming) {
      const conversationId = `demo-direct-${receiverId}`;
      state.directPeople[conversationId] = incoming.sender;
      state.directMessages[conversationId] = [];
      state.directRequests = state.directRequests.filter((request) => request.id !== incoming.id);
      writeState(state);
      return clone({ kind: "CONVERSATION", conversationId }) as T;
    }
    const person = state.feed.map((post) => post.author).find((author) => author.id === receiverId);
    if (!person) throw new Error("사용자를 찾지 못했어요.");
    writeState(state);
    return clone({ kind: "REQUEST", requestId: uid("demo-request") }) as T;
  }
  const directRequestMatch = pathname.match(/^\/messages\/requests\/([^/]+)$/);
  const directAcceptMatch = pathname.match(/^\/messages\/requests\/([^/]+)\/accept$/);
  if (directAcceptMatch && method === "POST") {
    const request = state.directRequests.find((item) => item.id === directAcceptMatch[1]);
    if (!request) throw new Error("메시지 요청을 찾지 못했어요.");
    const conversationId = `demo-direct-${request.sender.id}`;
    state.directPeople[conversationId] = request.sender;
    state.directMessages[conversationId] ??= [];
    state.directRequests = state.directRequests.filter((item) => item.id !== request.id);
    writeState(state);
    return clone({ kind: "CONVERSATION", conversationId }) as T;
  }
  if (directRequestMatch && method === "DELETE") { state.directRequests = state.directRequests.filter((item) => item.id !== directRequestMatch[1]); writeState(state); return clone({ ok: true }) as T; }
  if (pathname === "/messages/inbox" && method === "GET") {
    const direct: ChatInboxItem[] = Object.entries(state.directMessages).flatMap(([id, messages]) => {
      const otherUser = state.directPeople[id], last = messages.at(-1);
      if (!otherUser) return [];
      return [{ id, kind: "DIRECT", href: `/messages/${id}`, title: otherUser.nickname, subtitle: `@${otherUser.handle}`, avatarUrl: otherUser.avatarUrl, unreadCount: id === "demo-direct-hana" ? 1 : 0, readOnly: false, lastMessage: last ? { id: last.id, body: last.deletedAt || last.hiddenAt ? null : last.body, hasMedia: Boolean(!last.deletedAt && !last.hiddenAt && last.media.length), deleted: Boolean(last.deletedAt || last.hiddenAt), senderId: last.sender?.id, senderNickname: last.sender?.nickname ?? null, createdAt: last.createdAt } : null, updatedAt: last?.createdAt ?? new Date().toISOString() }];
    });
    const challenge: ChatInboxItem[] = state.challenges.filter((item) => item.joined).map((item) => {
      const messages = state.chats[item.id] ?? [], last = messages.at(-1);
      return { id: `demo-chat-${item.id}`, kind: "CHALLENGE", href: `/challenges/${item.id}/chat`, title: item.title, subtitle: `참여자 ${item._count.participants.toLocaleString("ko-KR")}명`, avatarUrl: null, unreadCount: item.chatUnreadCount ?? 0, readOnly: Boolean(item.chatReadOnly || item.endedAt || new Date(item.endsAt) <= new Date()), lastMessage: last ? { id: last.id, body: last.deletedAt || last.hiddenAt ? null : last.body, hasMedia: Boolean(!last.deletedAt && !last.hiddenAt && last.media.length), deleted: Boolean(last.deletedAt || last.hiddenAt), senderId: last.sender?.id, senderNickname: last.sender?.nickname ?? null, createdAt: last.createdAt } : null, updatedAt: last?.createdAt ?? item.startsAt };
    });
    return clone([...direct, ...challenge].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())) as T;
  }
  if (pathname === "/messages" && method === "GET") {
    const conversations: DirectConversation[] = Object.entries(state.directMessages).map(([id, messages]) => {
      const otherUser = state.directPeople[id]; const last = messages.at(-1); const blockedByMe = Boolean(otherUser && state.blockedUsers.includes(otherUser.id));
      return { id, otherUser, unreadCount: id === "demo-direct-hana" ? 1 : 0, blocked: blockedByMe, blockedByMe, canSend: !blockedByMe, lastMessage: last ? { id: last.id, body: last.deletedAt || last.hiddenAt ? null : last.body, hasMedia: Boolean(!last.deletedAt && !last.hiddenAt && last.media.length), deleted: Boolean(last.deletedAt || last.hiddenAt), senderId: last.sender?.id, createdAt: last.createdAt } : null, updatedAt: last?.createdAt ?? new Date().toISOString() };
    }).filter((item) => item.otherUser).sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
    return clone(conversations) as T;
  }
  const directReadMatch = pathname.match(/^\/messages\/([^/]+)\/read$/);
  if (directReadMatch && method === "POST") return clone({ ok: true }) as T;
  const directMessageCreateMatch = pathname.match(/^\/messages\/([^/]+)\/messages$/);
  if (directMessageCreateMatch && method === "POST") {
    const conversationId = directMessageCreateMatch[1], other = state.directPeople[conversationId];
    if (!other) throw new Error("대화를 찾지 못했어요.");
    if (state.blockedUsers.includes(other.id)) throw new Error("차단된 사용자와는 메시지를 주고받을 수 없어요.");
    const text = body.body ? String(body.body) : null;
    const reply = body.replyToId ? (state.directMessages[conversationId] ?? []).find((item) => item.id === body.replyToId) : null;
    const links = [...new Set(text?.match(/https?:\/\/[^\s<>()]+/gi) ?? [])].flatMap((link) => { try { const parsed = new URL(link); return [{ url: parsed.toString(), domain: parsed.hostname.replace(/^www\./, "") }]; } catch { return []; } });
    const message: DirectChatMessage = { id: uid("demo-direct-message"), kind: "USER", body: text, sender: { id: state.user.id, nickname: state.user.nickname, handle: state.user.handle, avatarUrl: state.user.avatarUrl, cloudRank: "조각구름", lifetimePower: state.user.lifetimePower }, replyTo: reply ? { id: reply.id, body: reply.body, senderNickname: reply.sender?.nickname ?? null, deleted: Boolean(reply.deletedAt || reply.hiddenAt) } : null, media: (Array.isArray(body.mediaIds) ? body.mediaIds : []).slice(0, 4).map((url, index) => ({ id: uid(`demo-direct-media-${index}`), url: String(url), thumbnailUrl: String(url) })), reactions: [], links, deletedAt: null, hiddenAt: null, blocked: false, canDelete: true, createdAt: new Date().toISOString() };
    state.directMessages[conversationId] ??= []; state.directMessages[conversationId].push(message); writeState(state); return clone(message) as T;
  }
  const directMessageItemMatch = pathname.match(/^\/messages\/([^/]+)\/messages\/([^/]+)$/);
  if (directMessageItemMatch && method === "DELETE") { const message = (state.directMessages[directMessageItemMatch[1]] ?? []).find((item) => item.id === directMessageItemMatch[2]); if (message?.canDelete) { message.deletedAt = new Date().toISOString(); message.body = null; message.media = []; } writeState(state); return clone({ ok: true }) as T; }
  const directReactionMatch = pathname.match(/^\/messages\/([^/]+)\/messages\/([^/]+)\/reactions$/);
  if (directReactionMatch && method === "POST") { const message = (state.directMessages[directReactionMatch[1]] ?? []).find((item) => item.id === directReactionMatch[2]); if (!message) throw new Error("메시지를 찾지 못했어요."); const type = body.type as DirectChatMessage["reactions"][number]["type"]; const current = message.reactions.find((item) => item.type === type); if (current?.mine) { current.mine = false; current.count -= 1; if (current.count <= 0) message.reactions = message.reactions.filter((item) => item.type !== type); } else if (current) { current.mine = true; current.count += 1; } else message.reactions.push({ type, count: 1, mine: true }); writeState(state); return clone(message.reactions) as T; }
  if (directReactionMatch && method === "GET") { const message = (state.directMessages[directReactionMatch[1]] ?? []).find((item) => item.id === directReactionMatch[2]); const reaction = message?.reactions.find((item) => item.type === url.searchParams.get("type")); const people = [state.user, state.directPeople[directReactionMatch[1]]].filter(Boolean); return clone(people.slice(0, reaction?.count ?? 0).map((user) => ({ user: { id: user.id, nickname: user.nickname, handle: user.handle, avatarUrl: user.avatarUrl } }))) as T; }
  const directConversationMatch = pathname.match(/^\/messages\/([^/]+)$/);
  if (directConversationMatch && method === "GET") {
    const conversationId = directConversationMatch[1], otherUser = state.directPeople[conversationId]; if (!otherUser) throw new Error("대화를 찾지 못했어요."); const blockedByMe = state.blockedUsers.includes(otherUser.id);
    return clone({ room: { conversationId, otherUser, unreadCount: 0, blocked: blockedByMe, blockedByMe, canSend: !blockedByMe }, items: state.directMessages[conversationId] ?? [], nextCursor: null }) as T;
  }

  if (pathname === "/todos" && method === "GET") {
    const from = url.searchParams.get("from"); const to = url.searchParams.get("to");
    return clone(state.todos.filter((todo) => (!from || new Date(todo.dueDate) >= new Date(from)) && (!to || new Date(todo.dueDate) <= new Date(to)))) as T;
  }
  if (pathname === "/todos" && method === "POST") {
    const repeatRule = body.repeatRule ? String(body.repeatRule) : null;
    const todo: TodoDto = { id: uid("demo-todo"), seriesId: repeatRule ? uid("demo-series") : null, title: String(body.title), notes: body.notes ? String(body.notes) : null, dueDate: String(body.dueDate), visibility: (body.visibility as TodoDto["visibility"]) ?? "PRIVATE", repeatRule, category: String(body.category ?? "기타") };
    state.todos.push(todo); setDemoTodoList(state, todo, body.todoListId); writeState(state); return clone(todo) as T;
  }
  const todoMatch = pathname.match(/^\/todos\/([^/]+)$/);
  if (todoMatch && method === "PATCH") {
    const index = state.todos.findIndex((item) => item.id === todoMatch[1]);
    if (index < 0) throw new Error("TODO를 찾지 못했어요.");
    const { todoListId, ...changes } = body;
    state.todos[index] = { ...state.todos[index], ...changes } as TodoDto;
    if (changes.repeatRule === null) state.todos[index].seriesId = null;
    else if (typeof changes.repeatRule === "string" && !state.todos[index].seriesId) state.todos[index].seriesId = uid("demo-series");
    for (const list of state.lists) {
      list.items = list.items.map((item) => item.todo.id === state.todos[index].id ? { ...item, todo: { ...state.todos[index] } } : item);
    }
    if (todoListId !== undefined) setDemoTodoList(state, state.todos[index], todoListId);
    writeState(state); return clone(state.todos[index]) as T;
  }
  if (todoMatch && method === "DELETE") {
    const removed = state.todos.find((item) => item.id === todoMatch[1]);
    if (removed) state.deletedTodos.push(removed);
    state.todos = state.todos.filter((item) => item.id !== todoMatch[1]); writeState(state); return {} as T;
  }
  const restoreMatch = pathname.match(/^\/todos\/([^/]+)\/restore$/);
  if (restoreMatch && method === "POST") {
    const restored = state.deletedTodos.find((item) => item.id === restoreMatch[1]);
    if (restored) state.todos.push(restored);
    state.deletedTodos = state.deletedTodos.filter((item) => item.id !== restoreMatch[1]);
    writeState(state);
    return clone(restored ?? {}) as T;
  }
  const completeMatch = pathname.match(/^\/todos\/([^/]+)\/complete$/);
  if (completeMatch && method === "POST") {
    const todo = state.todos.find((item) => item.id === completeMatch[1]);
    if (!todo) throw new Error("TODO를 찾지 못했어요.");
    todo.completedAt = todo.completedAt ?? new Date().toISOString();
    if (body.share && !state.feed.some((post) => post.todos.some((item) => item.id === todo.id))) {
      state.feed.unshift({ id: uid("demo-post"), author: { id: state.user.id, nickname: state.user.nickname, handle: state.user.handle, avatarUrl: state.user.avatarUrl, cloudRank: "조각구름", lifetimePower: state.user.lifetimePower }, caption: body.caption ? String(body.caption) : null, hashtags: Array.isArray(body.hashtags) ? body.hashtags.map(String) : [], mediaUrl: body.mediaId ? String(body.mediaId) : null, todos: [todo], cheerCount: 0, commentCount: 0, copyCount: 0, createdAt: new Date().toISOString(), cheered: false });
    }
    writeState(state); return clone(todo) as T;
  }
  const uncompleteMatch = pathname.match(/^\/todos\/([^/]+)\/uncomplete$/);
  if (uncompleteMatch && method === "POST") {
    const todo = state.todos.find((item) => item.id === uncompleteMatch[1]);
    if (!todo) throw new Error("TODO를 찾지 못했어요.");
    todo.completedAt = null;
    writeState(state);
    return clone(todo) as T;
  }
  const seriesMatch = pathname.match(/^\/todos\/([^/]+)\/series$/);
  if (seriesMatch && method === "DELETE") {
    const source = state.todos.find((item) => item.id === seriesMatch[1]);
    if (source?.seriesId) state.todos = state.todos.filter((item) => item.seriesId !== source.seriesId || item.completedAt);
    writeState(state);
    return {} as T;
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
    const repeatMode = body.repeatMode === "NONE" || body.repeatMode === "CUSTOM" ? body.repeatMode : "KEEP";
    const overrides = new Map((Array.isArray(body.items) ? body.items : []).map((item) => {
      const draft = item as Record<string, unknown>;
      return [String(draft.sourceTodoId), draft];
    }));
    const copiedTodos = source.items.map((item, order) => {
      const draft = overrides.get(item.todo.id);
      const repeatRule = repeatMode === "NONE" ? null : repeatMode === "CUSTOM" && draft && "repeatRule" in draft ? (draft.repeatRule ? String(draft.repeatRule) : null) : item.todo.repeatRule;
      return { ...item.todo, id: uid(`demo-list-copy-${order}`), title: draft?.title ? String(draft.title) : item.todo.title, category: draft?.category ? String(draft.category) : item.todo.category, dueDate: draft?.dueDate ? String(draft.dueDate) : new Date(baseDate.getTime() + order * 15 * 60_000).toISOString(), repeatRule, completedAt: null, visibility: "PRIVATE" as const, sourceTodoId: item.todo.id };
    });
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
    if (!list) throw new Error("게시할 루틴을 찾지 못했어요.");
    const post: FeedPost = { id: uid("demo-post"), author: { id: state.user.id, nickname: state.user.nickname, handle: state.user.handle, cloudRank: "조각구름", lifetimePower: state.user.lifetimePower }, caption: body.caption ? String(body.caption) : null, hashtags: Array.isArray(body.hashtags) ? body.hashtags.map(String) : [], mediaUrl: body.mediaId ? String(body.mediaId) : null, todoList: list, todos: list.items.map((item) => item.todo), cheerCount: 0, commentCount: 0, copyCount: 0, createdAt: new Date().toISOString(), cheered: false };
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
  const commentDeleteMatch = pathname.match(/^\/feed\/comments\/([^/]+)$/);
  if (commentDeleteMatch && method === "DELETE") {
    for (const [postId, comments] of Object.entries(state.comments)) {
      const next = comments.filter((item) => item.id !== commentDeleteMatch[1]);
      if (next.length !== comments.length) {
        state.comments[postId] = next;
        const post = state.feed.find((item) => item.id === postId);
        if (post) post.commentCount = Math.max(0, post.commentCount - 1);
      }
    }
    writeState(state);
    return {} as T;
  }
  const postMatch = pathname.match(/^\/(?:feed|public)\/posts\/([^/]+)$/);
  if (postMatch && method === "GET") {
    const post = state.feed.find((item) => item.id === postMatch[1]); if (!post) throw new Error("게시물을 찾지 못했어요."); return clone(post) as T;
  }
  if (postMatch && method === "DELETE") {
    state.feed = state.feed.filter((item) => item.id !== postMatch[1]);
    delete state.comments[postMatch[1]];
    writeState(state);
    return {} as T;
  }

  if ((pathname === "/challenges" || pathname === "/public/challenges") && method === "GET") return clone(state.challenges) as T;
  if (pathname === "/challenges/past" && method === "GET") return clone(state.challenges.filter((item) => item.joined && Boolean(item.endedAt || new Date(item.endsAt) < new Date()))) as T;
  if (pathname === "/challenges" && method === "POST") {
    const kind = body.kind === "OFFICIAL" ? "OFFICIAL" : "COMMUNITY";
    if (kind === "COMMUNITY" && state.user.availablePoints < 500) throw new Error("커뮤니티 챌린지 생성에는 500 포인트가 필요해요.");
    const challenge: Challenge = { id: uid("demo-challenge"), title: String(body.title), description: String(body.description), kind, verificationMode: body.verificationMode as Challenge["verificationMode"], verificationCriteria: Array.isArray(body.verificationCriteria) ? body.verificationCriteria.map(String) : [], minimumParticipants: 8, startsAt: String(body.startsAt), endsAt: String(body.endsAt), completionThreshold: Number(body.completionThreshold ?? 80), rewardLabel: body.rewardLabel ? String(body.rewardLabel) : null, rewardTerms: body.rewardTerms ? String(body.rewardTerms) : null, firstPlaceTitle: body.firstPlaceTitle ? String(body.firstPlaceTitle) : null, secondPlaceTitle: body.secondPlaceTitle ? String(body.secondPlaceTitle) : null, thirdPlaceTitle: body.thirdPlaceTitle ? String(body.thirdPlaceTitle) : null, creator: { id: state.user.id, nickname: state.user.nickname, handle: state.user.handle }, joined: kind === "COMMUNITY", todayCheckedIn: false, myCheckInCount: 0, successRate: 0, checkIns: [], _count: { participants: kind === "COMMUNITY" ? 1 : 0, checkIns: 0 } };
    if (kind === "COMMUNITY") state.user.availablePoints -= 500;
    state.chats[challenge.id] = [{ id: uid("demo-system"), kind: "SYSTEM", body: "챌린지가 시작됐어요. 서로에게 도움이 되는 팁과 경험을 나눠보세요.", sender: null, replyTo: null, media: [], reactions: [], links: [], blocked: false, canEdit: false, canDelete: false, canModerate: false, createdAt: new Date().toISOString() }];
    state.challenges.unshift(challenge);
    writeState(state);
    return clone(challenge) as T;
  }
  const chatMatch = pathname.match(/^\/challenges\/([^/]+)\/chat$/);
  if (chatMatch && method === "GET") {
    const challenge = state.challenges.find((item) => item.id === chatMatch[1]);
    if (!challenge?.joined) throw new Error("이 대화방은 챌린지 참여자만 볼 수 있어요.");
    const items = state.chats[challenge.id] ?? [];
    const readOnly = Boolean(challenge.endedAt || new Date(challenge.endsAt) < new Date());
    return clone({ room: { challengeId: challenge.id, conversationId: `demo-room-${challenge.id}`, title: challenge.title, participantCount: challenge._count.participants, unreadCount: challenge.chatUnreadCount ?? 0, notificationLevel: state.chatSettings[challenge.id] ?? "ALL", readOnly, purgeAt: readOnly ? at(90, 0) : null, canManage: challenge.kind === "COMMUNITY" && challenge.creator?.id === state.user.id, mutedUntil: state.chatMutes[challenge.id]?.[state.user.id] ?? null }, items, nextCursor: null }) as T;
  }
  const chatSummaryMatch = pathname.match(/^\/challenges\/([^/]+)\/chat\/summary$/);
  if (chatSummaryMatch && method === "GET") {
    const challenge = state.challenges.find((item) => item.id === chatSummaryMatch[1]); if (!challenge?.joined) throw new Error("대화방을 볼 수 없어요.");
    return clone({ challengeId: challenge.id, conversationId: `demo-room-${challenge.id}`, title: challenge.title, participantCount: challenge._count.participants, unreadCount: challenge.chatUnreadCount ?? 0, notificationLevel: state.chatSettings[challenge.id] ?? "ALL", readOnly: false, canManage: challenge.kind === "COMMUNITY" && challenge.creator?.id === state.user.id }) as T;
  }
  const chatMembersMatch = pathname.match(/^\/challenges\/([^/]+)\/chat\/members$/);
  if (chatMembersMatch && method === "GET") {
    const challenge = state.challenges.find((item) => item.id === chatMembersMatch[1]); if (!challenge?.joined) throw new Error("대화방을 볼 수 없어요.");
    const people = [{ id: state.user.id, nickname: state.user.nickname, handle: state.user.handle, avatarUrl: state.user.avatarUrl, cloudRank: "조각구름", lifetimePower: state.user.lifetimePower }, ...Array.from(new Map(state.feed.map((post) => [post.author.id, post.author])).values()).slice(0, 3)];
    return clone({ items: people.map((user, index) => ({ user, joinedAt: at(-10 + index, 9), mutedUntil: state.chatMutes[challenge.id]?.[user.id] ?? null, canModerate: challenge.kind === "COMMUNITY" && challenge.creator?.id === state.user.id && user.id !== state.user.id })), nextCursor: null }) as T;
  }
  const chatReadMatch = pathname.match(/^\/challenges\/([^/]+)\/chat\/read$/);
  if (chatReadMatch && method === "POST") { const challenge = state.challenges.find((item) => item.id === chatReadMatch[1]); if (challenge) challenge.chatUnreadCount = 0; writeState(state); return {} as T; }
  const chatSettingsMatch = pathname.match(/^\/challenges\/([^/]+)\/chat\/settings$/);
  if (chatSettingsMatch && method === "PATCH") { state.chatSettings[chatSettingsMatch[1]] = body.notificationLevel as ChatNotificationLevel; writeState(state); return clone({ notificationLevel: body.notificationLevel }) as T; }
  const chatMessageCreateMatch = pathname.match(/^\/challenges\/([^/]+)\/chat\/messages$/);
  if (chatMessageCreateMatch && method === "POST") {
    const challenge = state.challenges.find((item) => item.id === chatMessageCreateMatch[1]); if (!challenge?.joined) throw new Error("대화방을 볼 수 없어요.");
    if (challenge.endedAt || new Date(challenge.endsAt) <= new Date()) throw new Error("종료된 챌린지의 대화는 읽기만 할 수 있어요.");
    if (state.chatMutes[challenge.id]?.[state.user.id] && new Date(state.chatMutes[challenge.id][state.user.id]) > new Date()) throw new Error("채팅이 제한된 동안은 메시지를 보낼 수 없어요.");
    const text = body.body ? String(body.body) : null;
    const links = [...new Set(text?.match(/https?:\/\/[^\s<>()]+/gi) ?? [])].flatMap((link) => { try { const parsed = new URL(link); return [{ url: parsed.toString(), domain: parsed.hostname.replace(/^www\./, "") }]; } catch { return []; } });
    const reply = body.replyToId ? (state.chats[challenge.id] ?? []).find((item) => item.id === body.replyToId) : null;
    const message: ChallengeChatMessage = { id: uid("demo-chat"), kind: "USER", body: text, sender: { id: state.user.id, nickname: state.user.nickname, handle: state.user.handle, avatarUrl: state.user.avatarUrl, cloudRank: "조각구름", lifetimePower: state.user.lifetimePower }, replyTo: reply ? { id: reply.id, body: reply.body, senderNickname: reply.sender?.nickname ?? null, deleted: Boolean(reply.deletedAt || reply.hiddenAt) } : null, media: (Array.isArray(body.mediaIds) ? body.mediaIds : []).slice(0, 4).map((url, index) => ({ id: uid(`demo-media-${index}`), url: String(url), thumbnailUrl: String(url) })), reactions: [], links, blocked: false, canEdit: true, canDelete: true, canModerate: false, createdAt: new Date().toISOString() };
    state.chats[challenge.id] ??= []; state.chats[challenge.id].push(message); writeState(state); return clone(message) as T;
  }
  const chatMessageMatch = pathname.match(/^\/challenges\/([^/]+)\/chat\/messages\/([^/]+)$/);
  if (chatMessageMatch && method === "PATCH") {
    const message = (state.chats[chatMessageMatch[1]] ?? []).find((item) => item.id === chatMessageMatch[2]); if (!message?.canDelete) throw new Error("메시지를 수정할 수 없어요.");
    if (Date.now() - new Date(message.createdAt).getTime() > 5 * 60_000) throw new Error("메시지는 보낸 뒤 5분 동안만 수정할 수 있어요.");
    const challenge = state.challenges.find((item) => item.id === chatMessageMatch[1]); if (challenge?.endedAt || challenge && new Date(challenge.endsAt) <= new Date()) throw new Error("종료된 챌린지의 대화는 읽기만 할 수 있어요.");
    state.chatRevisions[message.id] ??= []; state.chatRevisions[message.id].push({ id: uid("demo-revision"), body: message.body, createdAt: new Date().toISOString() }); message.body = String(body.body ?? "") || null; message.editedAt = new Date().toISOString(); writeState(state); return clone(message) as T;
  }
  if (chatMessageMatch && method === "DELETE") { const message = (state.chats[chatMessageMatch[1]] ?? []).find((item) => item.id === chatMessageMatch[2]); if (message) { message.deletedAt = new Date().toISOString(); message.body = null; message.media = []; } writeState(state); return {} as T; }
  const revisionMatch = pathname.match(/^\/challenges\/([^/]+)\/chat\/messages\/([^/]+)\/revisions$/);
  if (revisionMatch && method === "GET") { const message = (state.chats[revisionMatch[1]] ?? []).find((item) => item.id === revisionMatch[2]); return clone([...(state.chatRevisions[revisionMatch[2]] ?? []), ...(message?.editedAt ? [{ id: `${message.id}-current`, body: message.body, createdAt: message.editedAt }] : [])]) as T; }
  const reactionMatch = pathname.match(/^\/challenges\/([^/]+)\/chat\/messages\/([^/]+)\/reactions$/);
  if (reactionMatch && method === "POST") { const challenge = state.challenges.find((item) => item.id === reactionMatch[1]); if (challenge?.endedAt || challenge && new Date(challenge.endsAt) <= new Date()) throw new Error("종료된 챌린지의 대화는 읽기만 할 수 있어요."); const message = (state.chats[reactionMatch[1]] ?? []).find((item) => item.id === reactionMatch[2]); if (!message) throw new Error("메시지를 찾지 못했어요."); const type = body.type as ChallengeChatMessage["reactions"][number]["type"]; const current = message.reactions.find((item) => item.type === type); if (current?.mine) { current.mine = false; current.count -= 1; if (current.count <= 0) message.reactions = message.reactions.filter((item) => item.type !== type); } else if (current) { current.mine = true; current.count += 1; } else message.reactions.push({ type, count: 1, mine: true }); writeState(state); return clone(message.reactions) as T; }
  if (reactionMatch && method === "GET") { const message = (state.chats[reactionMatch[1]] ?? []).find((item) => item.id === reactionMatch[2]); const reaction = message?.reactions.find((item) => item.type === url.searchParams.get("type")); const people = [state.user, ...Array.from(new Map(state.feed.map((post) => [post.author.id, post.author])).values())]; return clone(people.slice(0, reaction?.count ?? 0).map((user) => ({ user: { id: user.id, nickname: user.nickname, handle: user.handle, avatarUrl: user.avatarUrl } }))) as T; }
  const visibilityMatch = pathname.match(/^\/challenges\/([^/]+)\/chat\/messages\/([^/]+)\/visibility$/);
  if (visibilityMatch && method === "PATCH") { const message = (state.chats[visibilityMatch[1]] ?? []).find((item) => item.id === visibilityMatch[2]); if (message) message.hiddenAt = body.hidden ? new Date().toISOString() : null; writeState(state); return {} as T; }
  const memberModerationMatch = pathname.match(/^\/challenges\/([^/]+)\/chat\/members\/([^/]+)\/(mute|unmute)$/);
  if (memberModerationMatch && method === "POST") { const [, challengeId, userId, action] = memberModerationMatch; state.chatMutes[challengeId] ??= {}; if (action === "mute") state.chatMutes[challengeId][userId] = new Date(Date.now() + Number(body.durationHours ?? 24) * 3600_000).toISOString(); else delete state.chatMutes[challengeId][userId]; writeState(state); return clone({ ok: true }) as T; }
  const leaderboardMatch = pathname.match(/^\/(?:challenges|public\/challenges)\/([^/]+)\/leaderboard$/);
  if (leaderboardMatch && method === "GET") {
    const challenge = state.challenges.find((item) => item.id === leaderboardMatch[1]); if (!challenge) throw new Error("챌린지를 찾지 못했어요.");
    const publicPeople = Array.from(new Map(state.feed.map((post) => [post.author.id, post.author])).values());
    const people = [{ id: state.user.id, nickname: state.user.nickname, handle: state.user.handle, avatarUrl: state.user.avatarUrl, cloudRank: "조각구름", lifetimePower: state.user.lifetimePower }, ...publicPeople.slice(0, 2)];
    const counts = [challenge.myCheckInCount ?? 7, Math.max(1, (challenge.myCheckInCount ?? 7) - 1), Math.max(1, (challenge.myCheckInCount ?? 7) - 3)];
    const items = people.map((user, index) => ({ userId: user.id, rank: index + 1, approvedCheckIns: counts[index], successRate: Math.min(100, Math.round(counts[index] / 10 * 100)), eligible: counts[index] >= 7, titleAwarded: [challenge.firstPlaceTitle, challenge.secondPlaceTitle, challenge.thirdPlaceTitle][index] ?? null, user }));
    return clone({ items, myRank: 1 }) as T;
  }
  const challengeDetailMatch = pathname.match(/^\/(?:challenges|public\/challenges)\/([^/]+)$/);
  if (challengeDetailMatch && method === "GET") {
    const challenge = state.challenges.find((item) => item.id === challengeDetailMatch[1]);
    if (!challenge) throw new Error("챌린지를 찾지 못했어요.");
    return clone(challenge) as T;
  }
  if (challengeDetailMatch && method === "PATCH") {
    const challenge = state.challenges.find((item) => item.id === challengeDetailMatch[1]); if (!challenge) throw new Error("챌린지를 찾지 못했어요.");
    Object.assign(challenge, Object.fromEntries(Object.entries(body).filter(([, value]) => value !== undefined)));
    writeState(state); return clone(challenge) as T;
  }
  if (challengeDetailMatch && method === "DELETE") {
    const challenge = state.challenges.find((item) => item.id === challengeDetailMatch[1]);
    if (!challenge) throw new Error("챌린지를 찾지 못했어요.");
    challenge.endedAt = new Date().toISOString();
    state.chats[challenge.id] ??= [];
    state.chats[challenge.id].push({ id: uid("demo-system"), kind: "SYSTEM", body: "챌린지가 종료됐어요. 대화는 90일 동안 읽을 수 있어요.", sender: null, replyTo: null, media: [], reactions: [], links: [], blocked: false, canEdit: false, canDelete: false, canModerate: false, createdAt: challenge.endedAt });
    writeState(state); return clone({ ok: true }) as T;
  }
  const joinMatch = pathname.match(/^\/challenges\/([^/]+)\/join$/);
  if (joinMatch && method === "POST") {
    const challenge = state.challenges.find((item) => item.id === joinMatch[1]); if (!challenge) throw new Error("챌린지를 찾지 못했어요.");
    if (!challenge.joined) { challenge.joined = true; challenge._count.participants += 1; }
    state.chats[challenge.id] ??= [{ id: uid("demo-system"), kind: "SYSTEM", body: "챌린지가 시작됐어요. 서로에게 도움이 되는 팁과 경험을 나눠보세요.", sender: null, replyTo: null, media: [], reactions: [], links: [], blocked: false, canEdit: false, canDelete: false, canModerate: false, createdAt: new Date().toISOString() }];
    writeState(state); return clone(challenge) as T;
  }
  if (joinMatch && method === "DELETE") {
    const challenge = state.challenges.find((item) => item.id === joinMatch[1]); if (!challenge) throw new Error("챌린지를 찾지 못했어요.");
    if (challenge.joined) challenge._count.participants = Math.max(0, challenge._count.participants - 1);
    challenge.joined = false; challenge.todayCheckedIn = false; challenge.myCheckInCount = 0; challenge.successRate = 0; challenge.checkIns = [];
    writeState(state); return clone({ joined: false }) as T;
  }
  const checkInMatch = pathname.match(/^\/challenges\/([^/]+)\/check-in$/);
  if (checkInMatch && method === "POST") {
    const challenge = state.challenges.find((item) => item.id === checkInMatch[1]); if (!challenge) throw new Error("챌린지를 찾지 못했어요.");
    if (challenge.todayCheckedIn) throw new Error("오늘은 이미 인증했어요.");
    challenge.joined = true; challenge.todayCheckedIn = true; challenge.myCheckInCount = (challenge.myCheckInCount ?? 0) + 1; challenge.successRate = Math.min(100, (challenge.successRate ?? 0) + 8); challenge._count.checkIns += 1;
    challenge.checkIns = [{ id: uid("demo-checkin"), checkInDate: new Date().toISOString(), note: body.note ? String(body.note) : null, mediaUrl: body.mediaId ? String(body.mediaId) : null, status: challenge.verificationMode === "PEER_PHOTO" ? "PENDING" : "APPROVED", attempt: 1, reviewSize: 5, validVotes: 0 }, ...(challenge.checkIns ?? [])];
    writeState(state); return clone({ checkedIn: true }) as T;
  }
  if (pathname === "/challenge-verifications/queue" && method === "GET") return clone({ contributionCount: 12, items: [{ checkInId: "demo-peer-checkin", challenge: { id: "demo-challenge-official", title: "매일 7천 보, 가벼운 한 달" }, criteria: ["사진에서 걸음 수 또는 산책 기록을 확인할 수 있나요?", "사진이 오늘의 걷기 실천과 맞나요?", "재사용하거나 조작한 흔적 없이 자연스러운 인증인가요?"], attempt: 1, mediaUrl: "/demo/stretch.jpg" }] }) as T;
  if (/^\/challenge-verifications\/[^/]+\/vote$/.test(pathname) && method === "POST") return clone({ status: "PENDING", approvals: 3, rejections: 0, contributionCount: 13 }) as T;
  if (/^\/challenge-verifications\/check-ins\/[^/]+\/(?:resubmit|reverify)$/.test(pathname) && method === "POST") return clone({ status: "PENDING" }) as T;

  const profileMatch = pathname.match(/^\/public\/users\/([^/]+)$/);
  if (profileMatch && method === "GET") {
    const author = state.feed.map((post) => post.author).find((item) => item.handle === profileMatch[1]);
    if (!author && profileMatch[1] !== state.user.handle) throw new Error("프로필을 찾지 못했어요.");
    const person = author ?? { id: state.user.id, nickname: state.user.nickname, handle: state.user.handle, avatarUrl: state.user.avatarUrl, cloudRank: "조각구름", lifetimePower: state.user.lifetimePower };
    return clone({ ...person, rank: person.cloudRank, recentVitality: 72, bio: "작은 실천을 내 속도로 이어가고 있어요.", _count: { followers: author ? 132 : 48, following: author ? 86 : 31, posts: author ? 24 : 12 } }) as T;
  }
  const profilePostsMatch = pathname.match(/^\/public\/users\/([^/]+)\/posts$/);
  if (profilePostsMatch && method === "GET") {
    return clone({ items: state.feed.filter((post) => post.author.handle === profilePostsMatch[1]), nextCursor: null }) as T;
  }
  if (pathname === "/public/search" && method === "GET") {
    const query = (url.searchParams.get("query") ?? "").toLocaleLowerCase("ko");
    const text = query.replace(/^[@#]/, "");
    const users = Array.from(new Map(state.feed.map((post) => [post.author.id, post.author])).values()).filter((user) => `${user.nickname} ${user.handle}`.toLocaleLowerCase("ko").includes(text));
    const matched = state.feed.filter((post) => `${post.caption ?? ""} ${post.todos.map((todo) => `${todo.title} ${todo.category}`).join(" ")} ${post.todoList?.title ?? ""} ${post.hashtags.join(" ")}`.toLocaleLowerCase("ko").includes(text));
    const posts = matched.filter((post) => !post.todoList);
    const routines = matched.filter((post) => post.todoList);
    const tagCounts = new Map<string, number>(); state.feed.flatMap((post) => post.hashtags).forEach((tag) => tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1));
    const tags = [...tagCounts].filter(([name]) => name.toLocaleLowerCase("ko").includes(text)).map(([name, postCount], index) => ({ id: `demo-tag-${index}`, name, postCount }));
    const challenges = state.challenges.filter((challenge) => `${challenge.title} ${challenge.description}`.toLocaleLowerCase("ko").includes(text));
    const counts = { users: users.length, posts: posts.length, routines: routines.length, tags: tags.length, challenges: challenges.length };
    return clone({ query, users, posts, routines, tags, challenges, counts: { ...counts, all: Object.values(counts).reduce((sum, value) => sum + value, 0) } } satisfies SearchResults) as T;
  }
  if (pathname === "/public/search/suggestions" && method === "GET") {
    const counts = new Map<string, number>(); state.feed.flatMap((post) => post.hashtags).forEach((tag) => counts.set(tag, (counts.get(tag) ?? 0) + 1));
    return clone({ trendingTags: [...counts].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([name, postCount], index) => ({ id: `demo-tag-${index}`, name, postCount })) }) as T;
  }
  if (pathname === "/social/follow" && method === "POST") {
    const userId = String(body.userId); const following = !state.following.includes(userId);
    state.following = following ? [...state.following, userId] : state.following.filter((id) => id !== userId); writeState(state); return clone({ following }) as T;
  }
  const followStateMatch = pathname.match(/^\/social\/follow-state\/([^/]+)$/);
  if (followStateMatch && method === "GET") return clone({ following: state.following.includes(followStateMatch[1]), blocked: false, followerCount: 132, followingCount: 86 }) as T;
  const connectionMatch = pathname.match(/^\/social\/(followers|following)\/([^/]+)$/);
  if (connectionMatch && method === "GET") {
    const items = Array.from(new Map(state.feed.map((post) => [post.author.id, post.author])).values());
    return clone({ items, nextCursor: null }) as T;
  }
  if (pathname === "/social/block" && method === "POST") { const userId = String(body.userId); if (!state.blockedUsers.includes(userId)) state.blockedUsers.push(userId); state.following = state.following.filter((id) => id !== userId); writeState(state); return clone({ blocked: true }) as T; }
  if (pathname === "/social/report" && method === "POST") return {} as T;

  throw new Error(`체험 모드에서 준비되지 않은 요청이에요: ${method} ${pathname}`);
}
