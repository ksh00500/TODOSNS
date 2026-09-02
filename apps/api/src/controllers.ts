import { Body, Controller, Delete, ForbiddenException, Get, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { CurrentUser, JwtAuthGuard, OptionalJwtAuthGuard } from "./auth";
import { AdminContentQueryDto, AdminUserQueryDto, CheckInDto, CloneTodoDto, CloneTodoListDto, CommentDto, CompleteMediaDto, CompleteTodoDto, CreateChallengeChatMessageDto, CreateChallengeDto, CreateInviteCodeDto, CreatePostDto, CreateReportDto, CreateTodoCategoryDto, CreateTodoDto, CreateTodoListDto, MessageRequestDto, ModerateChatMessageDto, MuteChatMemberDto, PageDto, PresignDto, ReadChallengeChatDto, ReorderTodoCategoriesDto, ResolveReportDto, SearchDto, ToggleChatReactionDto, UpdateChallengeChatMessageDto, UpdateChallengeDto, UpdateChallengeRewardDto, UpdateChatSettingsDto, UpdateContentVisibilityDto, UpdateInviteCodeDto, UpdateProfileDto, UpdateTodoCategoryDto, UpdateTodoDto, UpdateTodoListDto, UpdateUserSuspensionDto, UserTargetDto, VerificationQueueDto, VerificationVoteDto } from "./dtos";
import { MediaService } from "./media.service";
import { MungsilService } from "./mungsil.service";
import { ChallengeChatService } from "./challenge-chat.service";
import { DirectChatService } from "./direct-chat.service";
import { ChatReactionType } from "@prisma/client";

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
  @Get("search/suggestions") searchSuggestions(@Query("limit") limit?: string) { const parsed = Number(limit ?? 10); return this.service.publicSearchSuggestions(Number.isFinite(parsed) ? parsed : 10); }
  @Get("search") search(@CurrentUser() u: JwtUser | undefined, @Query() query: SearchDto) { return this.service.publicSearch(query, u?.sub ?? null); }
  @Get("challenges") challenges(@CurrentUser() u: JwtUser | undefined) { return this.service.publicChallenges(u?.sub ?? null); }
  @Get("challenges/:id") challenge(@CurrentUser() u: JwtUser | undefined, @Param("id") id: string) { return this.service.challengeDetail(id, u?.sub ?? null); }
  @Get("challenges/:id/leaderboard") challengeLeaderboard(@CurrentUser() u: JwtUser | undefined, @Param("id") id: string) { return this.service.challengeLeaderboard(id, u?.sub ?? null); }
}

@UseGuards(JwtAuthGuard)
@Controller("challenges")
export class ChallengeController {
  constructor(private readonly service: MungsilService) {}
  @Get() list(@CurrentUser() u: JwtUser) { return this.service.listChallenges(u.sub); }
  @Get("past") past(@CurrentUser() u: JwtUser) { return this.service.pastChallenges(u.sub); }
  @Get(":id") detail(@CurrentUser() u: JwtUser, @Param("id") id: string) { return this.service.challengeDetail(id, u.sub); }
  @Get(":id/leaderboard") leaderboard(@CurrentUser() u: JwtUser, @Param("id") id: string) { return this.service.challengeLeaderboard(id, u.sub); }
  @Post() create(@CurrentUser() u: JwtUser, @Body() dto: CreateChallengeDto) { return this.service.createChallenge(u.sub, u.role, dto); }
  @Patch(":id") update(@CurrentUser() u: JwtUser, @Param("id") id: string, @Body() dto: UpdateChallengeDto) { return this.service.updateChallenge(u.sub, u.role, id, dto); }
  @Delete(":id") remove(@CurrentUser() u: JwtUser, @Param("id") id: string) { return this.service.removeChallenge(u.sub, u.role, id); }
  @Post(":id/join") join(@CurrentUser() u: JwtUser, @Param("id") id: string) { return this.service.joinChallenge(u.sub, id); }
  @Delete(":id/join") leave(@CurrentUser() u: JwtUser, @Param("id") id: string) { return this.service.leaveChallenge(u.sub, id); }
  @Post(":id/check-in") checkIn(@CurrentUser() u: JwtUser, @Param("id") id: string, @Body() dto: CheckInDto) { return this.service.checkIn(u.sub, id, dto); }
}

