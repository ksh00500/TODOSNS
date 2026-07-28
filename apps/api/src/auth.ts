import {
  BadRequestException,
  Body,
  CanActivate,
  ConflictException,
  Controller,
  createParamDecorator,
  ExecutionContext,
  Get,
  Injectable,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { Prisma, User, VerificationTokenType } from "@prisma/client";
import { compare, hash } from "bcryptjs";
import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { OAuth2Client } from "google-auth-library";
import type { Request, Response } from "express";
import { PrismaService } from "./prisma.service";
import {
  EmailDto,
  GoogleLoginDto,
  LoginDto,
  RefreshDto,
  ResetPasswordDto,
  SignupDto,
  TokenDto,
} from "./auth.dto";
import { EmailService } from "./email.service";

type JwtUser = { sub: string; role: string; email: string; sid: string };
type RefreshUser = JwtUser & { fid: string; jti: string };
type RequestContext = { userAgent?: string; ip?: string };

export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext) =>
    context.switchToHttp().getRequest<Request & { user: JwtUser }>().user,
);

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly jwt: JwtService, private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<Request & { user: JwtUser }>();
    const token = request.headers.authorization?.replace(/^Bearer\s+/i, "");
    if (!token) throw new UnauthorizedException("로그인이 필요해요.");
    try {
      request.user = this.jwt.verify<JwtUser>(token, { secret: process.env.JWT_ACCESS_SECRET });
      const active = await this.prisma.session.count({ where: { id: request.user.sid, userId: request.user.sub, revokedAt: null, expiresAt: { gt: new Date() } } });
      if (!active) throw new Error("revoked");
      return true;
    } catch {
      throw new UnauthorizedException("로그인이 만료됐어요.");
    }
  }
}

@Injectable()
export class OptionalJwtAuthGuard implements CanActivate {
  constructor(private readonly jwt: JwtService, private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<Request & { user?: JwtUser }>();
    const token = request.headers.authorization?.replace(/^Bearer\s+/i, "");
    if (token) {
      try {
        const user = this.jwt.verify<JwtUser>(token, { secret: process.env.JWT_ACCESS_SECRET });
        const active = await this.prisma.session.count({ where: { id: user.sid, userId: user.sub, revokedAt: null, expiresAt: { gt: new Date() } } });
        request.user = active ? user : undefined;
      } catch {
        request.user = undefined;
      }
    }
    return true;
  }
}

