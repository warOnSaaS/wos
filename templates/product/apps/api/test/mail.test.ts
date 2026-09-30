/**
 * B-0003-suite-shell item 4: self-hosted sign-in codes by SMTP (nodemailer) when WOS_SMTP_URL is set, the log
 * otherwise. No network: a fake transport, and nodemailer's own stream transport to render the real message.
 */
import nodemailer from "nodemailer";
import { describe, expect, it } from "vitest";
import { CoreRoutes } from "../../../modules/core-contracts/src/index.js";
import { LogMailer, type MailTransport, mailerFromEnv, SmtpMailer, signinMessage } from "../src/mail.js";
import { post, selfHostedCore } from "./support.js";

const MAIL = {
  to: "owner@example.test",
  code: "ABCD-EFGH",
  requestId: "0192f000-0000-7000-8000-000000000001",
  expiresAt: new Date("2026-10-01T12:15:00Z"),
  environmentName: "Acme wOS",
};

class FakeTransport implements MailTransport {
  readonly sent: Parameters<MailTransport["sendMail"]>[0][] = [];
  async sendMail(m: Parameters<MailTransport["sendMail"]>[0]) {
    this.sent.push(m);
    return { messageId: `<${this.sent.length}@fake>` };
  }
}

describe("suite-shell Core: sign-in code delivery", () => {
  it("without WOS_SMTP_URL: the log transport, and it says so", () => {
    const lines: string[] = [];
    const m = mailerFromEnv({}, { log: (l) => lines.push(l) });
    expect(m).toBeInstanceOf(LogMailer);
    expect(lines).toEqual(["WOS_SMTP_URL is not set: sign-in codes are written to this log (evaluation installs only)"]);
  });

  it("with WOS_SMTP_URL and WOS_SMTP_FROM: SMTP through the transport for that URL; the log line has no credentials", async () => {
    const lines: string[] = [];
    const urls: string[] = [];
    const fake = new FakeTransport();
    const m = mailerFromEnv(
      { WOS_SMTP_URL: "smtps://user:s3cret@smtp.example.test:465", WOS_SMTP_FROM: "wOS <signin@example.test>" },
      {
        createTransport: (u) => {
          urls.push(u);
          return fake;
        },
        log: (msg, fields) => lines.push(`${msg} ${JSON.stringify(fields)}`),
      },
    );
    expect(m).toBeInstanceOf(SmtpMailer);
    expect(urls).toEqual(["smtps://user:s3cret@smtp.example.test:465"]);
    expect(lines.join("\n")).not.toContain("s3cret");
    expect(lines.join("\n")).not.toContain("user");
    await m.sendSigninCode(MAIL);
    expect(fake.sent).toEqual([signinMessage("wOS <signin@example.test>", MAIL)]);
    expect(fake.sent[0]!.to).toBe("owner@example.test");
    expect(fake.sent[0]!.text).toContain("Your code: ABCD-EFGH");
  });

  it("refuses a half or wrong SMTP configuration at boot", () => {
    expect(() => mailerFromEnv({ WOS_SMTP_URL: "smtp://smtp.example.test:587" })).toThrow(/WOS_SMTP_FROM is required/);
    expect(() => mailerFromEnv({ WOS_SMTP_URL: "https://smtp.example.test", WOS_SMTP_FROM: "a@b.test" })).toThrow(/smtp:\/\//);
    expect(() => mailerFromEnv({ WOS_SMTP_URL: "not a url", WOS_SMTP_FROM: "a@b.test" })).toThrow(/not a URL/);
  });

  it("nodemailer renders the real message (stream transport, nothing sent)", async () => {
    const transport = nodemailer.createTransport({ streamTransport: true, buffer: true, newline: "unix" });
    const info = (await transport.sendMail(signinMessage("wOS <signin@example.test>", MAIL))) as { message: Buffer };
    const raw = info.message.toString("utf8");
    expect(raw).toMatch(/^From: wOS <signin@example.test>$/m);
    expect(raw).toMatch(/^To: owner@example.test$/m);
    expect(raw).toMatch(/^Subject: Your Acme wOS sign-in code: ABCD-EFGH$/m);
    expect(raw).toContain("Your code: ABCD-EFGH");
  });

  it("a Core wired with SMTP mails the code and writes nothing with it to its log", async () => {
    const fake = new FakeTransport();
    const lines: string[] = [];
    const { app } = selfHostedCore({
      mailer: new SmtpMailer(fake, "wOS <signin@example.test>"),
      log: (msg, fields) => lines.push(`${msg} ${JSON.stringify(fields ?? {})}`),
    });
    const res = await app.request(CoreRoutes.localSignInStart.path, post({ email: "owner@example.test" }));
    expect(res.status).toBe(202);
    const { requestId } = CoreRoutes.localSignInStart.response.parse(await res.json());
    expect(fake.sent).toHaveLength(1);
    const code = /Your code: ([A-Z0-9]{4}-[A-Z0-9]{4})/.exec(fake.sent[0]!.text)![1]!;
    expect(lines.join("\n")).not.toContain(code);
    const redeemed = await app.request(CoreRoutes.localSignInRedeem.path, post({ requestId, code }));
    expect(redeemed.status).toBe(200);
  });
});
