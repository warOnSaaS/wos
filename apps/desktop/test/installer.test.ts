/**
 * The desktop module installer (S-37, S-38, S-39; WOS-APP-PROTOCOL section 6). Every package here is signed with a
 * THROWAWAY key (dev/module-fixtures.ts); the committed pinned-key file stays empty.
 */
import { createPublicKey } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type ActiveApps, ModuleInstallStates, WOS_CLOUD_ENVIRONMENT_ID } from "@waronsaas/contracts";
import { afterEach, describe, expect, it } from "vitest";
import { FakeApps, PERSONAL_ORG } from "../dev/fake-apps.js";
import { SAMPLE_APP, sampleFiles, sampleManifest, testKey } from "../dev/module-fixtures.js";
import { createModuleInstaller, type ModuleRegistry } from "../src/main/module-installer.js";
import { PINNED_MODULE_KEYS, pinnedKeysFrom } from "../src/main/module-keys.js";
import { c5FromPem } from "../scripts/pin-module-key.mjs";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function world(opts: { pinned?: Record<string, string> } = {}) {
  const apps = new FakeApps();
  const root = mkdtempSync(join(tmpdir(), "wos-installer-"));
  dirs.push(root);
  const downloads: string[] = [];
  const registry: ModuleRegistry = {
    async getAppRelease(app, version) {
      const r = apps.releases.get(`${app}@${version}`);
      if (!r) throw Object.assign(new Error("no such release"), { code: "NOT_FOUND" });
      return r;
    },
    async download(url) {
      downloads.push(url);
      const b = apps.bundles.get(url);
      if (!b) throw new Error("404");
      return b;
    },
  };
  const pinned = opts.pinned ?? { [apps.moduleKey.keyId]: apps.moduleKey.publicKey };
  const make = () =>
    createModuleInstaller({ root, platform: process.platform === "win32" ? "win32" : "linux", pinnedKeys: pinned, registry });
  return { apps, root, downloads, installer: make(), make };
}

const active = (version: string, manifest = sampleManifest(version)): ActiveApps => ({
  environmentId: WOS_CLOUD_ENVIRONMENT_ID,
  organizationId: PERSONAL_ORG,
  apps: [{ id: SAMPLE_APP, version, source: "entitlement", manifest }],
});
const ENV = { coreVersion: "0.1.0" };

describe("pinned keys (S-37)", () => {
  it("the committed file pins the real keys wos-module-2026 and -next (FOUNDER-CHECKLIST 13.5), public halves only, no test key", () => {
    expect(Object.keys(PINNED_MODULE_KEYS).sort()).toEqual(["wos-module-2026", "wos-module-2026-next"]);
    const raw = readFileSync(join(import.meta.dirname, "../src/main/keys/module-signing-keys.json"), "utf8");
    expect(JSON.parse(raw).schema).toBe("wos-module-signing-keys.v1");
    expect(raw).not.toContain("PRIVATE KEY");
    expect(raw).not.toContain(testKey().publicKey);
  });

  it("validates a key file: id format, C-5 public key, no duplicates", () => {
    const k = testKey();
    expect(pinnedKeysFrom({ schema: "wos-module-signing-keys.v1", keys: [{ keyId: "wos-module-2026", publicKey: k.publicKey }] })).toEqual({
      "wos-module-2026": k.publicKey,
    });
    expect(() => pinnedKeysFrom({ schema: "x", keys: [] })).toThrow(/schema/);
    expect(() => pinnedKeysFrom({ schema: "wos-module-signing-keys.v1", keys: [{ keyId: "prod", publicKey: k.publicKey }] })).toThrow(
      /key id/,
    );
    expect(() =>
      pinnedKeysFrom({ schema: "wos-module-signing-keys.v1", keys: [{ keyId: "wos-module-2026", publicKey: "AAAA" }] }),
    ).toThrow();
    expect(() =>
      pinnedKeysFrom({
        schema: "wos-module-signing-keys.v1",
        keys: [
          { keyId: "wos-module-2026", publicKey: k.publicKey },
          { keyId: "wos-module-2026", publicKey: k.publicKey },
        ],
      }),
    ).toThrow(/duplicate/);
  });

  it("the coordinator's pin script turns the founder's public PEM into the pinned encoding and refuses a private key", () => {
    const k = testKey(11);
    const pub = createPublicKey(k.privateKey).export({ format: "pem", type: "spki" }).toString();
    expect(c5FromPem(pub)).toBe(k.publicKey);
    expect(() => c5FromPem(k.privateKey.export({ format: "pem", type: "pkcs8" }).toString())).toThrow(/PRIVATE key/);
  });

  it("with the keys this binary ships (none), every package is refused", async () => {
    const w = world({ pinned: PINNED_MODULE_KEYS });
    const [s] = await w.installer.sync(active("0.1.0"), ENV);
    expect(s).toMatchObject({ state: "unavailable", active: null });
    expect(s!.reason).toMatch(/is not pinned in this Desktop/);
    expect(existsSync(join(w.root, SAMPLE_APP, "0.1.0"))).toBe(false);
  });
});

