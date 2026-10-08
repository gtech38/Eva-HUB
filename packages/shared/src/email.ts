import nodemailer from "nodemailer";
import { env } from "./env.ts";

export type EmailMessage = { to: string; subject: string; text: string; html?: string };

export interface EmailSender {
  send(msg: EmailMessage): Promise<{ providerId: string }>;
}

class SmtpSender implements EmailSender {
  private transport = nodemailer.createTransport({ host: env().SMTP_HOST, port: env().SMTP_PORT, secure: false });
  async send(msg: EmailMessage) {
    const info = await this.transport.sendMail({ from: env().EMAIL_FROM, ...msg });
    return { providerId: info.messageId };
  }
}

class ConsoleSender implements EmailSender {
  async send(msg: EmailMessage) {
    console.log(`\n✉️  [email → ${msg.to}] ${msg.subject}\n${msg.text}\n`);
    return { providerId: `console-${Date.now()}` };
  }
}

let sender: EmailSender | undefined;
export function email(): EmailSender {
  return (sender ??= env().EMAIL_PROVIDER === "smtp" ? new SmtpSender() : new ConsoleSender());
}