@Injectable()
export class AuthService {
  private readonly google = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly email: EmailService,
  ) {}

  private assertAdult(date: Date) {
    const cutoff = new Date();
    cutoff.setFullYear(cutoff.getFullYear() - 18);
    if (Number.isNaN(date.getTime()) || date > cutoff) {
      throw new BadRequestException("뭉실 MVP는 만 18세 이상만 가입할 수 있어요.");
    }
  }

  async signup(dto: SignupDto) {
    const birthDate = new Date(dto.birthDate);
    this.assertAdult(birthDate);
    let user: User;
    try {
      user = await this.prisma.$transaction(async (tx) => {
        await this.consumeInvite(tx, dto.inviteCode);
        return tx.user.create({
          data: {
            email: dto.email.toLowerCase(),
            passwordHash: await hash(dto.password, 12),
            nickname: dto.nickname,
            handle: dto.handle.toLowerCase(),
            birthDate,
            timezone: process.env.APP_TIMEZONE ?? "Asia/Seoul",
          },
        });
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new ConflictException("이미 사용 중인 이메일 또는 아이디예요.");
      }
      throw error;
    }
    const token = await this.issueVerificationToken(user.id, VerificationTokenType.EMAIL_VERIFY, 24);
    await this.email.sendVerification(user.email, token);
    return { email: user.email, requiresVerification: true };
  }

  async login(dto: LoginDto, context: RequestContext) {
    const user = await this.prisma.user.findUnique({ where: { email: dto.email.toLowerCase() } });
    if (
      !user?.passwordHash ||
      !(await compare(dto.password, user.passwordHash)) ||
      user.suspendedAt ||
      user.deletionRequestedAt
    ) {
      throw new UnauthorizedException("이메일 또는 비밀번호를 확인해주세요.");
    }
    if (!user.emailVerifiedAt) {
      throw new UnauthorizedException("이메일 인증을 먼저 완료해주세요.");
    }
    return { user: this.safeUser(user), ...(await this.createSession(user, context)) };
  }

  async googleLogin(dto: GoogleLoginDto, context: RequestContext) {
    if (!process.env.GOOGLE_CLIENT_ID) throw new BadRequestException("Google 로그인이 아직 설정되지 않았어요.");
    const ticket = await this.google.verifyIdToken({
      idToken: dto.idToken,
      audience: process.env.GOOGLE_CLIENT_ID,
    });
    const profile = ticket.getPayload();
    if (!profile?.email || !profile.sub) throw new UnauthorizedException("Google 계정을 확인하지 못했어요.");
    let user = await this.prisma.user.findFirst({
      where: { OR: [{ googleId: profile.sub }, { email: profile.email.toLowerCase() }] },
    });
    if (!user) {
      if (!dto.birthDate) throw new BadRequestException("최초 가입에는 생년월일이 필요해요.");
      const birthDate = new Date(dto.birthDate);
      this.assertAdult(birthDate);
      user = await this.prisma.$transaction(async (tx) => {
        await this.consumeInvite(tx, dto.inviteCode);
        return tx.user.create({
          data: {
            email: profile.email!.toLowerCase(),
            googleId: profile.sub,
            nickname: profile.name?.slice(0, 20) ?? "새 구름",
            handle: dto.handle ?? `cloud.${profile.sub.slice(-8)}`,
            birthDate,
            timezone: process.env.APP_TIMEZONE ?? "Asia/Seoul",
            emailVerifiedAt: new Date(),
          },
        });
      });
    } else if (!user.googleId) {
      user = await this.prisma.user.update({
        where: { id: user.id },
        data: { googleId: profile.sub, emailVerifiedAt: user.emailVerifiedAt ?? new Date() },
      });
    }
    return { user: this.safeUser(user), ...(await this.createSession(user, context)) };
  }

  async verifyEmail(rawToken: string, context: RequestContext) {
    const tokenHash = this.digest(rawToken);
    const row = await this.prisma.verificationToken.findUnique({
      where: { tokenHash },
      include: { user: true },
    });
    if (
      !row ||
      row.type !== VerificationTokenType.EMAIL_VERIFY ||
      row.usedAt ||
      row.expiresAt <= new Date()
    ) {
      throw new BadRequestException("인증 링크가 만료됐거나 이미 사용됐어요.");
    }
    const user = await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.verificationToken.updateMany({ where: { id: row.id, usedAt: null, expiresAt: { gt: new Date() } }, data: { usedAt: new Date() } });
      if (claimed.count !== 1) throw new BadRequestException("인증 링크가 만료됐거나 이미 사용됐어요.");
      return tx.user.update({
        where: { id: row.userId },
        data: { emailVerifiedAt: row.user.emailVerifiedAt ?? new Date() },
      });
    });
    return { user: this.safeUser(user), ...(await this.createSession(user, context)) };
  }

  async resendVerification(email: string) {
    const user = await this.prisma.user.findUnique({ where: { email: email.toLowerCase() } });
    if (user && !user.emailVerifiedAt && !user.deletionRequestedAt && !user.suspendedAt) {
      const token = await this.issueVerificationToken(user.id, VerificationTokenType.EMAIL_VERIFY, 24);
      await this.email.sendVerification(user.email, token);
    }
    return { ok: true };
  }

  async forgotPassword(email: string) {
    const user = await this.prisma.user.findUnique({ where: { email: email.toLowerCase() } });
    if (user?.passwordHash && !user.deletionRequestedAt && !user.suspendedAt) {
      const token = await this.issueVerificationToken(user.id, VerificationTokenType.PASSWORD_RESET, 1);
      await this.email.sendPasswordReset(user.email, token);
    }
    return { ok: true };
  }

  async resetPassword(rawToken: string, password: string) {
    const tokenHash = this.digest(rawToken);
    const row = await this.prisma.verificationToken.findUnique({ where: { tokenHash } });
    if (
      !row ||
      row.type !== VerificationTokenType.PASSWORD_RESET ||
      row.usedAt ||
      row.expiresAt <= new Date()
    ) {
      throw new BadRequestException("재설정 링크가 만료됐거나 이미 사용됐어요.");
    }
    const passwordHash = await hash(password, 12);
    await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.verificationToken.updateMany({ where: { id: row.id, usedAt: null, expiresAt: { gt: new Date() } }, data: { usedAt: new Date() } });
      if (claimed.count !== 1) throw new BadRequestException("재설정 링크가 만료됐거나 이미 사용됐어요.");
      await tx.user.update({ where: { id: row.userId }, data: { passwordHash } });
      await tx.session.updateMany({ where: { userId: row.userId, revokedAt: null }, data: { revokedAt: new Date() } });
    });
    return { ok: true };
  }

  async refresh(refreshToken: string | undefined, context: RequestContext) {
    if (!refreshToken) throw new UnauthorizedException("다시 로그인해주세요.");
    const payload = await this.jwt
      .verifyAsync<RefreshUser>(refreshToken, { secret: process.env.JWT_REFRESH_SECRET })
      .catch(() => null);
    if (!payload?.sid || !payload.fid) throw new UnauthorizedException("다시 로그인해주세요.");
    const session = await this.prisma.session.findUnique({ where: { id: payload.sid } });
    if (!session || session.revokedAt || session.expiresAt <= new Date()) {
      throw new UnauthorizedException("다시 로그인해주세요.");
    }
    if (!this.safeDigestEqual(session.tokenHash, this.digest(refreshToken))) {
      await this.prisma.session.updateMany({
        where: { familyId: session.familyId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      throw new UnauthorizedException("세션을 다시 확인해주세요.");
    }
    const user = await this.prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user?.emailVerifiedAt || user.suspendedAt || user.deletionRequestedAt) {
      throw new UnauthorizedException("다시 로그인해주세요.");
    }
    return {
      user: this.safeUser(user),
      ...(await this.rotateSession(user, session.id, session.familyId, context, false, session.tokenHash)),
    };
  }

  async logout(sessionId: string) {
    await this.prisma.session.updateMany({
      where: { id: sessionId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return { ok: true };
  }

  async logoutAll(userId: string) {
    await this.prisma.session.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return { ok: true };
  }

  async me(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    return this.safeUser(user);
  }

  async requestDeletion(userId: string) {
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: userId },
        data: { deletionRequestedAt: new Date() },
      }),
      this.prisma.session.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);
    return { ok: true, purgeWithinDays: 7 };
  }

  private async createSession(
    user: { id: string; email: string; role: string },
    context: RequestContext,
  ) {
    return this.rotateSession(user, randomUUID(), randomUUID(), context, true);
  }

  private async rotateSession(
    user: { id: string; email: string; role: string },
    sessionId: string,
    familyId: string,
    context: RequestContext,
    create = false,
    expectedTokenHash?: string,
  ) {
    const accessPayload: JwtUser = {
      sub: user.id,
      email: user.email,
      role: user.role,
      sid: sessionId,
    };
    const refreshPayload: RefreshUser = {
      ...accessPayload,
      fid: familyId,
      jti: randomUUID(),
    };
    const accessToken = await this.jwt.signAsync(accessPayload, {
      secret: process.env.JWT_ACCESS_SECRET,
      expiresIn: "15m",
    });
    const refreshToken = await this.jwt.signAsync(refreshPayload, {
      secret: process.env.JWT_REFRESH_SECRET,
      expiresIn: "30d",
    });
    const expiresAt = new Date(Date.now() + 30 * 86400_000);
    const data = {
      tokenHash: this.digest(refreshToken),
      expiresAt,
      lastUsedAt: new Date(),
      userAgent: context.userAgent?.slice(0, 300),
      ipHash: context.ip ? this.digest(context.ip) : undefined,
    };
    if (create) {
      await this.prisma.session.create({
        data: { id: sessionId, familyId, userId: user.id, ...data },
      });
    } else {
      const updated = await this.prisma.session.updateMany({
        where: { id: sessionId, familyId, revokedAt: null, ...(expectedTokenHash ? { tokenHash: expectedTokenHash } : {}) },
        data,
      });
      if (updated.count !== 1) {
        await this.prisma.session.updateMany({ where: { familyId, revokedAt: null }, data: { revokedAt: new Date() } });
        throw new UnauthorizedException("세션을 다시 확인해주세요.");
      }
    }
    return { accessToken, refreshToken };
  }

  private async issueVerificationToken(
    userId: string,
    type: VerificationTokenType,
    validHours: number,
  ) {
    const rawToken = randomBytes(32).toString("base64url");
    await this.prisma.$transaction([
      this.prisma.verificationToken.deleteMany({
        where: { userId, type, usedAt: null },
      }),
      this.prisma.verificationToken.create({
        data: {
          userId,
          type,
          tokenHash: this.digest(rawToken),
          expiresAt: new Date(Date.now() + validHours * 3600_000),
        },
      }),
    ]);
    return rawToken;
  }

  private async consumeInvite(tx: Prisma.TransactionClient, rawCode?: string) {
    if (process.env.INVITE_REQUIRED !== "true") return;
    if (!rawCode) throw new BadRequestException("초대 코드가 필요해요.");
    const invite = await tx.inviteCode.findUnique({
      where: { codeHash: this.digest(rawCode.trim().toUpperCase()) },
    });
    if (
      !invite ||
      invite.disabledAt ||
      (invite.expiresAt && invite.expiresAt <= new Date()) ||
      invite.uses >= invite.maxUses
    ) {
      throw new BadRequestException("사용할 수 없는 초대 코드예요.");
    }
    const claimed = await tx.inviteCode.updateMany({
      where: {
        id: invite.id,
        disabledAt: null,
        uses: { lt: invite.maxUses },
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      },
      data: { uses: { increment: 1 } },
    });
    if (claimed.count !== 1) throw new BadRequestException("사용할 수 없는 초대 코드예요.");
  }

  private digest(value: string) {
    return createHash("sha256").update(value).digest("hex");
  }

  private safeDigestEqual(left: string, right: string) {
    const a = Buffer.from(left);
    const b = Buffer.from(right);
    return a.length === b.length && timingSafeEqual(a, b);
  }

  private safeUser(user: {
    id: string;
    email: string;
    nickname: string;
    handle: string;
    role: string;
    availablePoints: number;
    lifetimePower: number;
    recentVitality: number;
    avatarUrl: string | null;
    bio?: string | null;
    interests?: string[];
    timezone?: string;
    onboardingCompletedAt?: Date | null;
    emailVerifiedAt?: Date | null;
  }) {
    return {
      id: user.id,
      email: user.email,
      nickname: user.nickname,
      handle: user.handle,
      role: user.role,
      availablePoints: user.availablePoints,
      lifetimePower: user.lifetimePower,
      recentVitality: user.recentVitality,
      avatarUrl: user.avatarUrl,
      bio: user.bio,
      interests: user.interests ?? [],
      timezone: user.timezone ?? "Asia/Seoul",
      onboardingCompletedAt: user.onboardingCompletedAt ?? null,
      emailVerifiedAt: user.emailVerifiedAt ?? null,
    };
  }
}

