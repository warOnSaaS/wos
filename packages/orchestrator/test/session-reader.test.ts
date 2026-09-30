/**
 * The exported session reader (Wave 3a, desktop brief): clients outside the `Orchestrator` interface (Desktop's app
 * shell, later the CLI's `wos apps`) read the same keychain session through one rule, and the refresh is a single
 * flight per SecretStore, because the control plane revokes the whole session family when a rotated refresh token is
 * presented twice (S-4).
 */
import { describe, expect, it } from "vitest";
import { createSessionReader, type RefreshedTokens, SESSION_KEY, sessionAccessToken } from "../src/index.js";
import { MemorySecrets } from "./support/harness.js";

const NOW = new Date("2026-09-30T12:00:00Z");
const session = (over: Record<string, string> = {}) =>
  JSON.stringify({
    accessToken: "a-1",
    accessExpiresAt: "2026-09-30T13:00:00Z",
    refreshToken: "r-1",
    refreshExpiresAt: "2026-10-30T12:00:00Z",
    deviceId: "0192ab3c-0000-7000-8000-00000000dddd",
    ...over,
  });

function refresher() {
  const seen: string[] = [];
  let n = 1;
  const refresh = async (refreshToken: string): Promise<RefreshedTokens> => {
    seen.push(refreshToken);
    await new Promise((r) => setTimeout(r, 5));
    n += 1;
    return {
      accessToken: `a-${n}`,
      accessExpiresAt: "2026-09-30T13:00:00Z",
      refreshToken: `r-${n}`,
      refreshExpiresAt: "2026-10-30T12:00:00Z",
    };
  };
  return { seen, refresh };
}

describe("session reader", () => {
  it("the key is the orchestrator's", () => {
    expect(SESSION_KEY).toBe("wos.session.v1");
  });

  it("returns a fresh access token without refreshing; null when signed out", async () => {
    const secrets = new MemorySecrets();
    const { seen, refresh } = refresher();
    const reader = createSessionReader({ secrets, refresh, now: () => NOW });
    expect(await reader.accessToken()).toBeNull();
    secrets.map.set(SESSION_KEY, session());
    expect(await reader.accessToken()).toBe("a-1");
    expect((await reader.read())?.deviceId).toBe("0192ab3c-0000-7000-8000-00000000dddd");
    expect(seen).toEqual([]);
  });

  it("refreshes a minute before expiry and stores the rotated tokens", async () => {
    const secrets = new MemorySecrets();
    secrets.map.set(SESSION_KEY, session({ accessExpiresAt: "2026-09-30T12:00:30Z" }));
    const { seen, refresh } = refresher();
    expect(await sessionAccessToken(secrets, refresh, () => NOW)).toBe("a-2");
    expect(seen).toEqual(["r-1"]);
    expect(JSON.parse(secrets.map.get(SESSION_KEY)!)).toMatchObject({ accessToken: "a-2", refreshToken: "r-2" });
  });

  it("an expired refresh token is signed out, with no call", async () => {
    const secrets = new MemorySecrets();
    secrets.map.set(SESSION_KEY, session({ accessExpiresAt: "2026-09-30T11:00:00Z", refreshExpiresAt: "2026-09-30T11:30:00Z" }));
    const { seen, refresh } = refresher();
    expect(await sessionAccessToken(secrets, refresh, () => NOW)).toBeNull();
    expect(seen).toEqual([]);
  });

  it("concurrent readers of one store share ONE refresh (a reused rotated token would revoke the family)", async () => {
    const secrets = new MemorySecrets();
    secrets.map.set(SESSION_KEY, session({ accessExpiresAt: "2026-09-30T11:00:00Z" }));
    const { seen, refresh } = refresher();
    const a = createSessionReader({ secrets, refresh, now: () => NOW });
    const b = createSessionReader({ secrets, refresh, now: () => NOW });
    const tokens = await Promise.all([a.accessToken(), b.accessToken(), sessionAccessToken(secrets, refresh, () => NOW)]);
    expect(tokens).toEqual(["a-2", "a-2", "a-2"]);
    expect(seen).toEqual(["r-1"]);
  });
});
