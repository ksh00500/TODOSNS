import { IsDateString, IsEmail, IsOptional, IsString, Length, Matches } from "class-validator";

export class SignupDto {
  @IsEmail() email!: string;
  @IsString() @Length(8, 72) password!: string;
  @IsString() @Length(2, 20) nickname!: string;
  @Matches(/^[a-z0-9._]{3,20}$/) handle!: string;
  @IsDateString() birthDate!: string;
  @IsOptional() @IsString() @Length(4, 80) inviteCode?: string;
}

export class LoginDto {
  @IsEmail() email!: string;
  @IsString() @Length(1, 72) password!: string;
}

export class GoogleLoginDto {
  @IsString() idToken!: string;
  @IsOptional() @Matches(/^[a-z0-9._]{3,20}$/) handle?: string;
  @IsOptional() @IsDateString() birthDate?: string;
  @IsOptional() @IsString() @Length(4, 80) inviteCode?: string;
}

export class RefreshDto { @IsOptional() @IsString() refreshToken?: string; }

export class EmailDto {
  @IsEmail() email!: string;
}

export class TokenDto {
  @IsString() @Length(20, 200) token!: string;
}

export class ResetPasswordDto extends TokenDto {
  @IsString() @Length(8, 72) password!: string;
}
