/**
 * Environment-token verification on hosted wOS Core (WOS-APP-PROTOCOL section 8, C-8). The only implementation is
 * `verifyEnvironmentToken` from the contracts; this file supplies it the control plane's published keys
 * (`GET /v1/public/environment-keys`, current and next), cached, and refetched at most every 30 s when a token
 * names a kid the cache does not know (rotation). Used only in cloud mode: a self-hosted Core never fetches
 * anything from wOS Cloud (S-41).
 */
import { AppRoutes, EnvironmentKey, type EnvironmentTokenClaims, verifyEnvironmentToken } from "../../core-contracts/src/index.js";
import { z } from "zod";

const KeysResponse = z.object({ keys: z.array(EnvironmentKey) });
export const KEYS_CACHE_SECONDS = 300;
export const KEYS_MIN_REFETCH_SECONDS = 30;

export type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

export class EnvironmentKeyCache {
  private keys: Record<string, string> = {};
  private fetchedAt = Number.NEGATIVE_INFINITY;
  private inflight: Promise<void> | null = null;

  constructor(
    private readonly controlPlaneUrl: string,
    private readonly fetchFn: Fetch,
    private readonly nowSeconds: () => number,
  ) {}

  private async refresh(): Promise<void> {
    this.inflight ??= (async () => {
      try {
        const res = await this.fetchFn(new URL(AppRoutes.getEnvironmentKeys.path, this.controlPlaneUrl).toString(), {
          headers: { accept: "application/json" },
        });
        if (!res.ok) throw new Error(`environment keys: HTTP ${res.status}`);
        const body = KeysResponse.parse(await res.json());
        this.keys = Object.fromEntries(body.keys.map((k) => [k.kid, k.publicKey]));
        this.fetchedAt = this.nowSeconds();
      } finally {
        this.inflight = null;
      }
    })();
    return this.inflight;
  }

  /** Keys, fresh within KEYS_CACHE_SECONDS; `wantKid` forces a refetch (rate-limited) when unknown. */
  async get(wantKid: string | null): Promise<Record<string, string>> {
    const age = this.nowSeconds() - this.fetchedAt;
    if (age > KEYS_CACHE_SECONDS || (wantKid !== null && !(wantKid in this.keys) && age > KEYS_MIN_REFETCH_SECONDS)) {
      await this.refresh();
    }
    return this.keys;
  }
}

function kidOf(token: string): string | null {
  try {
    const header = JSON.parse(Buffer.from(token.split(".")[0] ?? "", "base64url").toString("utf8")) as { kid?: unknown };
    return typeof header.kid === "string" ? header.kid : null;
  } catch {
    return null;
  }
}

export type TokenCheck = { ok: true; claims: EnvironmentTokenClaims } | { ok: false; reason: string };

export async function checkEnvironmentToken(
  token: string,
  cache: EnvironmentKeyCache,
  environmentId: string,
  nowSeconds: number,
): Promise<TokenCheck> {
  let keys: Record<string, string>;
  try {
    keys = await cache.get(kidOf(token));
  } catch (err) {
    return { ok: false, reason: `environment keys unavailable: ${err instanceof Error ? err.message : String(err)}` };
  }
  return verifyEnvironmentToken(token, keys, { environmentId, nowSeconds });
}
