/** Small crypto helpers for the control plane. No secrets are ever logged or returned from here. */
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/** UUIDv7 (RFC 9562): 48-bit unix milliseconds, version 7, variant 10, random rest. Time ordered. */
export function uuidv7(): string {
  const b = randomBytes(16);
  const ms = BigInt(Date.now());
  for (let i = 0; i < 6; i++) b[i] = Number((ms >> BigInt(8 * (5 - i))) & 0xffn);
  b[6] = (b[6]! & 0x0f) | 0x70;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const h = b.toString("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** 32 random bytes, base64url: link tokens, poll secrets, session tokens, OAuth state. */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

/** Keyed hash (HMAC-SHA256 with SESSION_TOKEN_PEPPER) of a token; only this is ever stored. */
export function tokenHash(pepper: string, value: string): Buffer {
  return createHmac("sha256", pepper).update(value, "utf8").digest();
}

export function sha256Hex(data: string | Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

/** Alphabet of sign-in codes: A-H J-N P-Z 2-9 (32 symbols, so `byte & 31` is unbiased). */
export const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/** An 8-character code formatted XXXX-XXXX (SECURITY.md S-1). */
export function signinCode(): string {
  const b = randomBytes(8);
  let s = "";
  for (let i = 0; i < 8; i++) s += CODE_ALPHABET[b[i]! & 31];
  return `${s.slice(0, 4)}-${s.slice(4)}`;
}

export function constantTimeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a, "utf8");
  const y = Buffer.from(b, "utf8");
  if (x.length !== y.length) {
    timingSafeEqual(x, x);
    return false;
  }
  return timingSafeEqual(x, y);
}

/** The day-salted IP hash used only for rate limiting (IP_HASH_SECRET; the raw IP is never stored). */
export function ipHash(secret: string, ip: string, now: Date): Buffer {
  return createHmac("sha256", secret)
    .update(`${now.toISOString().slice(0, 10)}|${ip}`)
    .digest();
}
