import "reflect-metadata";
import * as cookieParser from "cookie-parser";
import helmet from "helmet";
import { ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { randomUUID } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { AppModule } from "./app.module";

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { cors: false });
  app.setGlobalPrefix("api/v1");
  app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));
  app.use(cookieParser());
  app.use((request: Request, response: Response, next: NextFunction) => {
    const requestId = String(request.headers["x-request-id"] ?? randomUUID());
    const startedAt = Date.now();
    response.setHeader("x-request-id", requestId);
    response.on("finish", () => {
      process.stdout.write(`${JSON.stringify({
        level: response.statusCode >= 500 ? "error" : "info",
        message: "request.completed",
        requestId,
        method: request.method,
        path: request.originalUrl,
        statusCode: response.statusCode,
        durationMs: Date.now() - startedAt,
      })}\n`);
    });
    next();
  });
  app.enableCors({
    origin: (process.env.WEB_ORIGIN ?? "http://localhost:3000").split(","),
    credentials: true,
  });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }));
  const document = SwaggerModule.createDocument(app, new DocumentBuilder().setTitle("뭉실 API").setVersion("1.0").addBearerAuth().build());
  SwaggerModule.setup("api/docs", app, document);
  await app.listen(Number(process.env.PORT ?? 4000), "0.0.0.0");
}

void bootstrap();
