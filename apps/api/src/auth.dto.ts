import { IsDateString, IsEmail, IsOptional, IsString, Length, Matches, MinLength } from "class-validator";

export class SignupDto {
  @IsEmail() email!: string;
  @MinLength(8) password!: string;
  @IsString() @Length(2, 20) nickname!: string;
  @Matches(/^[a-z0-9._]{3,20}$/) handle!: string;
  @IsDateString() birthDate!: string;
}

export class LoginDto {
  @IsEmail() email!: string;
  @IsString() password!: string;
}

export class GoogleLoginDto {
  @IsString() idToken!: string;
  @IsOptional() @IsString() handle?: string;
  @IsOptional() @IsDateString() birthDate?: string;
}

export class RefreshDto { @IsOptional() @IsString() refreshToken?: string; }
