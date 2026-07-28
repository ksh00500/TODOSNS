import { Module } from "@nestjs/common";
import { APP_GUARD, APP_INTERCEPTOR } from "@nestjs/core";
import { ConfigModule } from "@nestjs/config";
import { JwtModule } from "@nestjs/jwt";
import { ThrottlerGuard, ThrottlerModule } from "@nestjs/throttler";
import { ScheduleModule } from "@nestjs/schedule";
import { AuthController, AuthService, JwtAuthGuard, OptionalJwtAuthGuard } from "./auth";
import { AdminController, ChallengeController, FeedController, MeController, MessageController, PublicController, SocialController, TodoController, TodoListController } from "./controllers";
import { ChatGateway } from "./chat.gateway";
import { MediaService } from "./media.service";
import { MungsilService } from "./mungsil.service";
import { PrismaService } from "./prisma.service";
import { validateEnvironment } from "./config";
import { HealthController, HealthService } from "./health";
import { EmailService } from "./email.service";
import { RecurrenceService } from "./recurrence.service";
import { MaintenanceService } from "./maintenance.service";
import { IdempotencyInterceptor } from "./idempotency.interceptor";
import { resolve } from "node:path";

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true, envFilePath: [resolve(process.cwd(), ".env"), resolve(process.cwd(), "../../.env")], validate: validateEnvironment }), JwtModule.register({}), ScheduleModule.forRoot(), ThrottlerModule.forRoot([{ ttl: 60_000, limit: 120 }])],
  controllers: [HealthController, AuthController, PublicController, TodoController, TodoListController, FeedController, ChallengeController, SocialController, MessageController, MeController, AdminController],
  providers: [
    PrismaService,
    JwtAuthGuard,
    OptionalJwtAuthGuard,
    AuthService,
    MungsilService,
    MediaService,
    HealthService,
    EmailService,
    RecurrenceService,
    MaintenanceService,
    ChatGateway,
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_INTERCEPTOR, useClass: IdempotencyInterceptor },
  ],
})
export class AppModule {}
