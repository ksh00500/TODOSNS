export type Visibility = "PUBLIC" | "FOLLOWERS" | "PRIVATE";
export type TodoKind = "SINGLE" | "ROUTINE";
export type ChallengeKind = "OFFICIAL" | "COMMUNITY";
export type VerificationMode = "CHECK" | "PEER_PHOTO";
export type ReportTarget = "USER" | "POST" | "COMMENT" | "MESSAGE" | "CHALLENGE" | "CHALLENGE_CHECK_IN";

export interface ApiEnvelope<T> {
  data: T;
  meta?: Record<string, unknown>;
}

export interface SignupResultDto {
  email: string;
  requiresVerification: true;
  verificationEmailSent: boolean;
}

export interface UserSummary {
  id: string;
  nickname: string;
  handle: string;
  avatarUrl?: string | null;
  cloudRank: string;
  lifetimePower: number;
}

export interface TodoDto {
  id: string;
  title: string;
  notes?: string | null;
  dueDate: string;
  completedAt?: string | null;
  visibility: Visibility;
  repeatRule?: string | null;
  category: string;
  categoryId?: string | null;
  categoryRef?: TodoCategoryDto | null;
  sourceTodoId?: string | null;
  seriesId?: string | null;
  occurrenceKey?: string | null;
}

export interface TodoCategoryDto {
  id: string;
  name: string;
  baseCategory: string;
  icon: string;
  color: string;
  position: number;
  isDefault: boolean;
  archivedAt?: string | null;
  todoCount?: number;
}

export interface TodoListDto {
  id: string;
  title: string;
  description?: string | null;
  visibility: Visibility;
  sourceTodoListId?: string | null;
  items: Array<{ order: number; todo: TodoDto }>;
  copyCount?: number;
  _count?: { copies: number };
}

export type CloneTodoListRepeatMode = "KEEP" | "NONE" | "CUSTOM";

export interface CloneTodoListItemDraft {
  sourceTodoId: string;
  title?: string;
  dueDate?: string;
  category?: string;
  repeatRule?: string | null;
}

export interface CloneTodoListDraft {
  title?: string;
  dueDate?: string;
  repeatMode?: CloneTodoListRepeatMode;
  items?: CloneTodoListItemDraft[];
}

export interface FeedPostDto {
  id: string;
  author: UserSummary;
  caption?: string | null;
  mediaUrl?: string | null;
  mediaId?: string | null;
  thumbnailUrl?: string | null;
  hashtags: string[];
  todos: TodoDto[];
  todoList?: TodoListDto | null;
  cheerCount: number;
  commentCount: number;
  copyCount: number;
  createdAt: string;
  cheered: boolean;
}

export interface SearchTagDto {
  id: string;
  name: string;
  postCount: number;
}

export interface SearchResultsDto {
  query: string;
  users: UserSummary[];
  posts: FeedPostDto[];
  routines: FeedPostDto[];
  tags: SearchTagDto[];
  challenges: ChallengeDto[];
  counts: {
    all: number;
    users: number;
    posts: number;
    routines: number;
    tags: number;
    challenges: number;
  };
}

export interface SearchSuggestionsDto {
  trendingTags: SearchTagDto[];
}

export interface MediaDto {
  id: string;
  status: "UPLOADING" | "READY" | "FAILED";
  mimeType: string;
  size: number;
  width?: number | null;
  height?: number | null;
  url: string;
  thumbnailUrl?: string | null;
}

export interface NotificationDto {
  id: string;
  type: "CHEER" | "COMMENT" | "COPY" | "FOLLOW" | "MESSAGE" | "CHALLENGE" | "RANK" | "SYSTEM";
  title: string;
  body: string;
  targetType?: string | null;
  targetId?: string | null;
  href?: string | null;
  readAt?: string | null;
  unreadCount?: number;
  createdAt: string;
}

export type ChatNotificationLevel = "ALL" | "REPLIES" | "NONE";
export type ChatReactionType = "LIKE" | "HELPFUL" | "CHEER" | "EMPATHY" | "SEEN";

export interface ChatReactionDto {
  type: ChatReactionType;
  count: number;
  mine: boolean;
  users?: Array<Pick<UserSummary, "id" | "nickname" | "handle" | "avatarUrl">>;
}

