import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { ConfigModule } from "@nestjs/config";
import { JwtModule } from "@nestjs/jwt";
import { ThrottlerGuard, ThrottlerModule } from "@nestjs/throttler";
import { AuthController, AuthService, JwtAuthGuard } from "./auth";
import { AdminController, ChallengeController, FeedController, MeController, MessageController, PublicController, SocialController, TodoController, TodoListController } from "./controllers";
import { ChatGateway } from "./chat.gateway";
import { MediaService } from "./media.service";
import { MungsilService } from "./mungsil.service";
import { PrismaService } from "./prisma.service";

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true }), JwtModule.register({}), ThrottlerModule.forRoot([{ ttl: 60_000, limit: 120 }])],
  controllers: [AuthController, PublicController, TodoController, TodoListController, FeedController, ChallengeController, SocialController, MessageController, MeController, AdminController],
  providers: [
    PrismaService,
    JwtAuthGuard,
    AuthService,
    MungsilService,
    MediaService,
    ChatGateway,
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule {}
