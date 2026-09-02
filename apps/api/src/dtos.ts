import { Transform, Type } from "class-transformer";
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsDateString, IsEnum, IsIn, IsInt, IsOptional, IsString, Length, Max, Min, ValidateNested } from "class-validator";
import { ChallengeKind, ChatNotificationLevel, ChatReactionType, ReportStatus, ReportTarget, RewardStatus, VerificationMode, Visibility } from "@prisma/client";

export enum RecurrenceEditScope {
  THIS = "THIS",
  FUTURE = "FUTURE",
}

export class PageDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(50) limit = 20;
  @IsOptional() @IsString() cursor?: string;
}

export class SearchDto extends PageDto {
  @IsString() @Length(1, 60) query!: string;
}

export class CreateTodoDto {
  @IsString() @Length(1, 120) title!: string;
  @IsOptional() @IsString() @Length(0, 500) notes?: string;
  @IsOptional() @IsString() @Length(1, 30) category = "생활";
  @IsOptional() @IsString() categoryId?: string | null;
  @IsDateString() dueDate!: string;
  @IsOptional() @IsString() repeatRule?: string | null;
  @IsOptional() @IsEnum(Visibility) visibility: Visibility = Visibility.PRIVATE;
  @IsOptional() @IsString() todoListId?: string | null;
}

export class UpdateTodoDto {
  @IsOptional() @IsString() @Length(1, 120) title?: string;
  @IsOptional() @IsString() @Length(0, 500) notes?: string;
  @IsOptional() @IsString() @Length(1, 30) category?: string;
  @IsOptional() @IsString() categoryId?: string | null;
  @IsOptional() @IsDateString() dueDate?: string;
  @IsOptional() @IsString() repeatRule?: string | null;
  @IsOptional() @IsEnum(Visibility) visibility?: Visibility;
  @IsOptional() @IsEnum(RecurrenceEditScope) recurrenceScope: RecurrenceEditScope = RecurrenceEditScope.THIS;
  @IsOptional() @IsString() todoListId?: string | null;
}

export class CreateTodoCategoryDto {
  @IsString() @Length(1, 30) name!: string;
  @IsString() @Length(1, 30) baseCategory!: string;
  @IsOptional() @IsString() @Length(1, 30) icon = "tag";
  @IsOptional() @IsString() @Length(1, 30) color = "lilac";
}

export class UpdateTodoCategoryDto {
  @IsOptional() @IsString() @Length(1, 30) name?: string;
  @IsOptional() @IsString() @Length(1, 30) baseCategory?: string;
  @IsOptional() @IsString() @Length(1, 30) icon?: string;
  @IsOptional() @IsString() @Length(1, 30) color?: string;
  @IsOptional() @IsBoolean() archived?: boolean;
}

export class ReorderTodoCategoriesDto {
  @IsArray() @ArrayMaxSize(20) @IsString({ each: true }) ids!: string[];
}

export class CompleteTodoDto {
  @IsOptional() @IsBoolean() share = false;
  @IsOptional() @IsString() @Length(0, 180) caption?: string;
  @IsOptional() @IsString() mediaId?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(5) @IsString({ each: true }) @Length(1, 30, { each: true }) hashtags: string[] = [];
  @IsOptional() @IsEnum(Visibility) visibility: Visibility = Visibility.PUBLIC;
}

export class CloneTodoDto extends UpdateTodoDto {
  @IsOptional() @Transform(({ value }) => value === true || value === "true") @IsBoolean() keepRepeat = true;
}

export class CreatePostDto {
  @IsOptional() @IsString() todoId?: string;
  @IsOptional() @IsString() todoListId?: string;
  @IsOptional() @IsString() @Length(0, 180) caption?: string;
  @IsOptional() @IsString() mediaId?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(5) @IsString({ each: true }) @Length(1, 30, { each: true }) hashtags: string[] = [];
  @IsOptional() @IsEnum(Visibility) visibility: Visibility = Visibility.PUBLIC;
}

export class CreateTodoListDto {
  @IsString() @Length(1, 100) title!: string;
  @IsOptional() @IsString() @Length(0, 300) description?: string;
  @IsOptional() @IsEnum(Visibility) visibility: Visibility = Visibility.PRIVATE;
  @IsArray() @ArrayMaxSize(30) @IsString({ each: true }) todoIds!: string[];
}

