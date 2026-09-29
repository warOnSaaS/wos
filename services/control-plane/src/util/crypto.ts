/** Small crypto helpers for the control plane. No secrets are ever logged or returned from here. */
import { createHash, createHmac, createPublicKey, randomBytes, timingSafeEqual, verify } from "node:crypto";

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

export function sha256Prefixed(data: string | Uint8Array): string {
  return `sha256:${sha256Hex(data)}`;
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

const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

/** Verifies an Ed25519 signature (base64) with a device public key (raw 32 bytes or SPKI DER, base64). */
export function verifyEd25519(publicKeyB64: string, message: Uint8Array, signatureB64: string): boolean {
  try {
    const raw = Buffer.from(publicKeyB64, "base64");
    const der = raw.length === 32 ? Buffer.concat([ED25519_SPKI_PREFIX, raw]) : raw;
    const key = createPublicKey({ key: der, format: "der", type: "spki" });
    return verify(null, message, key, Buffer.from(signatureB64, "base64"));
  } catch {
    return false;
  }
}

/**
 * RFC 8785 (JCS) canonical JSON: object keys sorted by UTF-16 code units, ECMAScript number and string
 * serialisation, no whitespace, `undefined` members dropped. Used for signatures and server documents.
 */
export function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  switch (typeof value) {
    case "boolean":
      return value ? "true" : "false";
    case "number":
      if (!Number.isFinite(value)) throw new TypeError("canonicalJson: non-finite number");
      return JSON.stringify(value);
    case "string":
      return JSON.stringify(value);
    case "object": {
      if (Array.isArray(value)) return `[${value.map((v) => (v === undefined ? "null" : canonicalJson(v))).join(",")}]`;
      const obj = value as Record<string, unknown>;
      const keys = Object.keys(obj)
        .filter((k) => obj[k] !== undefined)
        .sort();
      return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(",")}}`;
    }
    default:
      throw new TypeError(`canonicalJson: unsupported ${typeof value}`);
  }
}

/** The day-salted IP hash used only for rate limiting (IP_HASH_SECRET; the raw IP is never stored). */
export function ipHash(secret: string, ip: string, now: Date): Buffer {
  return createHmac("sha256", secret)
    .update(`${now.toISOString().slice(0, 10)}|${ip}`)
    .digest();
}
