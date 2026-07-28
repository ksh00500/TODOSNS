import { Transform, Type } from "class-transformer";
import { ArrayMaxSize, IsArray, IsBoolean, IsDateString, IsEnum, IsInt, IsOptional, IsString, Length, Max, Min } from "class-validator";
import { ChallengeKind, ReportStatus, ReportTarget, RewardStatus, VerificationMode, Visibility } from "@prisma/client";

export enum RecurrenceEditScope {
  THIS = "THIS",
  FUTURE = "FUTURE",
}

export class PageDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(50) limit = 20;
  @IsOptional() @IsString() cursor?: string;
}

export class SearchDto extends PageDto {
  @IsString() @Length(2, 60) query!: string;
}

export class CreateTodoDto {
  @IsString() @Length(1, 120) title!: string;
  @IsOptional() @IsString() @Length(0, 500) notes?: string;
  @IsOptional() @IsString() @Length(1, 30) category = "생활";
  @IsDateString() dueDate!: string;
  @IsOptional() @IsString() repeatRule?: string | null;
  @IsOptional() @IsEnum(Visibility) visibility: Visibility = Visibility.PRIVATE;
}

export class UpdateTodoDto {
  @IsOptional() @IsString() @Length(1, 120) title?: string;
  @IsOptional() @IsString() @Length(0, 500) notes?: string;
  @IsOptional() @IsString() @Length(1, 30) category?: string;
  @IsOptional() @IsDateString() dueDate?: string;
  @IsOptional() @IsString() repeatRule?: string | null;
  @IsOptional() @IsEnum(Visibility) visibility?: Visibility;
  @IsOptional() @IsEnum(RecurrenceEditScope) recurrenceScope: RecurrenceEditScope = RecurrenceEditScope.THIS;
}

export class CompleteTodoDto {
  @IsOptional() @IsBoolean() share = false;
  @IsOptional() @IsString() @Length(0, 180) caption?: string;
  @IsOptional() @IsString() mediaId?: string;
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

export class CloneTodoListDto {
  @IsOptional() @IsString() @Length(1, 100) title?: string;
  @IsOptional() @IsDateString() dueDate?: string;
}

export class CommentDto { @IsString() @Length(1, 300) body!: string; }

export class CreateChallengeDto {
  @IsString() @Length(2, 120) title!: string;
  @IsString() @Length(10, 1000) description!: string;
  @IsDateString() startsAt!: string;
  @IsDateString() endsAt!: string;
  @IsEnum(VerificationMode) verificationMode!: VerificationMode;
  @IsOptional() @IsEnum(ChallengeKind) kind: ChallengeKind = ChallengeKind.COMMUNITY;
  @IsOptional() @IsString() @Length(0, 120) rewardLabel?: string;
  @IsOptional() @IsString() @Length(0, 500) rewardTerms?: string;
}

export class CheckInDto {
  @IsOptional() @IsString() @Length(0, 180) note?: string;
  @IsOptional() @IsString() mediaId?: string;
}

export class UserTargetDto { @IsString() userId!: string; }
export class MessageRequestDto { @IsString() receiverId!: string; }
export class SendMessageDto { @IsString() @Length(1, 2000) body!: string; }

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