export class UpdateTodoListDto {
  @IsOptional() @IsString() @Length(1, 100) title?: string;
  @IsOptional() @IsString() @Length(0, 300) description?: string;
  @IsOptional() @IsEnum(Visibility) visibility?: Visibility;
  @IsOptional() @IsArray() @ArrayMaxSize(30) @IsString({ each: true }) todoIds?: string[];
}

export enum CloneTodoListRepeatMode {
  KEEP = "KEEP",
  NONE = "NONE",
  CUSTOM = "CUSTOM",
}

export class CloneTodoListItemDto {
  @IsString() sourceTodoId!: string;
  @IsOptional() @IsString() @Length(1, 120) title?: string;
  @IsOptional() @IsDateString() dueDate?: string;
  @IsOptional() @IsString() @Length(1, 30) category?: string;
  @IsOptional() @IsString() repeatRule?: string | null;
}

export class CloneTodoListDto {
  @IsOptional() @IsString() @Length(1, 100) title?: string;
  @IsOptional() @IsDateString() dueDate?: string;
  @IsOptional() @IsEnum(CloneTodoListRepeatMode) repeatMode: CloneTodoListRepeatMode = CloneTodoListRepeatMode.KEEP;
  @IsOptional() @IsArray() @ArrayMaxSize(30) @ValidateNested({ each: true }) @Type(() => CloneTodoListItemDto) items?: CloneTodoListItemDto[];
}

export class CommentDto { @IsString() @Length(1, 300) body!: string; }

export class CreateChallengeDto {
  @IsString() @Length(2, 120) title!: string;
  @IsString() @Length(10, 1000) description!: string;
  @IsDateString() startsAt!: string;
  @IsDateString() endsAt!: string;
  @IsIn([VerificationMode.CHECK, VerificationMode.PEER_PHOTO]) verificationMode!: VerificationMode;
  @IsOptional() @IsArray() @ArrayMinSize(1) @ArrayMaxSize(5) @IsString({ each: true }) verificationCriteria?: string[];
  @IsOptional() @IsEnum(ChallengeKind) kind: ChallengeKind = ChallengeKind.COMMUNITY;
  @IsOptional() @IsString() @Length(0, 120) rewardLabel?: string | null;
  @IsOptional() @IsString() @Length(0, 500) rewardTerms?: string | null;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) completionThreshold = 80;
  @IsOptional() @IsString() @Length(0, 120) firstPlaceTitle?: string | null;
  @IsOptional() @IsString() @Length(0, 120) secondPlaceTitle?: string | null;
  @IsOptional() @IsString() @Length(0, 120) thirdPlaceTitle?: string | null;
}

export class UpdateChallengeDto {
  @IsOptional() @IsString() @Length(2, 120) title?: string;
  @IsOptional() @IsString() @Length(10, 1000) description?: string;
  @IsOptional() @IsDateString() startsAt?: string;
  @IsOptional() @IsDateString() endsAt?: string;
  @IsOptional() @IsIn([VerificationMode.CHECK, VerificationMode.PEER_PHOTO]) verificationMode?: VerificationMode;
  @IsOptional() @IsArray() @ArrayMinSize(1) @ArrayMaxSize(5) @IsString({ each: true }) verificationCriteria?: string[];
  @IsOptional() @IsString() @Length(0, 120) rewardLabel?: string | null;
  @IsOptional() @IsString() @Length(0, 500) rewardTerms?: string | null;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) completionThreshold?: number;
  @IsOptional() @IsString() @Length(0, 120) firstPlaceTitle?: string | null;
  @IsOptional() @IsString() @Length(0, 120) secondPlaceTitle?: string | null;
  @IsOptional() @IsString() @Length(0, 120) thirdPlaceTitle?: string | null;
}

export class CheckInDto {
  @IsOptional() @IsString() @Length(0, 180) note?: string;
  @IsOptional() @IsString() mediaId?: string;
}

