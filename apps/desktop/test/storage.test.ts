/** S-4: the session lives only in the OS keychain (safeStorage), never as a plain file; plus the public-route client. */
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createPublicApi, PublicApiError } from "../src/main/public-api.js";
import { type SafeStorageLike, SafeStorageSecrets } from "../src/main/secrets.js";
import { defaultSettings, fileSettingsStore } from "../src/main/settings.js";

const dirs: string[] = [];
const tmp = () => {
  const d = mkdtempSync(join(tmpdir(), "wos-desktop-secrets-"));
  dirs.push(d);
  return d;
};
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

/** A stand-in for the OS: XOR "encryption" is enough to prove no plaintext reaches disk. */
const fakeSafe = (backend = "keychain", available = true): SafeStorageLike => ({
  isEncryptionAvailable: () => available,
  getSelectedStorageBackend: () => backend,
  encryptString: (s) => Buffer.from(Buffer.from(s, "utf8").map((b) => b ^ 0x5a)),
  decryptString: (b) => Buffer.from(b.map((x) => x ^ 0x5a)).toString("utf8"),
});

describe("SafeStorageSecrets", () => {
  it("round-trips and writes only encrypted bytes", async () => {
    const dir = tmp();
    const s = new SafeStorageSecrets(fakeSafe(), dir);
    const session = JSON.stringify({ accessToken: "secret-access-token", refreshToken: "secret-refresh-token" });
    await s.set("wos.session.v1", session);
    expect(await s.get("wos.session.v1")).toBe(session);
    for (const f of readdirSync(dir)) {
      const raw = readFileSync(join(dir, f));
      expect(raw.toString("utf8")).not.toContain("secret-access-token");
      expect(raw.toString("latin1")).not.toContain("secret-refresh-token");
    }
    await s.delete("wos.session.v1");
    expect(await s.get("wos.session.v1")).toBeNull();
  });

  it("refuses to store when the OS offers no keychain (Linux basic_text), instead of writing plaintext", async () => {
    const dir = tmp();
    await expect(new SafeStorageSecrets(fakeSafe("basic_text"), dir).set("wos.session.v1", "x")).rejects.toThrow(/KEYCHAIN_UNAVAILABLE/);
    await expect(new SafeStorageSecrets(fakeSafe("keychain", false), dir).set("wos.session.v1", "x")).rejects.toThrow(
      /KEYCHAIN_UNAVAILABLE/,
    );
    expect(readdirSync(dir)).toEqual([]);
  });

  it("refuses path-like keys", async () => {
    await expect(new SafeStorageSecrets(fakeSafe(), tmp()).set("../evil", "x")).rejects.toThrow(/invalid secret key/);
  });
});

describe("local settings file", () => {
  it("holds no secrets and survives a corrupt file", () => {
    const dir = tmp();
    const path = join(dir, "settings.json");
    const s = fileSettingsStore(path, defaultSettings("dev"));
    s.set({ preferredModel: "sol" });
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({
      deviceName: "dev",
      detachAfterSubmit: true,
      preferredModel: "sol",
      eventsPollSeconds: 5,
    });
    rmSync(path);
    expect(fileSettingsStore(path, defaultSettings("dev")).get()).toEqual(defaultSettings("dev"));
  });
});

describe("public routes", () => {
  const ok =
    (body: unknown, status = 200) =>
    async () =>
      new Response(JSON.stringify(body), { status });
  it("parses responses with the route's own schema", async () => {
    const api = createPublicApi(ok({ items: [] }) as typeof fetch, "https://api.waronsaas.test", "t");
    expect(await api.get("listTargets")).toEqual({ items: [] });
  });
  it("refuses a response that does not match the contract", async () => {
    const api = createPublicApi(ok({ items: [{ slug: 1 }] }) as typeof fetch, "https://api.waronsaas.test", "t");
    await expect(api.get("listTargets")).rejects.toThrow(/does not match the contract/);
  });
  it("surfaces API error codes and network failures", async () => {
    const api = createPublicApi(
      ok({ error: { code: "NOT_FOUND", message: "no" } }, 404) as typeof fetch,
      "https://api.waronsaas.test",
      "t",
    );
    await expect(api.get("getContributor", { params: { handle: "octo" } })).rejects.toMatchObject({ code: "NOT_FOUND", status: 404 });
    const down = createPublicApi(
      (async () => {
        throw new TypeError("fetch failed");
      }) as typeof fetch,
      "https://api.waronsaas.test",
      "t",
    );
    await expect(down.get("listTargets")).rejects.toBeInstanceOf(PublicApiError);
  });
  it("encodes path parameters", async () => {
    let seen = "";
    const api = createPublicApi(
      (async (u: string) => {
        seen = u;
        return new Response(JSON.stringify({ error: { code: "NOT_FOUND", message: "x" } }), { status: 404 });
      }) as typeof fetch,
      "https://api.waronsaas.test",
      "t",
    );
    await api.get("getTarget", { params: { slug: "a/../b" } }).catch(() => undefined);
    expect(seen).toBe("https://api.waronsaas.test/v1/public/targets/a%2F..%2Fb");
  });
});
