/**
 * Delivery of local sign-in codes. Only the `log` transport is built: it writes the code to Core's standard output
 * for the operator (evaluation installs). SMTP delivery is not built yet (blockers/B-0001-suite-shell.md).
 */
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

/** Captures codes in memory: tests. */
export class MemoryMailer implements Mailer {
  readonly sent: SigninMail[] = [];
  async sendSigninCode(m: SigninMail) {
    this.sent.push(m);
  }
}
