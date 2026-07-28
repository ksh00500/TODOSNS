import { Body, Controller, Delete, ForbiddenException, Get, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { CurrentUser, JwtAuthGuard, OptionalJwtAuthGuard } from "./auth";
import { CheckInDto, CloneTodoDto, CloneTodoListDto, CommentDto, CompleteMediaDto, CompleteTodoDto, CreateChallengeDto, CreatePostDto, CreateReportDto, CreateTodoDto, CreateTodoListDto, MessageRequestDto, PageDto, PresignDto, ResolveReportDto, SearchDto, SendMessageDto, UpdateChallengeRewardDto, UpdateProfileDto, UpdateTodoDto, UpdateTodoListDto, UserTargetDto } from "./dtos";
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
  @Post(":id/restore") restore(@CurrentUser() u: JwtUser, @Param("id") id: string) { return this.service.restoreTodo(u.sub, id); }
  @Post(":id/complete") complete(@CurrentUser() u: JwtUser, @Param("id") id: string, @Body() dto: CompleteTodoDto) { return this.service.completeTodo(u.sub, id, dto); }
  @Post(":id/uncomplete") uncomplete(@CurrentUser() u: JwtUser, @Param("id") id: string) { return this.service.uncompleteTodo(u.sub, id); }
  @Post(":id/clone") clone(@CurrentUser() u: JwtUser, @Param("id") id: string, @Body() dto: CloneTodoDto) { return this.service.cloneTodo(u.sub, id, dto); }
  @Delete(":id/series") endSeries(@CurrentUser() u: JwtUser, @Param("id") id: string) { return this.service.endTodoSeries(u.sub, id); }
}

@UseGuards(JwtAuthGuard)
@Controller("todo-lists")
export class TodoListController {
  constructor(private readonly service: MungsilService) {}
  @Get() list(@CurrentUser() u: JwtUser) { return this.service.listTodoLists(u.sub); }
  @Post() create(@CurrentUser() u: JwtUser, @Body() dto: CreateTodoListDto) { return this.service.createTodoList(u.sub, dto); }
  @Patch(":id") update(@CurrentUser() u: JwtUser, @Param("id") id: string, @Body() dto: UpdateTodoListDto) { return this.service.updateTodoList(u.sub, id, dto); }
  @Delete(":id") remove(@CurrentUser() u: JwtUser, @Param("id") id: string) { return this.service.removeTodoList(u.sub, id); }
  @Post(":id/clone") clone(@CurrentUser() u: JwtUser, @Param("id") id: string, @Body() dto: CloneTodoListDto) { return this.service.cloneTodoList(u.sub, id, dto); }
}

@UseGuards(JwtAuthGuard)
@Controller("feed")
export class FeedController {
  constructor(private readonly service: MungsilService) {}
  @Get() feed(@CurrentUser() u: JwtUser, @Query() page: PageDto, @Query("mode") mode?: string, @Query("category") category?: string) { return this.service.feed(u.sub, page, mode, category); }
  @Get("posts/:id") detail(@CurrentUser() u: JwtUser, @Param("id") id: string) { return this.service.postDetail(id, u.sub); }
  @Get("posts/:id/comments") comments(@CurrentUser() u: JwtUser, @Param("id") id: string) { return this.service.postComments(id, u.sub); }
  @Post("posts") post(@CurrentUser() u: JwtUser, @Body() dto: CreatePostDto) { return this.service.createPost(u.sub, dto); }
  @Post("posts/:id/cheer") cheer(@CurrentUser() u: JwtUser, @Param("id") id: string) { return this.service.toggleCheer(u.sub, id); }
  @Post("posts/:id/comments") comment(@CurrentUser() u: JwtUser, @Param("id") id: string, @Body() dto: CommentDto) { return this.service.comment(u.sub, id, dto.body); }
  @Delete("posts/:id") removePost(@CurrentUser() u: JwtUser, @Param("id") id: string) { return this.service.removePost(u.sub, id); }
  @Delete("comments/:id") removeComment(@CurrentUser() u: JwtUser, @Param("id") id: string) { return this.service.removeComment(u.sub, id); }
}

@UseGuards(OptionalJwtAuthGuard)
@Controller("public")
export class PublicController {
  constructor(private readonly service: MungsilService) {}
  @Get("feed") feed(@CurrentUser() u: JwtUser | undefined, @Query() page: PageDto, @Query("mode") mode?: string, @Query("category") category?: string) { return this.service.feed(u?.sub ?? null, page, mode, category); }
  @Get("posts/:id") post(@CurrentUser() u: JwtUser | undefined, @Param("id") id: string) { return this.service.postDetail(id, u?.sub ?? null); }
  @Get("posts/:id/comments") comments(@CurrentUser() u: JwtUser | undefined, @Param("id") id: string) { return this.service.postComments(id, u?.sub ?? null); }
  @Get("users/:handle") user(@CurrentUser() u: JwtUser | undefined, @Param("handle") handle: string) { return this.service.publicProfile(handle, u?.sub ?? null); }
  @Get("users/:handle/posts") userPosts(@CurrentUser() u: JwtUser | undefined, @Param("handle") handle: string, @Query() page: PageDto) { return this.service.publicUserPosts(handle, page, u?.sub ?? null); }
  @Get("search") search(@CurrentUser() u: JwtUser | undefined, @Query() query: SearchDto) { return this.service.publicSearch(query, u?.sub ?? null); }
  @Get("challenges") challenges(@CurrentUser() u: JwtUser | undefined) { return this.service.publicChallenges(u?.sub ?? null); }
  @Get("challenges/:id") challenge(@CurrentUser() u: JwtUser | undefined, @Param("id") id: string) { return this.service.challengeDetail(id, u?.sub ?? null); }
}