@Controller("auth")
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  private context(request: Request): RequestContext {
    return {
      userAgent: request.headers["user-agent"],
      ip: request.ip || request.socket.remoteAddress,
    };
  }

  private cookie(response: Response, token: string) {
    response.cookie("mungsil_refresh", token, {
      httpOnly: true,
      secure: this.secureCookie(),
      sameSite: "lax",
      maxAge: 30 * 86400_000,
      path: "/api/v1/auth",
    });
  }

  private clearCookie(response: Response) {
    response.clearCookie("mungsil_refresh", {
      httpOnly: true,
      secure: this.secureCookie(),
      sameSite: "lax",
      path: "/api/v1/auth",
    });
  }

  private secureCookie() {
    return process.env.COOKIE_SECURE === undefined
      ? process.env.NODE_ENV === "production"
      : process.env.COOKIE_SECURE === "true";
  }

  @Post("signup")
  signup(@Body() dto: SignupDto) {
    return this.auth.signup(dto);
  }

  @Post("login")
  async login(
    @Body() dto: LoginDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.auth.login(dto, this.context(request));
    this.cookie(response, result.refreshToken);
    return { user: result.user, accessToken: result.accessToken };
  }

  @Post("google")
  async google(
    @Body() dto: GoogleLoginDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.auth.googleLogin(dto, this.context(request));
    this.cookie(response, result.refreshToken);
    return { user: result.user, accessToken: result.accessToken };
  }

  @Post("verify-email")
  async verifyEmail(
    @Body() dto: TokenDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.auth.verifyEmail(dto.token, this.context(request));
    this.cookie(response, result.refreshToken);
    return { user: result.user, accessToken: result.accessToken };
  }

  @Post("resend-verification")
  resendVerification(@Body() dto: EmailDto) {
    return this.auth.resendVerification(dto.email);
  }

  @Post("forgot-password")
  forgotPassword(@Body() dto: EmailDto) {
    return this.auth.forgotPassword(dto.email);
  }

  @Post("reset-password")
  resetPassword(@Body() dto: ResetPasswordDto) {
    return this.auth.resetPassword(dto.token, dto.password);
  }

  @Post("refresh")
  async refresh(
    @Body() dto: RefreshDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.auth.refresh(
      dto.refreshToken || request.cookies?.mungsil_refresh,
      this.context(request),
    );
    this.cookie(response, result.refreshToken);
    return { user: result.user, accessToken: result.accessToken };
  }

  @UseGuards(JwtAuthGuard)
  @Post("logout")
  async logout(
    @CurrentUser() user: JwtUser,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.auth.logout(user.sid);
    this.clearCookie(response);
    return result;
  }

  @UseGuards(JwtAuthGuard)
  @Post("logout-all")
  async logoutAll(
    @CurrentUser() user: JwtUser,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.auth.logoutAll(user.sub);
    this.clearCookie(response);
    return result;
  }

  @UseGuards(JwtAuthGuard)
  @Get("me")
  meGet(@CurrentUser() user: JwtUser) {
    return this.auth.me(user.sub);
  }

  @UseGuards(JwtAuthGuard)
  @Post("me")
  me(@CurrentUser() user: JwtUser) {
    return this.auth.me(user.sub);
  }

  @UseGuards(JwtAuthGuard)
  @Post("delete-account")
  async deleteAccount(
    @CurrentUser() user: JwtUser,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.auth.requestDeletion(user.sub);
    this.clearCookie(response);
    return result;
  }
}