@UseGuards(JwtAuthGuard)
@Controller("challenges/:challengeId/chat")
export class ChallengeChatController {
  constructor(private readonly chat: ChallengeChatService) {}
  @Get() list(@CurrentUser() u: JwtUser, @Param("challengeId") challengeId: string, @Query() page: PageDto) { return this.chat.chat(u.sub, u.role, challengeId, page); }
  @Get("summary") summary(@CurrentUser() u: JwtUser, @Param("challengeId") challengeId: string) { return this.chat.summaryForChallenge(u.sub, challengeId); }
  @Get("members") members(@CurrentUser() u: JwtUser, @Param("challengeId") challengeId: string, @Query() page: PageDto) { return this.chat.members(u.sub, challengeId, page); }
  @Post("read") read(@CurrentUser() u: JwtUser, @Param("challengeId") challengeId: string, @Body() dto: ReadChallengeChatDto) { return this.chat.markRead(u.sub, challengeId, dto.messageId); }
  @Patch("settings") settings(@CurrentUser() u: JwtUser, @Param("challengeId") challengeId: string, @Body() dto: UpdateChatSettingsDto) { return this.chat.settings(u.sub, challengeId, dto.notificationLevel); }
  @Post("messages") send(@CurrentUser() u: JwtUser, @Param("challengeId") challengeId: string, @Body() dto: CreateChallengeChatMessageDto) { return this.chat.send(u.sub, u.role, challengeId, dto); }
  @Patch("messages/:messageId") update(@CurrentUser() u: JwtUser, @Param("messageId") messageId: string, @Body() dto: UpdateChallengeChatMessageDto) { return this.chat.update(u.sub, u.role, messageId, dto.body); }
  @Delete("messages/:messageId") remove(@CurrentUser() u: JwtUser, @Param("messageId") messageId: string) { return this.chat.remove(u.sub, messageId); }
  @Get("messages/:messageId/revisions") revisions(@CurrentUser() u: JwtUser, @Param("messageId") messageId: string) { return this.chat.revisions(u.sub, messageId); }
  @Post("messages/:messageId/reactions") reaction(@CurrentUser() u: JwtUser, @Param("messageId") messageId: string, @Body() dto: ToggleChatReactionDto) { return this.chat.toggleReaction(u.sub, u.role, messageId, dto.type); }
  @Get("messages/:messageId/reactions") reactionUsers(@CurrentUser() u: JwtUser, @Param("messageId") messageId: string, @Query("type") type: ChatReactionType) { return this.chat.reactionUsers(u.sub, messageId, type); }
  @Patch("messages/:messageId/visibility") visibility(@CurrentUser() u: JwtUser, @Param("messageId") messageId: string, @Body() dto: UpdateContentVisibilityDto) { return this.chat.setHidden(u.sub, u.role, messageId, dto.hidden, dto.reason ?? "대화방 운영 원칙에 따른 조치예요."); }
  @Post("members/:userId/mute") mute(@CurrentUser() u: JwtUser, @Param("challengeId") challengeId: string, @Param("userId") userId: string, @Body() dto: MuteChatMemberDto) { return this.chat.mute(u.sub, u.role, challengeId, userId, dto); }
  @Post("members/:userId/unmute") unmute(@CurrentUser() u: JwtUser, @Param("challengeId") challengeId: string, @Param("userId") userId: string, @Body() dto: ModerateChatMessageDto) { return this.chat.unmute(u.sub, u.role, challengeId, userId, dto.reason); }
}

