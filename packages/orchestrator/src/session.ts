/** Session and device key, both kept only in the injected SecretStore (OS keychain in real clients). */
import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, sign } from "node:crypto";
import { canonicalJson } from "@waronsaas/github";
import type { SecretStore } from "./index.js";

export const SESSION_KEY = "wos.session.v1";
export const DEVICE_KEY = "wos.device-key.v1";

export interface StoredSession {
  accessToken: string;
  accessExpiresAt: string;
  refreshToken: string;
  refreshExpiresAt: string;
  deviceId: string;
}

export async function readSession(secrets: SecretStore): Promise<StoredSession | null> {
  const raw = await secrets.get(SESSION_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as StoredSession;
  } catch {
    return null;
  }
}

export async function writeSession(secrets: SecretStore, s: StoredSession): Promise<void> {
  await secrets.set(SESSION_KEY, JSON.stringify(s));
}

/** Ed25519 device key: created on first use; the public key (raw 32 bytes, base64) is registered at sign-in. */
export async function deviceKey(secrets: SecretStore): Promise<{ privateKeyPem: string; publicKeyBase64: string }> {
  let pem = await secrets.get(DEVICE_KEY);
  if (!pem) {
    pem = generateKeyPairSync("ed25519").privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    await secrets.set(DEVICE_KEY, pem);
  }
  const jwk = createPublicKey(createPrivateKey(pem)).export({ format: "jwk" }) as { x: string };
  return { privateKeyPem: pem, publicKeyBase64: Buffer.from(jwk.x, "base64url").toString("base64") };
}

/** Ed25519 signature (base64) over the RFC 8785 canonical JSON of `value`. */
export function signCanonical(privateKeyPem: string, value: unknown): string {
  return sign(null, Buffer.from(canonicalJson(value), "utf8"), createPrivateKey(privateKeyPem)).toString("base64");
}

/** Deterministic idempotency key (UUID layout, version 8) so a retried request replays instead of duplicating. */
export function idempotencyKey(...parts: string[]): string {
  const h = createHash("sha256").update(parts.join("\u0000")).digest("hex");
  const variant = ((Number.parseInt(h[16]!, 16) & 0x3) | 0x8).toString(16);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-8${h.slice(13, 16)}-${variant}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}