export interface ChatMediaDto {
  id: string;
  url: string;
  thumbnailUrl?: string | null;
  width?: number | null;
  height?: number | null;
}

export interface ChatMessageRevisionDto {
  id: string;
  body?: string | null;
  createdAt: string;
}

export interface ChallengeChatMessageDto {
  id: string;
  kind: "USER" | "SYSTEM";
  body?: string | null;
  sender?: UserSummary | null;
  replyTo?: { id: string; body?: string | null; senderNickname?: string | null; deleted: boolean } | null;
  media: ChatMediaDto[];
  reactions: ChatReactionDto[];
  links: Array<{ url: string; domain: string }>;
  editedAt?: string | null;
  deletedAt?: string | null;
  hiddenAt?: string | null;
  blocked: boolean;
  canEdit: boolean;
  canDelete: boolean;
  canModerate: boolean;
  createdAt: string;
}

export interface ChallengeChatSummaryDto {
  challengeId: string;
  conversationId: string;
  title: string;
  participantCount: number;
  unreadCount: number;
  notificationLevel: ChatNotificationLevel;
  readOnly: boolean;
  purgeAt?: string | null;
  canManage: boolean;
  mutedUntil?: string | null;
}

export interface ChallengeChatPageDto {
  room: ChallengeChatSummaryDto;
  items: ChallengeChatMessageDto[];
  nextCursor: string | null;
}

export interface DirectChatMessageDto {
  id: string;
  kind: "USER" | "SYSTEM";
  body?: string | null;
  sender?: UserSummary | null;
  replyTo?: { id: string; body?: string | null; senderNickname?: string | null; deleted: boolean } | null;
  media: ChatMediaDto[];
  reactions: ChatReactionDto[];
  links: Array<{ url: string; domain: string }>;
  deletedAt?: string | null;
  hiddenAt?: string | null;
  blocked: boolean;
  canDelete: boolean;
  createdAt: string;
}

export interface DirectConversationDto {
  id: string;
  otherUser: UserSummary;
  unreadCount: number;
  blocked: boolean;
  blockedByMe: boolean;
  canSend: boolean;
  lastMessage?: { id: string; body?: string | null; hasMedia: boolean; deleted: boolean; senderId?: string | null; createdAt: string } | null;
  updatedAt: string;
}

export interface ChatInboxItemDto {
  id: string;
  kind: "DIRECT" | "CHALLENGE";
  href: string;
  title: string;
  subtitle: string;
  avatarUrl?: string | null;
  unreadCount: number;
  readOnly: boolean;
  lastMessage?: { id: string; body?: string | null; hasMedia: boolean; deleted: boolean; senderId?: string | null; senderNickname?: string | null; createdAt: string } | null;
  updatedAt: string;
}

export interface DirectChatRoomDto {
  conversationId: string;
  otherUser: UserSummary;
  unreadCount: number;
  blocked: boolean;
  blockedByMe: boolean;
  canSend: boolean;
}

export interface DirectChatPageDto {
  room: DirectChatRoomDto;
  items: DirectChatMessageDto[];
  nextCursor: string | null;
}

export interface DirectMessageRequestDto {
  id: string;
  sender: UserSummary;
  createdAt: string;
}

export type DirectMessageStartDto =
  | { kind: "CONVERSATION"; conversationId: string }
  | { kind: "REQUEST"; requestId: string };

export interface ChatMemberDto {
  user: UserSummary;
  joinedAt: string;
  mutedUntil?: string | null;
  canModerate: boolean;
}

export interface NotificationPageDto {
  items: NotificationDto[];
  nextCursor: string | null;
  unreadCount: number;
}