@UseGuards(JwtAuthGuard)
@Controller("challenge-verifications")
export class ChallengeVerificationController {
  constructor(private readonly service: MungsilService) {}
  @Get("queue") queue(@CurrentUser() u: JwtUser, @Query() query: VerificationQueueDto) { return this.service.verificationQueue(u.sub, query); }
  @Post(":checkInId/vote") vote(@CurrentUser() u: JwtUser, @Param("checkInId") checkInId: string, @Body() dto: VerificationVoteDto) { return this.service.voteChallengeVerification(u.sub, checkInId, dto); }
  @Post("check-ins/:checkInId/resubmit") resubmit(@CurrentUser() u: JwtUser, @Param("checkInId") checkInId: string, @Body() dto: CheckInDto) { return this.service.resubmitChallengeVerification(u.sub, checkInId, dto); }
  @Post("check-ins/:checkInId/reverify") reverify(@CurrentUser() u: JwtUser, @Param("checkInId") checkInId: string) { return this.service.reverifyChallengeVerification(u.sub, checkInId); }
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
  constructor(private readonly chat: DirectChatService) {}
  @Get() conversations(@CurrentUser() u: JwtUser) { return this.chat.conversations(u.sub); }
  @Get("inbox") inbox(@CurrentUser() u: JwtUser) { return this.chat.inbox(u.sub); }
  @Get("unread-count") unreadCount(@CurrentUser() u: JwtUser) { return this.chat.unreadCount(u.sub); }
  @Get("requests") requests(@CurrentUser() u: JwtUser) { return this.chat.requests(u.sub); }
  @Post("requests") request(@CurrentUser() u: JwtUser, @Body() dto: MessageRequestDto) { return this.chat.start(u.sub, dto.receiverId); }
  @Post("requests/:id/accept") accept(@CurrentUser() u: JwtUser, @Param("id") id: string) { return this.chat.accept(u.sub, id); }
  @Delete("requests/:id") reject(@CurrentUser() u: JwtUser, @Param("id") id: string) { return this.chat.reject(u.sub, id); }
  @Get(":id") messages(@CurrentUser() u: JwtUser, @Param("id") id: string, @Query() page: PageDto) { return this.chat.chat(u.sub, id, page); }
  @Post(":id/read") read(@CurrentUser() u: JwtUser, @Param("id") id: string, @Body() dto: ReadChallengeChatDto) { return this.chat.markRead(u.sub, id, dto.messageId); }
  @Post(":id/messages") send(@CurrentUser() u: JwtUser, @Param("id") id: string, @Body() dto: CreateChallengeChatMessageDto) { return this.chat.send(u.sub, id, dto); }
  @Delete(":id/messages/:messageId") remove(@CurrentUser() u: JwtUser, @Param("id") id: string, @Param("messageId") messageId: string) { return this.chat.remove(u.sub, id, messageId); }
  @Post(":id/messages/:messageId/reactions") react(@CurrentUser() u: JwtUser, @Param("id") id: string, @Param("messageId") messageId: string, @Body() dto: ToggleChatReactionDto) { return this.chat.toggleReaction(u.sub, id, messageId, dto.type); }
  @Get(":id/messages/:messageId/reactions") reactionUsers(@CurrentUser() u: JwtUser, @Param("id") id: string, @Param("messageId") messageId: string, @Query("type") type: ChatReactionType) { return this.chat.reactionUsers(u.sub, id, messageId, type); }
}

@UseGuards(JwtAuthGuard)
@Controller("me")
export class MeController {
  constructor(private readonly service: MungsilService, private readonly media: MediaService) {}
  @Get() profile(@CurrentUser() u: JwtUser) { return this.service.profile(u.sub); }
  @Patch() update(@CurrentUser() u: JwtUser, @Body() dto: UpdateProfileDto) { return this.service.updateProfile(u.sub, dto); }
  @Get("todo-categories") todoCategories(@CurrentUser() u: JwtUser, @Query("archived") archived?: string) { return this.service.listTodoCategories(u.sub, archived === "true"); }
  @Post("todo-categories") createTodoCategory(@CurrentUser() u: JwtUser, @Body() dto: CreateTodoCategoryDto) { return this.service.createTodoCategory(u.sub, dto); }
  @Patch("todo-categories/reorder") reorderTodoCategories(@CurrentUser() u: JwtUser, @Body() dto: ReorderTodoCategoriesDto) { return this.service.reorderTodoCategories(u.sub, dto.ids); }
  @Patch("todo-categories/:id") updateTodoCategory(@CurrentUser() u: JwtUser, @Param("id") id: string, @Body() dto: UpdateTodoCategoryDto) { return this.service.updateTodoCategory(u.sub, id, dto); }
  @Get("notifications") notifications(@CurrentUser() u: JwtUser, @Query() page: PageDto) { return this.service.notifications(u.sub, page); }
  @Get("notifications/unread-count") unreadCount(@CurrentUser() u: JwtUser) { return this.service.unreadNotificationCount(u.sub); }
  @Post("notifications/read") read(@CurrentUser() u: JwtUser) { return this.service.readNotifications(u.sub); }
  @Post("media/presign") presign(@CurrentUser() u: JwtUser, @Body() dto: PresignDto) { return this.media.presign(u.sub, dto); }
  @Post("media/complete") completeMedia(@CurrentUser() u: JwtUser, @Body() dto: CompleteMediaDto) { return this.media.complete(u.sub, dto); }
}

