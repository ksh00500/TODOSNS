import { Transform, Type } from "class-transformer";
import { IsBoolean, IsDateString, IsEnum, IsInt, IsOptional, IsString, Length, Max, Min } from "class-validator";
import { ChallengeKind, ReportStatus, ReportTarget, VerificationMode, Visibility } from "@prisma/client";

export class PageDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(50) limit = 20;
  @IsOptional() @IsString() cursor?: string;
}

export class CreateTodoDto {
  @IsString() @Length(1, 120) title!: string;
  @IsOptional() @IsString() @Length(0, 500) notes?: string;
  @IsOptional() @IsString() @Length(1, 30) category = "생활";
  @IsDateString() dueDate!: string;
  @IsOptional() @IsString() repeatRule?: string;
  @IsOptional() @IsEnum(Visibility) visibility: Visibility = Visibility.PRIVATE;
}

export class UpdateTodoDto {
  @IsOptional() @IsString() @Length(1, 120) title?: string;
  @IsOptional() @IsString() @Length(0, 500) notes?: string;
  @IsOptional() @IsString() @Length(1, 30) category?: string;
  @IsOptional() @IsDateString() dueDate?: string;
  @IsOptional() @IsString() repeatRule?: string;
  @IsOptional() @IsEnum(Visibility) visibility?: Visibility;
}

export class CompleteTodoDto {
  @IsOptional() @IsBoolean() share = false;
  @IsOptional() @IsString() @Length(0, 180) caption?: string;
  @IsOptional() @IsString() mediaKey?: string;
  @IsOptional() @IsEnum(Visibility) visibility: Visibility = Visibility.PUBLIC;
}

export class CloneTodoDto extends UpdateTodoDto {
  @IsOptional() @Transform(({ value }) => value === true || value === "true") @IsBoolean() keepRepeat = true;
}

export class CreatePostDto {
  @IsString() todoId!: string;
  @IsOptional() @IsString() @Length(0, 180) caption?: string;
  @IsOptional() @IsString() mediaKey?: string;
  @IsOptional() @IsEnum(Visibility) visibility: Visibility = Visibility.PUBLIC;
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
  @IsOptional() @IsString() mediaKey?: string;
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

export class PresignDto {
  @IsString() @Length(1, 120) filename!: string;
  @IsString() mimeType!: string;
  @IsInt() @Min(1) @Max(10_000_000) size!: number;
}
