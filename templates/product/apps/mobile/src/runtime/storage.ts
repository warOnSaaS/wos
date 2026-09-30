/**
 * What wOS Mobile keeps on the phone. Session material goes ONLY to the platform's secure storage (iOS Keychain,
 * Android Keystore-backed storage) through `expo-secure-store`; the runtime sees it through this interface so tests
 * use a memory store. Nothing is written to plain files or AsyncStorage (SECURITY S-4's rule for Desktop and CLI,
 * applied to Mobile).
 *
 * Keys: `wos.environments` (the chosen environments and which one is selected, no secrets) and
 * `wos.session.<environmentId>` (one environment's session). Sessions are per environment: signing in to one never
 * signs in to another (WOS-APP-PROTOCOL section 8).
 */
import { z } from "zod";
import { EnvironmentDescriptor, OrgRole } from "../contracts.js";

export interface SecureStore {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  deleteItem(key: string): Promise<void>;
}

export class MemorySecureStore implements SecureStore {
  readonly items = new Map<string, string>();
  async getItem(key: string) {
    return this.items.get(key) ?? null;
  }
  async setItem(key: string, value: string) {
    this.items.set(key, value);
  }
  async deleteItem(key: string) {
    this.items.delete(key);
  }
}

const Iso = z.string().min(10);

/** A self-hosted Core's own session (CoreRoutes.localSignInRedeem). */
export const LocalSession = z.object({
  kind: z.literal("local"),
  token: z.string().min(20),
  expiresAt: Iso,
  userId: z.string(),
  organizationId: z.string(),
  role: OrgRole,
});
export type LocalSession = z.infer<typeof LocalSession>;

/**
 * A wOS account session with the control plane (Routes.redeemEmailSignIn / refreshSession), from which environment
 * tokens are minted. The environment token itself is kept in memory only: it lives 15 minutes and is re-minted.
 */
export const CloudSession = z.object({
  kind: z.literal("wos_cloud"),
  issuer: z.string(),
  accessToken: z.string().min(1),
  accessExpiresAt: Iso,
  refreshToken: z.string().min(1),
  refreshExpiresAt: Iso,
  /** The organization whose apps this phone shows (the personal one until the user picks another). */
  organizationId: z.string().nullable(),
});
export type CloudSession = z.infer<typeof CloudSession>;

export const StoredSession = z.discriminatedUnion("kind", [LocalSession, CloudSession]);
export type StoredSession = z.infer<typeof StoredSession>;

export const StoredEnvironments = z.object({
  selected: z.string().nullable(),
  environments: z.array(z.object({ url: z.string(), descriptor: EnvironmentDescriptor })),
});
export type StoredEnvironments = z.infer<typeof StoredEnvironments>;

export const ENVIRONMENTS_KEY = "wos.environments";
export const sessionKey = (environmentId: string) => `wos.session.${environmentId}`;

async function readJson<T>(store: SecureStore, key: string, schema: z.ZodType<T>): Promise<T | null> {
  const raw = await store.getItem(key);
  if (raw === null) return null;
  try {
    const r = schema.safeParse(JSON.parse(raw));
    return r.success ? r.data : null;
  } catch {
    return null;
  }
}

export async function loadEnvironments(store: SecureStore): Promise<StoredEnvironments> {
  return (await readJson(store, ENVIRONMENTS_KEY, StoredEnvironments)) ?? { selected: null, environments: [] };
}
export async function saveEnvironments(store: SecureStore, value: StoredEnvironments): Promise<void> {
  await store.setItem(ENVIRONMENTS_KEY, JSON.stringify(value));
}

export async function loadSession(store: SecureStore, environmentId: string): Promise<StoredSession | null> {
  return readJson(store, sessionKey(environmentId), StoredSession);
}
export async function saveSession(store: SecureStore, environmentId: string, session: StoredSession): Promise<void> {
  await store.setItem(sessionKey(environmentId), JSON.stringify(session));
}
export async function clearSession(store: SecureStore, environmentId: string): Promise<void> {
  await store.deleteItem(sessionKey(environmentId));
}