@UseGuards(JwtAuthGuard)
@Controller("admin")
export class AdminController {
  constructor(private readonly service: MungsilService, private readonly chat: ChallengeChatService) {}
  private allow(u: JwtUser) { if (!["ADMIN", "MODERATOR"].includes(u.role)) throw new ForbiddenException("운영자 권한이 필요해요."); }
  private allowAdmin(u: JwtUser) { if (u.role !== "ADMIN") throw new ForbiddenException("관리자 권한이 필요해요."); }
  @Get("overview") overview(@CurrentUser() u: JwtUser) { this.allow(u); return this.service.adminOverview(); }
  @Get("invite-codes") inviteCodes(@CurrentUser() u: JwtUser) { this.allowAdmin(u); return this.service.adminInviteCodes(); }
  @Post("invite-codes") createInviteCode(@CurrentUser() u: JwtUser, @Body() dto: CreateInviteCodeDto) { this.allowAdmin(u); return this.service.createInviteCode(u.sub, dto); }
  @Patch("invite-codes/:id") updateInviteCode(@CurrentUser() u: JwtUser, @Param("id") id: string, @Body() dto: UpdateInviteCodeDto) { this.allowAdmin(u); return this.service.updateInviteCode(u.sub, id, dto.disabled); }
  @Get("users") users(@CurrentUser() u: JwtUser, @Query() query: AdminUserQueryDto) { this.allowAdmin(u); return this.service.adminUsers(query); }
  @Patch("users/:id/suspension") suspendUser(@CurrentUser() u: JwtUser, @Param("id") id: string, @Body() dto: UpdateUserSuspensionDto) { this.allowAdmin(u); return this.service.updateUserSuspension(u.sub, id, dto.suspended, dto.reason); }
  @Get("content") content(@CurrentUser() u: JwtUser, @Query() query: AdminContentQueryDto) { this.allow(u); return this.service.adminContent(query); }
  @Patch("content/:type/:id/visibility") contentVisibility(@CurrentUser() u: JwtUser, @Param("type") type: string, @Param("id") id: string, @Body() dto: UpdateContentVisibilityDto) { this.allow(u); return this.service.updateAdminContentVisibility(u.sub, type, id, dto.hidden, dto.reason); }
  @Get("audit-logs") auditLogs(@CurrentUser() u: JwtUser, @Query() page: PageDto) { this.allowAdmin(u); return this.service.adminAuditLogs(page); }
  @Get("reports") reports(@CurrentUser() u: JwtUser) { this.allow(u); return this.service.adminReports(); }
  @Patch("reports/:id") resolve(@CurrentUser() u: JwtUser, @Param("id") id: string, @Body() dto: ResolveReportDto) { this.allow(u); return this.service.resolveReport(u.sub, id, dto.status as "RESOLVED" | "DISMISSED" | "REVIEWING", dto.resolution); }
  @Get("reports/:id/message-context") messageContext(@CurrentUser() u: JwtUser, @Param("id") id: string) { this.allow(u); return this.chat.adminReportedContext(id); }
  @Patch("chat/messages/:messageId/visibility") chatMessageVisibility(@CurrentUser() u: JwtUser, @Param("messageId") messageId: string, @Body() dto: UpdateContentVisibilityDto) { this.allow(u); return this.chat.setHidden(u.sub, u.role, messageId, dto.hidden, dto.reason ?? "운영 정책에 따른 조치예요."); }
  @Get("challenges/:challengeId/participants") challengeParticipants(@CurrentUser() u: JwtUser, @Param("challengeId") challengeId: string) { this.allow(u); return this.service.adminChallengeParticipants(challengeId); }
  @Get("challenge-verifications") challengeVerifications(@CurrentUser() u: JwtUser) { this.allow(u); return this.service.adminChallengeVerificationOverview(); }
  @Patch("challenge-check-ins/:id/visibility") challengeCheckInVisibility(@CurrentUser() u: JwtUser, @Param("id") id: string, @Body() dto: UpdateContentVisibilityDto) { this.allow(u); return this.service.updateChallengeCheckInVisibility(u.sub, id, dto.hidden, dto.reason); }
  @Patch("challenges/:challengeId/participants/:userId/reward") reward(@CurrentUser() u: JwtUser, @Param("challengeId") challengeId: string, @Param("userId") userId: string, @Body() dto: UpdateChallengeRewardDto) { this.allow(u); return this.service.updateChallengeReward(challengeId, userId, dto.status, u.sub); }
}
