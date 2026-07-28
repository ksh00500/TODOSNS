import type { ChallengeKind, TodoDto, TodoListDto, UserSummary, Visibility } from "@mungsil/contracts";

export type { TodoDto, TodoListDto, UserSummary, Visibility };
export type SessionUser = { id: string; email: string; nickname: string; handle: string; role: string; availablePoints: number; lifetimePower: number; recentVitality: number; avatarUrl?: string | null; bio?: string | null; interests?: string[] };
export type FeedPost = { id: string; author: UserSummary; caption?: string | null; mediaUrl?: string | null; todos: TodoDto[]; todoList?: TodoListDto | null; cheerCount: number; commentCount: number; copyCount: number; createdAt: string; cheered: boolean };
export type FeedPage = { items: FeedPost[]; nextCursor: string | null };
export type Challenge = { id: string; title: string; description: string; kind: ChallengeKind; verificationMode: "CHECK" | "OPTIONAL_PHOTO" | "REQUIRED_PHOTO"; startsAt: string; endsAt: string; rewardLabel?: string | null; joined?: boolean; participants?: Array<{ userId: string }>; _count: { participants: number; checkIns: number } };
export type Comment = { id: string; body: string; createdAt: string; author: UserSummary };