describe("install and verify", () => {
  it("installs a signed package: files on disk, active, served re-hashed; a file changed on disk is never served", async () => {
    const w = world();
    const [s] = await w.installer.sync(active("0.1.0"), ENV);
    expect(s).toMatchObject({ app: SAMPLE_APP, wanted: "0.1.0", active: "0.1.0", previous: null, state: "active", reason: null });
    const m = w.installer.active(SAMPLE_APP)!;
    expect(m).toMatchObject({ version: "0.1.0", entry: "index.html" });
    expect(m.manifest.routes.api).toBe("/apps/sample");
    const f = w.installer.readFile(SAMPLE_APP, "0.1.0", "app.js")!;
    expect(Buffer.from(f.bytes).toString()).toBe(sampleFiles("0.1.0")["app.js"]);
    expect(f.contentType).toMatch(/^text\/javascript/);
    expect(w.installer.readFile(SAMPLE_APP, "0.1.0", "missing.js")).toBeNull();
    expect(w.installer.readFile(SAMPLE_APP, "0.2.0", "app.js")).toBeNull();
    writeFileSync(join(w.root, SAMPLE_APP, "0.1.0", "files", "app.js"), "alert(1)");
    expect(w.installer.readFile(SAMPLE_APP, "0.1.0", "app.js")).toBeNull();
    // State survives a restart; the state file names only ModuleInstallMachine states.
    const state = JSON.parse(readFileSync(join(w.root, "state.json"), "utf8"));
    for (const v of Object.values(state.apps.sample.versions)) expect(ModuleInstallStates).toContain(v);
  });

  const refusals: Array<[string, (w: ReturnType<typeof world>) => void, RegExp]> = [
    ["signed by a key that is not pinned", (w) => w.apps.publishSample("0.1.0", { key: testKey(3, "wos-module-0001-test") }), /not pinned/],
    [
      "signed by the pinned key id but another private key",
      (w) => w.apps.publishSample("0.1.0", { key: { ...testKey(3), keyId: w.apps.moduleKey.keyId } }),
      /signature: invalid/,
    ],
    [
      "a file's bytes changed after signing",
      (w) =>
        w.apps.publishSample("0.1.0", {
          mutate: (b) => {
            b.contents[1]!.base64 = Buffer.from("alert(1)").toString("base64");
          },
        }),
      /bytes, the package lists|sha256 does not match/,
    ],
    [
      "a listed hash changed after signing",
      (w) =>
        w.apps.publishSample("0.1.0", {
          mutate: (b) => {
            b.package.files[0]!.sha256 = `sha256:${"0".repeat(64)}`;
          },
        }),
      /signature: invalid/,
    ],
    [
      "contents that differ from the file list",
      (w) =>
        w.apps.publishSample("0.1.0", {
          mutate: (b) => {
            b.contents.push({ path: "extra.js", base64: "" });
          },
        }),
      /contents must list exactly/,
    ],
    [
      "a native binary",
      (w) => w.apps.publishSample("0.1.0", { files: { ...sampleFiles("0.1.0"), "addon.node": "x" } }),
      /native or script/,
    ],
    [
      "two paths that differ only in case",
      (w) => w.apps.publishSample("0.1.0", { files: { ...sampleFiles("0.1.0"), "App.js": "x" } }),
      /only in case/,
    ],
    [
      "a name Windows reserves",
      (w) => w.apps.publishSample("0.1.0", { files: { ...sampleFiles("0.1.0"), "aux.js": "x" } }),
      /reserved name/,
    ],
    [
      "a Core the environment does not run",
      (w) => w.apps.publishSample("0.1.0", { manifest: sampleManifest("0.1.0", ">=0.9.0") }),
      /needs wOS Core >=0\.9\.0; this environment runs 0\.1\.0/,
    ],
  ];

  it.each(refusals)("refuses %s, and writes nothing", async (_name, tamper, reason) => {
    const w = world();
    tamper(w);
    const release = w.apps.releases.get(`${SAMPLE_APP}@0.1.0`)!;
    const [s] = await w.installer.sync(active("0.1.0", release.manifest), ENV);
    expect(s!.state).toBe("unavailable");
    expect(s!.reason).toMatch(reason);
    expect(s!.failures.at(-1)!.reason).toMatch(reason);
    expect(existsSync(join(w.root, SAMPLE_APP, "0.1.0"))).toBe(false);
    expect(w.installer.active(SAMPLE_APP)).toBeNull();
  });

  it("refuses a download that does not match the registry's sha256 (transport)", async () => {
    const w = world();
    const url = w.apps.releases.get(`${SAMPLE_APP}@0.1.0`)!.desktopPackage!.url;
    const bytes = w.apps.bundles.get(url)!;
    w.apps.bundles.set(url, new Uint8Array([...bytes, 32]));
    const [s] = await w.installer.sync(active("0.1.0"), ENV);
    expect(s!.reason).toMatch(/does not match the registry's sha256/);
  });

  it("refuses a package whose manifest is not the released one, or signed by another key than the registry lists", async () => {
    const w = world();
    const r = w.apps.releases.get(`${SAMPLE_APP}@0.1.0`)!;
    w.apps.releases.set(`${SAMPLE_APP}@0.1.0`, { ...r, manifestSha256: `sha256:${"1".repeat(64)}` });
    expect((await w.installer.sync(active("0.1.0"), ENV))[0]!.reason).toMatch(/not the released manifest/);
    w.apps.releases.set(`${SAMPLE_APP}@0.1.0`, { ...r, desktopPackage: { ...r.desktopPackage!, keyId: "wos-module-9999" } });
    expect((await w.installer.sync(active("0.1.0"), ENV))[0]!.reason).toMatch(/another key than the registry lists/);
  });
});

describe("versions only move forward; rollback is local (S-39)", () => {
  it("an upgrade keeps exactly one previous version", async () => {
    const w = world();
    await w.installer.sync(active("0.1.0"), ENV);
    w.apps.publishSample("0.2.0");
    expect((await w.installer.sync(active("0.2.0"), ENV))[0]).toMatchObject({ active: "0.2.0", previous: "0.1.0" });
    w.apps.publishSample("0.3.0");
    expect((await w.installer.sync(active("0.3.0"), ENV))[0]).toMatchObject({ active: "0.3.0", previous: "0.2.0" });
    expect(existsSync(join(w.root, SAMPLE_APP, "0.1.0"))).toBe(false);
  });

  it("never downloads an older version; going back to the kept previous is local", async () => {
    const w = world();
    await w.installer.sync(active("0.1.0"), ENV);
    w.apps.publishSample("0.2.0");
    w.apps.publishSample("0.3.0");
    await w.installer.sync(active("0.2.0"), ENV);
    await w.installer.sync(active("0.3.0"), ENV);
    const before = w.downloads.length;
    const [down] = await w.installer.sync(active("0.1.0"), ENV);
    expect(down).toMatchObject({ state: "unavailable", active: "0.3.0" });
    expect(down!.reason).toMatch(/DOWNGRADE REFUSED/);
    const [back] = await w.installer.sync(active("0.2.0"), ENV);
    expect(back).toMatchObject({ state: "active", active: "0.2.0", previous: null });
    expect(w.downloads.length).toBe(before);
  });

  it("a yanked active version is failed, removed and rolled back to previous; a yanked version is never installed", async () => {
    const w = world();
    await w.installer.sync(active("0.1.0"), ENV);
    w.apps.publishSample("0.2.0");
    await w.installer.sync(active("0.2.0"), ENV);
    w.apps.yank(SAMPLE_APP, "0.2.0", "broke the contact list");
    const [s] = await w.installer.sync(active("0.2.0"), ENV);
    expect(s).toMatchObject({ active: "0.1.0", previous: null, state: "unavailable" });
    expect(s!.reason).toMatch(/VERSION 0\.2\.0 WAS YANKED: broke the contact list\. ROLLED BACK TO 0\.1\.0/);
    expect(existsSync(join(w.root, SAMPLE_APP, "0.2.0"))).toBe(false);
    // Fresh machine: a yanked version is refused outright.
    const fresh = world();
    fresh.apps.publishSample("0.2.0");
    fresh.apps.yank(SAMPLE_APP, "0.2.0", "withdrawn");
    const [f] = await fresh.installer.sync(active("0.2.0"), ENV);
    expect(f).toMatchObject({ active: null, state: "unavailable" });
    expect(f!.reason).toMatch(/never installs a yanked version/);
    expect(fresh.downloads).toEqual([]);
  });

  it("a yanked active version with no previous leaves the app unavailable", async () => {
    const w = world();
    await w.installer.sync(active("0.1.0"), ENV);
    w.apps.yank(SAMPLE_APP, "0.1.0", "withdrawn");
    const [s] = await w.installer.sync(active("0.1.0"), ENV);
    expect(s).toMatchObject({ active: null, state: "unavailable" });
    expect(s!.reason).toMatch(/NO PREVIOUS VERSION/);
  });

  it("a version that fails to load is failed and the previous one re-activated, if it still verifies", async () => {
    const w = world();
    await w.installer.sync(active("0.1.0"), ENV);
    w.apps.publishSample("0.2.0");
    await w.installer.sync(active("0.2.0"), ENV);
    const s = w.installer.reportLoadFailure(SAMPLE_APP, "0.2.0", "did-fail-load");
    expect(s).toMatchObject({ active: "0.1.0", previous: null });
    expect(s.reason).toMatch(/0\.2\.0 FAILED TO LOAD \(did-fail-load\)\. ROLLED BACK TO 0\.1\.0/);
    // A previous copy altered on disk does not verify: no rollback to it.
    const v = world();
    await v.installer.sync(active("0.1.0"), ENV);
    v.apps.publishSample("0.2.0");
    await v.installer.sync(active("0.2.0"), ENV);
    writeFileSync(join(v.root, SAMPLE_APP, "0.1.0", "files", "app.js"), "alert(1)");
    const t = v.make().reportLoadFailure(SAMPLE_APP, "0.2.0", "crashed");
    expect(t).toMatchObject({ active: null, previous: null });
    expect(t.failures.map((f) => f.reason).join(" ")).toMatch(/ROLLBACK REFUSED/);
  });

  it("offline with the wanted version installed keeps it running", async () => {
    const w = world();
    await w.installer.sync(active("0.1.0"), ENV);
    w.apps.releases.clear();
    const [s] = await w.installer.sync(active("0.1.0"), ENV);
    expect(s).toMatchObject({ state: "active", active: "0.1.0" });
  });
});
