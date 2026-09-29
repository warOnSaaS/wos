/**
 * The CLI SecretStore over @napi-rs/keyring (SECURITY.md S-4). The unit tests inject a fake entry; the
 * round trip through the real OS keychain runs only with WOS_TEST_KEYCHAIN=1 (it writes and deletes one
 * entry under a throwaway service name), because CI machines have no unlocked keychain.
 */
import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createKeychainSecretStore, type EntryFactory, KEYCHAIN_SERVICE } from "../src/keychain.js";

function fakeKeychain(opts: { missing?: "undefined" | "throws"; broken?: boolean } = {}) {
  const store = new Map<string, string>();
  const calls: string[] = [];
  const entry: EntryFactory = (service, account) => {
    const k = `${service}/${account}`;
    return {
      async getPassword() {
        calls.push(`get ${k}`);
        if (opts.broken) throw new Error("user interaction is not allowed");
        const v = store.get(k);
        if (v === undefined && opts.missing === "throws") throw new Error("No matching entry found in secure storage");
        return v;
      },
      async setPassword(v) {
        calls.push(`set ${k}`);
        if (opts.broken) throw new Error("user interaction is not allowed");
        store.set(k, v);
      },
      async deletePassword() {
        calls.push(`delete ${k}`);
        if (!store.delete(k) && opts.missing === "throws") throw new Error("No matching entry found in secure storage");
        return true;
      },
    };
  };
  return { store, calls, entry };
}

describe("keychain SecretStore", () => {
  it.each(["undefined", "throws"] as const)("stores under the wOS service; a missing entry reads as null (%s)", async (missing) => {
    const k = fakeKeychain({ missing });
    const s = createKeychainSecretStore(KEYCHAIN_SERVICE, k.entry);
    expect(await s.get("wos.session.v1")).toBeNull();
    await s.set("wos.session.v1", '{"accessToken":"a"}');
    expect(await s.get("wos.session.v1")).toBe('{"accessToken":"a"}');
    expect([...k.store.keys()]).toEqual(["com.waronsaas.wos/wos.session.v1"]);
    await s.delete("wos.session.v1");
    await s.delete("wos.session.v1"); // idempotent
    expect(await s.get("wos.session.v1")).toBeNull();
  });

  it("a locked or absent keychain is an error with code KEYCHAIN_UNAVAILABLE, never a silent fallback", async () => {
    const s = createKeychainSecretStore(KEYCHAIN_SERVICE, fakeKeychain({ broken: true }).entry);
    await expect(s.get("wos.session.v1")).rejects.toMatchObject({ code: "KEYCHAIN_UNAVAILABLE" });
    await expect(s.set("wos.session.v1", "x")).rejects.toMatchObject({ code: "KEYCHAIN_UNAVAILABLE" });
  });

  it.skipIf(process.env.WOS_TEST_KEYCHAIN !== "1")("round trip through the real OS keychain", async () => {
    const service = `com.waronsaas.wos.test-${randomBytes(4).toString("hex")}`;
    const s = createKeychainSecretStore(service);
    try {
      expect(await s.get("wos.session.v1")).toBeNull();
      await s.set("wos.session.v1", "secret-value");
      expect(await s.get("wos.session.v1")).toBe("secret-value");
    } finally {
      await s.delete("wos.session.v1");
    }
    expect(await s.get("wos.session.v1")).toBeNull();
  });
});
