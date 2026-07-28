import { Injectable, Logger } from "@nestjs/common";
import nodemailer from "nodemailer";

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private readonly from = process.env.SMTP_FROM ?? "hello@mungsil.local";
  private readonly transport = process.env.SMTP_HOST
    ? nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: Number(process.env.SMTP_PORT ?? 1025),
        secure: process.env.SMTP_SECURE === "true",
        auth: process.env.SMTP_USER
          ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD }
          : undefined,
      })
    : null;

  async sendVerification(email: string, token: string) {
    const url = `${this.siteOrigin()}/verify-email?token=${encodeURIComponent(token)}`;
    await this.send(
      email,
      "[뭉실] 이메일을 인증해주세요",
      `뭉실 가입을 마치려면 아래 링크를 열어주세요.\n\n${url}\n\n이 링크는 24시간 동안 유효합니다.`,
      url,
    );
  }

  async sendPasswordReset(email: string, token: string) {
    const url = `${this.siteOrigin()}/reset-password?token=${encodeURIComponent(token)}`;
    await this.send(
      email,
      "[뭉실] 비밀번호를 다시 설정해주세요",
      `아래 링크에서 새 비밀번호를 설정할 수 있어요.\n\n${url}\n\n이 링크는 1시간 동안 유효합니다.`,
      url,
    );
  }

  private siteOrigin() {
    return process.env.NEXT_PUBLIC_SITE_URL ?? process.env.SITE_ORIGIN ?? "http://localhost:3000";
  }

  private async send(to: string, subject: string, text: string, developmentUrl: string) {
    if (!this.transport) {
      if (process.env.NODE_ENV === "production") throw new Error("SMTP is not configured");
      this.logger.log(`Development email for ${to}: ${developmentUrl}`);
      return;
    }
    await this.transport.sendMail({ from: this.from, to, subject, text });
  }
}
