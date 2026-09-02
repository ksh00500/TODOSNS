import type {
  AdminAuditLogDto,
  AdminContentDto,
  AdminInviteCodeDto,
  AdminOverviewDto,
  AdminReportDto,
  AdminUserDto,
  ChallengeDto,
  ChallengeLeaderboardDto,
  ChallengeVerificationQueueDto,
  ChallengeChatPageDto,
  ChallengeChatMessageDto,
  ChallengeChatSummaryDto,
  ChatMemberDto,
  ChatInboxItemDto,
  ChatNotificationLevel,
  ChatReactionType,
  CommentDto,
  DirectChatMessageDto,
  DirectChatPageDto,
  DirectConversationDto,
  DirectMessageRequestDto,
  DirectMessageStartDto,
  FeedPageDto,
  FeedPostDto,
  SessionUserDto,
  SearchResultsDto,
  SearchSuggestionsDto,
  TodoCategoryDto,
  TodoDto,
  TodoListDto,
  UserSummary,
  Visibility,
} from "@mungsil/contracts";

export type { TodoCategoryDto, TodoDto, TodoListDto, UserSummary, Visibility };
export type SessionUser = SessionUserDto;
export type FeedPost = FeedPostDto;
export type FeedPage = FeedPageDto;
export type SearchResults = SearchResultsDto;
export type SearchSuggestions = SearchSuggestionsDto;
export type Challenge = ChallengeDto;
export type ChallengeLeaderboard = ChallengeLeaderboardDto;
export type ChallengeVerificationQueue = ChallengeVerificationQueueDto;
export type ChallengeChatPage = ChallengeChatPageDto;
export type ChallengeChatMessage = ChallengeChatMessageDto;
export type ChallengeChatSummary = ChallengeChatSummaryDto;
export type ChatMember = ChatMemberDto;
export type ChatInboxItem = ChatInboxItemDto;
export type DirectChatMessage = DirectChatMessageDto;
export type DirectChatPage = DirectChatPageDto;
export type DirectConversation = DirectConversationDto;
export type DirectMessageRequest = DirectMessageRequestDto;
export type DirectMessageStart = DirectMessageStartDto;
export type { ChatNotificationLevel, ChatReactionType };
export type Comment = CommentDto;
export type AdminOverview = AdminOverviewDto;
export type AdminInviteCode = AdminInviteCodeDto;
export type AdminUser = AdminUserDto;
export type AdminContent = AdminContentDto;
export type AdminAuditLog = AdminAuditLogDto;
export type AdminReport = AdminReportDto;