export class VerificationCriterionAnswerDto {
  @Type(() => Number) @IsInt() @Min(0) @Max(4) criterionIndex!: number;
  @IsIn(["MET", "NOT_MET", "UNSURE"]) result!: "MET" | "NOT_MET" | "UNSURE";
}

export class VerificationVoteDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(5) @ValidateNested({ each: true }) @Type(() => VerificationCriterionAnswerDto) answers!: VerificationCriterionAnswerDto[];
}

export class VerificationQueueDto {
  @IsOptional() @IsString() challengeId?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(10) limit = 5;
}

export class UserTargetDto { @IsString() userId!: string; }
export class MessageRequestDto { @IsString() receiverId!: string; }
export class SendMessageDto { @IsString() @Length(1, 2000) body!: string; }

export class CreateChallengeChatMessageDto {
  @IsOptional() @IsString() @Length(0, 2000) body?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(4) @IsString({ each: true }) mediaIds?: string[];
  @IsOptional() @IsString() replyToId?: string;
}

export class UpdateChallengeChatMessageDto { @IsString() @Length(0, 2000) body!: string; }
export class ReadChallengeChatDto { @IsString() messageId!: string; }
export class UpdateChatSettingsDto { @IsEnum(ChatNotificationLevel) notificationLevel!: ChatNotificationLevel; }
export class ToggleChatReactionDto { @IsEnum(ChatReactionType) type!: ChatReactionType; }
export class ModerateChatMessageDto { @IsString() @Length(3, 300) reason!: string; }
export class MuteChatMemberDto {
  @Type(() => Number) @IsInt() @IsIn([24, 168]) durationHours!: 24 | 168;
  @IsString() @Length(3, 300) reason!: string;
}

export class CreateReportDto {
  @IsEnum(ReportTarget) targetType!: ReportTarget;
  @IsString() targetId!: string;
  @IsString() @Length(3, 500) reason!: string;
}

export class ResolveReportDto {
  @IsEnum(ReportStatus) status!: ReportStatus;
  @IsString() @Length(3, 500) resolution!: string;
}

export class UpdateChallengeRewardDto {
  @IsEnum(RewardStatus) status!: RewardStatus;
}

export class CreateInviteCodeDto {
  @IsOptional() @IsString() @Length(1, 100) label?: string;
  @Type(() => Number) @IsInt() @Min(1) @Max(1000) maxUses!: number;
  @IsOptional() @IsDateString() expiresAt?: string;
}

export class UpdateInviteCodeDto {
  @IsBoolean() disabled!: boolean;
}

export class AdminUserQueryDto extends PageDto {
  @IsOptional() @IsString() @Length(1, 60) query?: string;
  @IsOptional() @IsIn(["ALL", "ACTIVE", "SUSPENDED"]) status: "ALL" | "ACTIVE" | "SUSPENDED" = "ALL";
}

export class UpdateUserSuspensionDto {
  @IsBoolean() suspended!: boolean;
  @IsOptional() @IsString() @Length(3, 300) reason?: string;
}

export class AdminContentQueryDto extends PageDto {
  @IsIn(["POST", "COMMENT"]) type: "POST" | "COMMENT" = "POST";
  @IsOptional() @IsIn(["ALL", "VISIBLE", "HIDDEN"]) status: "ALL" | "VISIBLE" | "HIDDEN" = "ALL";
  @IsOptional() @IsString() @Length(1, 60) query?: string;
}

export class UpdateContentVisibilityDto {
  @IsBoolean() hidden!: boolean;
  @IsOptional() @IsString() @Length(3, 300) reason?: string;
}

export class PresignDto {
  @IsString() @Length(1, 120) filename!: string;
  @IsString() mimeType!: string;
  @IsInt() @Min(1) @Max(10_000_000) size!: number;
}

export class CompleteMediaDto {
  @IsString() mediaId!: string;
}

export class UpdateProfileDto {
  @IsOptional() @IsString() @Length(2, 20) nickname?: string;
  @IsOptional() @IsString() @Length(0, 160) bio?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(10) @IsString({ each: true }) interests?: string[];
  @IsOptional() @IsString() avatarMediaId?: string;
  @IsOptional() @IsString() @Length(1, 80) timezone?: string;
  @IsOptional() @IsBoolean() onboardingCompleted?: boolean;
}
