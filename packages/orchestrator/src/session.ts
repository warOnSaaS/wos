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

/** Refreshes this long before the access token expires. */
export const SESSION_REFRESH_MARGIN_MS = 60_000;

/** The tokens `refreshSession` returns (Routes.refreshSession.response). */
export interface RefreshedTokens {
  accessToken: string;
  accessExpiresAt: string;
  refreshToken: string;
  refreshExpiresAt: string;
}

/**
 * One refresh at a time per SecretStore, shared by every reader in the process. The control plane rotates refresh
 * tokens and revokes the whole session family when a rotated token is presented again (S-4), so two uncoordinated
 * refreshers (the orchestrator and Desktop's app-shell client, say) would sign the user out.
 */
const inflight = new WeakMap<SecretStore, Promise<string | null>>();

/**
 * The current access token, refreshed a minute before expiry; null when signed out or the refresh token expired.
 * This is the orchestrator's own rule, exported so clients that call routes the `Orchestrator` interface does not
 * cover (AppRoutes: organizations, apps, environment tokens) share the session instead of reading the keychain entry
 * by name. `refresh` calls `refreshSession`; `now` is the clock.
 */
export async function sessionAccessToken(
  secrets: SecretStore,
  refresh: (refreshToken: string) => Promise<RefreshedTokens>,
  now: () => Date = () => new Date(),
): Promise<string | null> {
  const s = await readSession(secrets);
  if (!s) return null;
  const t = now().getTime();
  if (Date.parse(s.accessExpiresAt) - SESSION_REFRESH_MARGIN_MS > t) return s.accessToken;
  if (Date.parse(s.refreshExpiresAt) <= t) return null;
  const running = inflight.get(secrets);
  if (running) return running;
  const p = (async () => {
    // Re-read inside the flight: another reader may have refreshed between our read and now.
    const cur = (await readSession(secrets)) ?? s;
    if (Date.parse(cur.accessExpiresAt) - SESSION_REFRESH_MARGIN_MS > now().getTime()) return cur.accessToken;
    const r = await refresh(cur.refreshToken);
    const next: StoredSession = { ...cur, ...r };
    await writeSession(secrets, next);
    return next.accessToken;
  })();
  inflight.set(secrets, p);
  try {
    return await p;
  } finally {
    if (inflight.get(secrets) === p) inflight.delete(secrets);
  }
}

/**
 * A reader over the orchestrator's session for clients outside the `Orchestrator` interface (Desktop's app shell;
 * the CLI's `wos apps` can switch to it). It never writes a session except through the shared refresh above.
 */
export interface SessionReader {
  /** The stored session (device id and expiries), or null when signed out. Never shown to a renderer. */
  read(): Promise<StoredSession | null>;
  /** A valid access token, refreshed through the shared single flight, or null when signed out. */
  accessToken(): Promise<string | null>;
}

export function createSessionReader(opts: {
  secrets: SecretStore;
  refresh: (refreshToken: string) => Promise<RefreshedTokens>;
  now?: () => Date;
}): SessionReader {
  return {
    read: () => readSession(opts.secrets),
    accessToken: () => sessionAccessToken(opts.secrets, opts.refresh, opts.now),
  };
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
