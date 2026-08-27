export type Visibility = "PUBLIC" | "FOLLOWERS" | "PRIVATE";
export type TodoKind = "SINGLE" | "ROUTINE";
export type ChallengeKind = "OFFICIAL" | "COMMUNITY";
export type VerificationMode = "CHECK" | "OPTIONAL_PHOTO" | "REQUIRED_PHOTO";
export type ReportTarget = "USER" | "POST" | "COMMENT" | "MESSAGE" | "CHALLENGE";

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
  sourceTodoId?: string | null;
  seriesId?: string | null;
  occurrenceKey?: string | null;
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

export interface FeedPostDto {
  id: string;
  author: UserSummary;
  caption?: string | null;
  mediaUrl?: string | null;
  mediaId?: string | null;
  thumbnailUrl?: string | null;
  todos: TodoDto[];
  todoList?: TodoListDto | null;
  cheerCount: number;
  commentCount: number;
  copyCount: number;
  createdAt: string;
  cheered: boolean;
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
  createdAt: string;
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
  startsAt: string;
  endsAt: string;
  _count: { participants: number; checkIns: number };
  joined: boolean;
  todayCheckedIn?: boolean;
  myCheckInCount?: number;
  successRate?: number;
  rewardLabel?: string | null;
  participants?: Array<{ userId?: string; joinedAt?: string; rewardStatus?: string }>;
  checkIns?: Array<{ id: string; checkInDate: string; note?: string | null; mediaUrl?: string | null }>;
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

export interface AuthTokens {
  accessToken: string;
}
