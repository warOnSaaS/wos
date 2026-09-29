/**
 * Session and device key, both kept only in the injected SecretStore (OS keychain in real clients).
 * All hashing and signing goes through @waronsaas/contracts/canonical (contracts 2.0.0, C-1..C-7).
 */
import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, type KeyObject } from "node:crypto";
import type { AgentRunRecord, Changeset } from "@waronsaas/contracts";
import {
  agentRunSigningPayload,
  encodeDevicePublicKey,
  signChangeset,
  signEd25519,
  type UnsignedAgentRun,
  type UnsignedChangeset,
} from "@waronsaas/contracts/canonical";
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

/** Ed25519 device key (PKCS#8 PEM in the keychain), created on first use. Public key in the C-5 wire format. */
export async function deviceKey(secrets: SecretStore): Promise<{ privateKey: KeyObject; publicKeyBase64: string }> {
  let pem = await secrets.get(DEVICE_KEY);
  if (!pem) {
    pem = generateKeyPairSync("ed25519").privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    await secrets.set(DEVICE_KEY, pem);
  }
  const privateKey = createPrivateKey(pem);
  return { privateKey, publicKeyBase64: encodeDevicePublicKey(createPublicKey(privateKey)) };
}

/** Signs a changeset with this device's key (C-4). */
export async function signChangesetWithDevice(secrets: SecretStore, unsigned: UnsignedChangeset): Promise<Changeset> {
  return signChangeset(unsigned, (await deviceKey(secrets)).privateKey);
}

/** Signs an agent-run record with this device's key (C-4). */
export async function signAgentRunWithDevice(secrets: SecretStore, unsigned: UnsignedAgentRun): Promise<AgentRunRecord> {
  const { privateKey } = await deviceKey(secrets);
  return { ...(unsigned as AgentRunRecord), signature: signEd25519(privateKey, agentRunSigningPayload(unsigned)) };
}

/** Deterministic idempotency key (UUID layout, version 8) so a retried request replays instead of duplicating. */
export function idempotencyKey(...parts: string[]): string {
  const h = createHash("sha256").update(parts.join("\u0000")).digest("hex");
  const variant = ((Number.parseInt(h[16]!, 16) & 0x3) | 0x8).toString(16);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-8${h.slice(13, 16)}-${variant}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}