export interface ChallengeDto {
  id: string;
  title: string;
  description: string;
  kind: ChallengeKind;
  verificationMode: VerificationMode;
  verificationCriteria?: string[];
  minimumParticipants?: number;
  startsAt: string;
  endsAt: string;
  endedAt?: string | null;
  _count: { participants: number; checkIns: number };
  joined: boolean;
  chatUnreadCount?: number;
  chatReadOnly?: boolean;
  chatPurgeAt?: string | null;
  todayCheckedIn?: boolean;
  myCheckInCount?: number;
  successRate?: number;
  rewardLabel?: string | null;
  rewardTerms?: string | null;
  completionThreshold: number;
  firstPlaceTitle?: string | null;
  secondPlaceTitle?: string | null;
  thirdPlaceTitle?: string | null;
  creator?: { id: string; nickname: string; handle: string };
  myRewardStatus?: string | null;
  myRank?: number | null;
  titleAwarded?: string | null;
  participants?: Array<{ userId?: string; joinedAt?: string; rewardStatus?: string; finalRank?: number | null; titleAwarded?: string | null; completedAt?: string | null }>;
  checkIns?: Array<{ id: string; checkInDate: string; note?: string | null; mediaUrl?: string | null; status?: "PENDING" | "APPROVED" | "REJECTED"; reviewNote?: string | null; attempt?: number; reviewSize?: number; validVotes?: number; reverifyUsed?: boolean; retryUntil?: string | null }>;
}

export interface ChallengeVerificationQueueItemDto {
  checkInId: string;
  challenge: { id: string; title: string };
  criteria: string[];
  attempt: number;
  mediaUrl: string;
}

export interface ChallengeVerificationQueueDto {
  contributionCount: number;
  items: ChallengeVerificationQueueItemDto[];
}

export interface ChallengeLeaderboardItemDto {
  userId: string;
  rank: number;
  approvedCheckIns: number;
  successRate: number;
  eligible: boolean;
  titleAwarded?: string | null;
  user: UserSummary;
}

export interface ChallengeLeaderboardDto {
  items: ChallengeLeaderboardItemDto[];
  myRank?: number | null;
}

export interface FeedPageDto {
  items: FeedPostDto[];
  nextCursor: string | null;
}

export interface CommentDto {
  id: string;
  body: string;
  createdAt: string;
  author: UserSummary;
}

export interface SessionUserDto {
  id: string;
  email: string;
  nickname: string;
  handle: string;
  role: string;
  availablePoints: number;
  lifetimePower: number;
  recentVitality: number;
  avatarUrl?: string | null;
  bio?: string | null;
  interests?: string[];
  timezone?: string;
  onboardingCompletedAt?: string | null;
  emailVerifiedAt?: string | null;
}

export interface AdminOverviewDto {
  users: { total: number; newLast7Days: number; verified: number; suspended: number; activeLast7Days: number };
  activity: { completedTodosLast7Days: number; publishedPostsLast7Days: number; copiedTodosLast7Days: number };
  moderation: { openReports: number; pendingCheckIns: number };
  invites: { active: number };
}

export interface AdminInviteCodeDto {
  id: string;
  label?: string | null;
  maxUses: number;
  uses: number;
  expiresAt?: string | null;
  disabledAt?: string | null;
  createdAt: string;
  state: "ACTIVE" | "DISABLED" | "EXPIRED" | "EXHAUSTED";
}

export interface CreatedInviteCodeDto {
  code: string;
  invite: AdminInviteCodeDto;
}

export interface AdminUserDto {
  id: string;
  email: string;
  nickname: string;
  handle: string;
  role: string;
  emailVerifiedAt?: string | null;
  suspendedAt?: string | null;
  suspensionReason?: string | null;
  createdAt: string;
  _count: { todos: number; posts: number; sessions: number };
}

export interface AdminContentDto {
  id: string;
  type: "POST" | "COMMENT";
  preview: string;
  contextId: string;
  context?: string | null;
  author: { id: string; nickname: string; handle: string };
  hiddenAt?: string | null;
  createdAt: string;
  reportCount: number;
}

export interface AdminAuditLogDto {
  id: string;
  action: string;
  targetType: string;
  targetId: string;
  summary?: string | null;
  metadata?: unknown;
  createdAt: string;
  admin: { id: string; nickname: string; handle: string };
}

export interface AdminReportDto {
  id: string;
  targetType: ReportTarget;
  targetId: string;
  reason: string;
  status: "OPEN" | "REVIEWING" | "RESOLVED" | "DISMISSED";
  resolution?: string | null;
  targetPreview?: string | null;
  targetMediaUrl?: string | null;
  targetHidden: boolean;
  createdAt: string;
  reporter: { id: string; nickname: string; handle: string };
}

export interface AuthTokens {
  accessToken: string;
}
