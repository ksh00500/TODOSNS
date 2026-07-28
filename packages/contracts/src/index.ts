export type Visibility = "PUBLIC" | "FOLLOWERS" | "PRIVATE";
export type TodoKind = "SINGLE" | "ROUTINE";
export type ChallengeKind = "OFFICIAL" | "COMMUNITY";
export type VerificationMode = "CHECK" | "OPTIONAL_PHOTO" | "REQUIRED_PHOTO";
export type ReportTarget = "USER" | "POST" | "COMMENT" | "MESSAGE" | "CHALLENGE";

export interface ApiEnvelope<T> {
  data: T;
  meta?: Record<string, unknown>;
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
  todos: TodoDto[];
  todoList?: TodoListDto | null;
  cheerCount: number;
  commentCount: number;
  copyCount: number;
  createdAt: string;
  cheered: boolean;
}

export interface ChallengeDto {
  id: string;
  title: string;
  description: string;
  kind: ChallengeKind;
  verificationMode: VerificationMode;
  startsAt: string;
  endsAt: string;
  participantCount: number;
  joined: boolean;
  rewardLabel?: string | null;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}
