/**
 * Delivery of local sign-in codes on a self-hosted Core (CoreRoutes.localSignInStart, contracts 5.6.0).
 *
 * - SMTP (B-0003-suite-shell, nodemailer): set WOS_SMTP_URL (smtp://user:pass@host:587 or smtps://…:465) and
 *   WOS_SMTP_FROM ("wOS <signin@your-company.com>"). The code goes to the address only; nothing is logged.
 * - Log (the fallback when WOS_SMTP_URL is unset): writes the code to Core's standard output for the operator, which
 *   suits an evaluation install where only the operator signs in.
 */
import nodemailer from "nodemailer";

export type SigninMail = { to: string; code: string; requestId: string; expiresAt: Date; environmentName: string };
export interface Mailer {
  sendSigninCode(mail: SigninMail): Promise<void>;
}

export class LogMailer implements Mailer {
  constructor(private readonly write: (line: string) => void = (l) => process.stdout.write(`${l}\n`)) {}
  async sendSigninCode(m: SigninMail) {
    this.write(
      `[wOS Core] sign-in code for ${m.to} on ${m.environmentName}: ${m.code} (request ${m.requestId}, expires ${m.expiresAt.toISOString()})`,
    );
  }
}

/** The part of a nodemailer transporter this mailer uses (tests pass a fake). */
export interface MailTransport {
  sendMail(message: { from: string; to: string; subject: string; text: string }): Promise<unknown>;
}

/** The message a sign-in code is sent as: plain text, no link (local sign-in is code only). */
export function signinMessage(from: string, m: SigninMail) {
  return {
    from,
    to: m.to,
    subject: `Your ${m.environmentName} sign-in code: ${m.code}`,
    text: [
      `Sign in to ${m.environmentName} (wOS)`,
      "",
      `Your code: ${m.code}`,
      "",
      `It works once and expires at ${m.expiresAt.toISOString()}. If you did not ask to sign in, ignore this email.`,
    ].join("\n"),
  };
}

export class SmtpMailer implements Mailer {
  constructor(
    private readonly transport: MailTransport,
    private readonly from: string,
  ) {}
  async sendSigninCode(m: SigninMail) {
    await this.transport.sendMail(signinMessage(this.from, m));
  }
}

/** Captures codes in memory: tests. */
export class MemoryMailer implements Mailer {
  readonly sent: SigninMail[] = [];
  async sendSigninCode(m: SigninMail) {
    this.sent.push(m);
  }
}

type Env = Readonly<Record<string, string | undefined>>;

/**
 * SMTP when WOS_SMTP_URL is set (WOS_SMTP_FROM required with it), else the log fallback. `createTransport` is
 * nodemailer's unless a test passes another. `log` receives one line saying which transport is in use (no secrets).
 */
export function mailerFromEnv(
  env: Env,
  opts: { createTransport?: (url: string) => MailTransport; log?: (msg: string, fields?: Record<string, unknown>) => void } = {},
): Mailer {
  const url = env.WOS_SMTP_URL?.trim();
  if (!url) {
    opts.log?.("WOS_SMTP_URL is not set: sign-in codes are written to this log (evaluation installs only)");
    return new LogMailer();
  }
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("WOS_SMTP_URL is not a URL (smtp://user:pass@host:587 or smtps://user:pass@host:465)");
  }
  if (parsed.protocol !== "smtp:" && parsed.protocol !== "smtps:") throw new Error("WOS_SMTP_URL must start with smtp:// or smtps://");
  const from = env.WOS_SMTP_FROM?.trim();
  if (!from) throw new Error("WOS_SMTP_FROM is required with WOS_SMTP_URL (for example: wOS <signin@your-company.com>)");
  opts.log?.("sign-in codes are sent by SMTP", { host: parsed.hostname, port: parsed.port || null, secure: parsed.protocol === "smtps:" });
  const transport = (opts.createTransport ?? ((u: string) => nodemailer.createTransport(u)))(url);
  return new SmtpMailer(transport, from);
}
