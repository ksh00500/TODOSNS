import { Body, Controller, Delete, ForbiddenException, Get, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { CurrentUser, JwtAuthGuard } from "./auth";
import { CheckInDto, CloneTodoDto, CommentDto, CompleteTodoDto, CreateChallengeDto, CreatePostDto, CreateReportDto, CreateTodoDto, MessageRequestDto, PageDto, PresignDto, ResolveReportDto, SendMessageDto, UpdateTodoDto, UserTargetDto } from "./dtos";
import { MediaService } from "./media.service";
import { MungsilService } from "./mungsil.service";

type JwtUser = { sub: string; role: string; email: string };

@UseGuards(JwtAuthGuard)
@Controller("todos")
export class TodoController {
  constructor(private readonly service: MungsilService) {}
  @Get() list(@CurrentUser() u: JwtUser, @Query("from") from?: string, @Query("to") to?: string) { return this.service.listTodos(u.sub, from, to); }
  @Post() create(@CurrentUser() u: JwtUser, @Body() dto: CreateTodoDto) { return this.service.createTodo(u.sub, dto); }
  @Patch(":id") update(@CurrentUser() u: JwtUser, @Param("id") id: string, @Body() dto: UpdateTodoDto) { return this.service.updateTodo(u.sub, id, dto); }
  @Delete(":id") remove(@CurrentUser() u: JwtUser, @Param("id") id: string) { return this.service.removeTodo(u.sub, id); }
  @Post(":id/complete") complete(@CurrentUser() u: JwtUser, @Param("id") id: string, @Body() dto: CompleteTodoDto) { return this.service.completeTodo(u.sub, id, dto); }
  @Post(":id/clone") clone(@CurrentUser() u: JwtUser, @Param("id") id: string, @Body() dto: CloneTodoDto) { return this.service.cloneTodo(u.sub, id, dto); }
}

@UseGuards(JwtAuthGuard)
@Controller("feed")
export class FeedController {
  constructor(private readonly service: MungsilService) {}
  @Get() feed(@CurrentUser() u: JwtUser, @Query() page: PageDto, @Query("mode") mode?: string) { return this.service.feed(u.sub, page, mode); }
  @Post("posts") post(@CurrentUser() u: JwtUser, @Body() dto: CreatePostDto) { return this.service.createPost(u.sub, dto); }
  @Post("posts/:id/cheer") cheer(@CurrentUser() u: JwtUser, @Param("id") id: string) { return this.service.toggleCheer(u.sub, id); }
  @Post("posts/:id/comments") comment(@CurrentUser() u: JwtUser, @Param("id") id: string, @Body() dto: CommentDto) { return this.service.comment(u.sub, id, dto.body); }
}

@UseGuards(JwtAuthGuard)
@Controller("challenges")
export class ChallengeController {
  constructor(private readonly service: MungsilService) {}
  @Get() list(@CurrentUser() u: JwtUser) { return this.service.listChallenges(u.sub); }
  @Post() create(@CurrentUser() u: JwtUser, @Body() dto: CreateChallengeDto) { return this.service.createChallenge(u.sub, u.role, dto); }
  @Post(":id/join") join(@CurrentUser() u: JwtUser, @Param("id") id: string) { return this.service.joinChallenge(u.sub, id); }
  @Post(":id/check-in") checkIn(@CurrentUser() u: JwtUser, @Param("id") id: string, @Body() dto: CheckInDto) { return this.service.checkIn(u.sub, id, dto); }
}

@UseGuards(JwtAuthGuard)
@Controller("social")
export class SocialController {
  constructor(private readonly service: MungsilService) {}
  @Post("follow") follow(@CurrentUser() u: JwtUser, @Body() dto: UserTargetDto) { return this.service.toggleFollow(u.sub, dto.userId); }
  @Post("block") block(@CurrentUser() u: JwtUser, @Body() dto: UserTargetDto) { return this.service.block(u.sub, dto.userId); }
  @Post("report") report(@CurrentUser() u: JwtUser, @Body() dto: CreateReportDto) { return this.service.report(u.sub, dto); }
}

@UseGuards(JwtAuthGuard)
@Controller("messages")
export class MessageController {
  constructor(private readonly service: MungsilService) {}
  @Get() conversations(@CurrentUser() u: JwtUser) { return this.service.listConversations(u.sub); }
  @Post("requests") request(@CurrentUser() u: JwtUser, @Body() dto: MessageRequestDto) { return this.service.requestMessage(u.sub, dto.receiverId); }
  @Post("requests/:id/accept") accept(@CurrentUser() u: JwtUser, @Param("id") id: string) { return this.service.acceptMessage(u.sub, id); }
  @Get(":id") messages(@CurrentUser() u: JwtUser, @Param("id") id: string) { return this.service.messages(u.sub, id); }
  @Post(":id") send(@CurrentUser() u: JwtUser, @Param("id") id: string, @Body() dto: SendMessageDto) { return this.service.sendMessage(u.sub, id, dto); }
}

@UseGuards(JwtAuthGuard)
@Controller("me")
export class MeController {
  constructor(private readonly service: MungsilService, private readonly media: MediaService) {}
  @Get() profile(@CurrentUser() u: JwtUser) { return this.service.profile(u.sub); }
  @Get("notifications") notifications(@CurrentUser() u: JwtUser) { return this.service.notifications(u.sub); }
  @Post("notifications/read") read(@CurrentUser() u: JwtUser) { return this.service.readNotifications(u.sub); }
  @Post("media/presign") presign(@CurrentUser() u: JwtUser, @Body() dto: PresignDto) { return this.media.presign(u.sub, dto); }
}

@UseGuards(JwtAuthGuard)
@Controller("admin")
export class AdminController {
  constructor(private readonly service: MungsilService) {}
  private allow(u: JwtUser) { if (!["ADMIN", "MODERATOR"].includes(u.role)) throw new ForbiddenException("운영자 권한이 필요해요."); }
  @Get("reports") reports(@CurrentUser() u: JwtUser) { this.allow(u); return this.service.adminReports(); }
  @Patch("reports/:id") resolve(@CurrentUser() u: JwtUser, @Param("id") id: string, @Body() dto: ResolveReportDto) { this.allow(u); return this.service.resolveReport(u.sub, id, dto.status as "RESOLVED" | "DISMISSED" | "REVIEWING", dto.resolution); }
}
