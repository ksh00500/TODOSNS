import { Body, CanActivate, Controller, createParamDecorator, ExecutionContext, Injectable, Post, Req, Res, UnauthorizedException, UseGuards } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { compare, hash } from "bcryptjs";
import { OAuth2Client } from "google-auth-library";
import type { Request, Response } from "express";
import { PrismaService } from "./prisma.service";
import { GoogleLoginDto, LoginDto, RefreshDto, SignupDto } from "./auth.dto";

type JwtUser = { sub: string; role: string; email: string };
export const CurrentUser = createParamDecorator((_data: unknown, context: ExecutionContext) => context.switchToHttp().getRequest<Request & { user: JwtUser }>().user);

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly jwt: JwtService) {}
  canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<Request & { user: JwtUser }>();
    const token = request.headers.authorization?.replace(/^Bearer\s+/i, "");
    if (!token) throw new UnauthorizedException("로그인이 필요해요.");
    try { request.user = this.jwt.verify<JwtUser>(token, { secret: process.env.JWT_ACCESS_SECRET }); return true; }
    catch { throw new UnauthorizedException("로그인이 만료됐어요."); }
  }
}

@Injectable()
export class AuthService {
  private readonly google = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);
  constructor(private readonly prisma: PrismaService, private readonly jwt: JwtService) {}

  private assertAdult(date: Date) {
    const cutoff = new Date(); cutoff.setFullYear(cutoff.getFullYear() - 18);
    if (date > cutoff) throw new UnauthorizedException("뭉실 MVP는 만 18세 이상만 가입할 수 있어요.");
  }

  private async tokens(user: { id: string; email: string; role: string }) {
    const payload: JwtUser = { sub: user.id, email: user.email, role: user.role };
    const accessToken = await this.jwt.signAsync(payload, { secret: process.env.JWT_ACCESS_SECRET, expiresIn: "15m" });
    const refreshToken = await this.jwt.signAsync(payload, { secret: process.env.JWT_REFRESH_SECRET, expiresIn: "30d" });
    await this.prisma.user.update({ where: { id: user.id }, data: { refreshTokenHash: await hash(refreshToken, 10) } });
    return { accessToken, refreshToken };
  }

  async signup(dto: SignupDto) {
    const birthDate = new Date(dto.birthDate); this.assertAdult(birthDate);
    const user = await this.prisma.user.create({ data: { email: dto.email.toLowerCase(), passwordHash: await hash(dto.password, 12), nickname: dto.nickname, handle: dto.handle.toLowerCase(), birthDate } });
    return { user: this.safeUser(user), ...(await this.tokens(user)) };
  }

  async login(dto: LoginDto) {
    const user = await this.prisma.user.findUnique({ where: { email: dto.email.toLowerCase() } });
    if (!user?.passwordHash || !(await compare(dto.password, user.passwordHash)) || user.suspendedAt || user.deletionRequestedAt) throw new UnauthorizedException("이메일 또는 비밀번호를 확인해주세요.");
    return { user: this.safeUser(user), ...(await this.tokens(user)) };
  }

  async googleLogin(dto: GoogleLoginDto) {
    const ticket = await this.google.verifyIdToken({ idToken: dto.idToken, audience: process.env.GOOGLE_CLIENT_ID });
    const profile = ticket.getPayload();
    if (!profile?.email || !profile.sub) throw new UnauthorizedException("Google 계정을 확인하지 못했어요.");
    let user = await this.prisma.user.findFirst({ where: { OR: [{ googleId: profile.sub }, { email: profile.email }] } });
    if (!user) {
      if (!dto.birthDate) throw new UnauthorizedException("최초 가입에는 생년월일이 필요해요.");
      const birthDate = new Date(dto.birthDate); this.assertAdult(birthDate);
      user = await this.prisma.user.create({ data: { email: profile.email, googleId: profile.sub, nickname: profile.name?.slice(0, 20) ?? "새 구름", handle: dto.handle ?? `cloud.${profile.sub.slice(-8)}`, birthDate, emailVerifiedAt: new Date() } });
    }
    return { user: this.safeUser(user), ...(await this.tokens(user)) };
  }

  async refresh(refreshToken: string) {
    const payload = await this.jwt.verifyAsync<JwtUser>(refreshToken, { secret: process.env.JWT_REFRESH_SECRET }).catch(() => null);
    if (!payload) throw new UnauthorizedException("다시 로그인해주세요.");
    const user = await this.prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user?.refreshTokenHash || !(await compare(refreshToken, user.refreshTokenHash))) throw new UnauthorizedException("다시 로그인해주세요.");
    return { user: this.safeUser(user), ...(await this.tokens(user)) };
  }

  async logout(userId: string) { await this.prisma.user.update({ where: { id: userId }, data: { refreshTokenHash: null } }); return { ok: true }; }
  async me(userId: string) { const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } }); return this.safeUser(user); }
  async requestDeletion(userId: string) { await this.prisma.user.update({ where: { id: userId }, data: { deletionRequestedAt: new Date(), refreshTokenHash: null } }); return { ok: true, purgeWithinDays: 7 }; }
  private safeUser(user: { id: string; email: string; nickname: string; handle: string; role: string; availablePoints: number; lifetimePower: number; recentVitality: number; avatarUrl: string | null; bio?: string | null; interests?: string[] }) { return { id: user.id, email: user.email, nickname: user.nickname, handle: user.handle, role: user.role, availablePoints: user.availablePoints, lifetimePower: user.lifetimePower, recentVitality: user.recentVitality, avatarUrl: user.avatarUrl, bio: user.bio, interests: user.interests ?? [] }; }
}

@Controller("auth")
export class AuthController {
  constructor(private readonly auth: AuthService) {}
  private cookie(response: Response, token: string) { response.cookie("mungsil_refresh", token, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", maxAge: 30 * 86400_000, path: "/api/v1/auth" }); }
  @Post("signup") async signup(@Body() dto: SignupDto, @Res({ passthrough: true }) res: Response) { const result = await this.auth.signup(dto); this.cookie(res, result.refreshToken); return result; }
  @Post("login") async login(@Body() dto: LoginDto, @Res({ passthrough: true }) res: Response) { const result = await this.auth.login(dto); this.cookie(res, result.refreshToken); return result; }
  @Post("google") async google(@Body() dto: GoogleLoginDto, @Res({ passthrough: true }) res: Response) { const result = await this.auth.googleLogin(dto); this.cookie(res, result.refreshToken); return result; }
  @Post("refresh") async refresh(@Body() dto: RefreshDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) { const token = dto.refreshToken || req.cookies?.mungsil_refresh; const result = await this.auth.refresh(token); this.cookie(res, result.refreshToken); return result; }
  @UseGuards(JwtAuthGuard) @Post("logout") logout(@CurrentUser() user: JwtUser) { return this.auth.logout(user.sub); }
  @UseGuards(JwtAuthGuard) @Post("me") me(@CurrentUser() user: JwtUser) { return this.auth.me(user.sub); }
  @UseGuards(JwtAuthGuard) @Post("delete-account") deleteAccount(@CurrentUser() user: JwtUser) { return this.auth.requestDeletion(user.sub); }
}