@UseGuards(JwtAuthGuard)
@Controller("challenges")
export class ChallengeController {
  constructor(private readonly service: MungsilService) {}
  @Get() list(@CurrentUser() u: JwtUser) { return this.service.listChallenges(u.sub); }
  @Get(":id") detail(@CurrentUser() u: JwtUser, @Param("id") id: string) { return this.service.challengeDetail(id, u.sub); }
  @Post() create(@CurrentUser() u: JwtUser, @Body() dto: CreateChallengeDto) { return this.service.createChallenge(u.sub, u.role, dto); }
  @Post(":id/join") join(@CurrentUser() u: JwtUser, @Param("id") id: string) { return this.service.joinChallenge(u.sub, id); }
  @Delete(":id/join") leave(@CurrentUser() u: JwtUser, @Param("id") id: string) { return this.service.leaveChallenge(u.sub, id); }
  @Post(":id/check-in") checkIn(@CurrentUser() u: JwtUser, @Param("id") id: string, @Body() dto: CheckInDto) { return this.service.checkIn(u.sub, id, dto); }
}

@UseGuards(JwtAuthGuard)
@Controller("social")
export class SocialController {
  constructor(private readonly service: MungsilService) {}
  @Post("follow") follow(@CurrentUser() u: JwtUser, @Body() dto: UserTargetDto) { return this.service.toggleFollow(u.sub, dto.userId); }
  @Post("block") block(@CurrentUser() u: JwtUser, @Body() dto: UserTargetDto) { return this.service.block(u.sub, dto.userId); }
  @Post("report") report(@CurrentUser() u: JwtUser, @Body() dto: CreateReportDto) { return this.service.report(u.sub, dto); }
  @Get("follow-state/:userId") followState(@CurrentUser() u: JwtUser, @Param("userId") userId: string) { return this.service.followState(u.sub, userId); }
  @Get("followers/:userId") followers(@CurrentUser() u: JwtUser, @Param("userId") userId: string, @Query() page: PageDto) { return this.service.followers(u.sub, userId, page); }
  @Get("following/:userId") following(@CurrentUser() u: JwtUser, @Param("userId") userId: string, @Query() page: PageDto) { return this.service.following(u.sub, userId, page); }
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
  @Patch() update(@CurrentUser() u: JwtUser, @Body() dto: UpdateProfileDto) { return this.service.updateProfile(u.sub, dto); }
  @Get("notifications") notifications(@CurrentUser() u: JwtUser, @Query() page: PageDto) { return this.service.notifications(u.sub, page); }
  @Get("notifications/unread-count") unreadCount(@CurrentUser() u: JwtUser) { return this.service.unreadNotificationCount(u.sub); }
  @Post("notifications/read") read(@CurrentUser() u: JwtUser) { return this.service.readNotifications(u.sub); }
  @Post("media/presign") presign(@CurrentUser() u: JwtUser, @Body() dto: PresignDto) { return this.media.presign(u.sub, dto); }
  @Post("media/complete") completeMedia(@CurrentUser() u: JwtUser, @Body() dto: CompleteMediaDto) { return this.media.complete(u.sub, dto); }
}

@UseGuards(JwtAuthGuard)
@Controller("admin")
export class AdminController {
  constructor(private readonly service: MungsilService) {}
  private allow(u: JwtUser) { if (!["ADMIN", "MODERATOR"].includes(u.role)) throw new ForbiddenException("운영자 권한이 필요해요."); }
  @Get("reports") reports(@CurrentUser() u: JwtUser) { this.allow(u); return this.service.adminReports(); }
  @Patch("reports/:id") resolve(@CurrentUser() u: JwtUser, @Param("id") id: string, @Body() dto: ResolveReportDto) { this.allow(u); return this.service.resolveReport(u.sub, id, dto.status as "RESOLVED" | "DISMISSED" | "REVIEWING", dto.resolution); }
  @Get("challenges/:challengeId/participants") challengeParticipants(@CurrentUser() u: JwtUser, @Param("challengeId") challengeId: string) { this.allow(u); return this.service.adminChallengeParticipants(challengeId); }
  @Patch("challenges/:challengeId/participants/:userId/reward") reward(@CurrentUser() u: JwtUser, @Param("challengeId") challengeId: string, @Param("userId") userId: string, @Body() dto: UpdateChallengeRewardDto) { this.allow(u); return this.service.updateChallengeReward(challengeId, userId, dto.status); }
}
