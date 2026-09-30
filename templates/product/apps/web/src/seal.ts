/** Sealed cookies: AES-256-GCM over JSON, keyed by WOS_WEB_SESSION_SECRET. The browser never reads a token. */
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export class Sealer {
  private readonly key: Buffer;
  constructor(private readonly secret: string) {
    if (secret.length < 32) throw new Error("WOS_WEB_SESSION_SECRET must be at least 32 characters");
    this.key = createHash("sha256").update(`wos-web-seal\0${secret}`).digest();
  }
  seal(value: unknown): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    const body = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64url");
  }
  open<T>(sealed: string | undefined): T | null {
    if (!sealed) return null;
    try {
      const raw = Buffer.from(sealed, "base64url");
      const decipher = createDecipheriv("aes-256-gcm", this.key, raw.subarray(0, 12));
      decipher.setAuthTag(raw.subarray(12, 28));
      return JSON.parse(Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString("utf8")) as T;
    } catch {
      return null;
    }
  }
  /** CSRF token bound to one session id. */
  csrf(sid: string): string {
    return createHmac("sha256", this.secret).update(`csrf\0${sid}`).digest("base64url");
  }
  csrfOk(sid: string, token: string | undefined): boolean {
    const want = Buffer.from(this.csrf(sid));
    const got = Buffer.from(token ?? "");
    return want.length === got.length && timingSafeEqual(want, got);
  }
}
