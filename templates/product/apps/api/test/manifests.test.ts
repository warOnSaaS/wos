import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { BUNDLED_APPS } from "../../../applications/registry.js";
import { MobileScreen, WosAppManifest } from "../../../modules/core-contracts/src/index.js";
import { loadBundle } from "../../../modules/core/src/bundle.js";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const manifest = (id: string) => WosAppManifest.parse(JSON.parse(readFileSync(`${root}applications/${id}/wos-app.json`, "utf8")));

describe("suite-shell: manifests for core, contacts and crm", () => {
  it("every applications/<id>/wos-app.json parses as WosAppManifest and is bundled", () => {
    const dirs = readdirSync(`${root}applications`, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort();
    expect(dirs).toEqual(["contacts", "core", "crm"]);
    for (const id of dirs) expect(manifest(id).app.id).toBe(id);
    const bundle = loadBundle(BUNDLED_APPS);
    expect([...bundle.apps.keys()].sort()).toEqual(dirs);
    expect(bundle.coreVersion).toBe("0.1.0");
  });

  it("kinds: core is core, contacts is a free module, crm is an addon app requiring contacts", () => {
    expect(manifest("core").app).toMatchObject({ kind: "core", billing: "base" });
    expect(manifest("contacts").app).toMatchObject({ kind: "module", billing: "free" });
    const crm = manifest("crm");
    expect(crm.app).toMatchObject({ kind: "app", billing: "addon" });
    expect(crm.requires.apps).toEqual([{ id: "contacts", version: "^0.1.0" }]);
    expect(crm.data.schema).toBe("app_crm");
  });

  it("no fake CRM: crm and contacts ship no features, own no entities and have no migrations yet", () => {
    for (const id of ["crm", "contacts"]) {
      const m = manifest(id);
      expect(m.features).toEqual([]);
      expect(m.data.owns).toEqual([]);
      expect(m.data.migrations).toBeNull();
      expect(m.events).toEqual({ publishes: [], consumes: [] });
    }
  });

  it("crm's mobile screen is wos-screen.v1 and reads only crm's own API", () => {
    const s = MobileScreen.parse(JSON.parse(readFileSync(`${root}applications/crm/mobile/screens/features.json`, "utf8")));
    expect(s.resource.startsWith("/apps/crm/")).toBe(true);
    expect(s.actions).toEqual([]);
  });

  it("the crm desktop entry is static HTML with a self-only CSP and no remote code (S-38)", () => {
    const html = readFileSync(`${root}applications/crm/desktop/index.html`, "utf8");
    expect(html).toContain("script-src 'self'");
    expect(html).not.toMatch(/https?:\/\//);
    expect(html).not.toMatch(/<script/);
  });

  it("loadBundle refuses a route with an undeclared permission, and a screen of another app", () => {
    const crm = BUNDLED_APPS.find((a) => (a.manifest as { app: { id: string } }).app.id === "crm")!;
    const bad = {
      ...crm,
      server: { routes: [{ method: "GET" as const, path: "/x", permission: "crm.secret.read", handler: () => ({ body: {} }) }] },
    };
    expect(() => loadBundle(BUNDLED_APPS.map((a) => (a === crm ? bad : a)))).toThrow(/undeclared permission crm.secret.read/);
    const other = { ...crm, screens: [{ ...(crm.screens![0] as object), app: "contacts", id: "contacts.features.list" }] };
    expect(() => loadBundle(BUNDLED_APPS.map((a) => (a === crm ? other : a)))).toThrow();
  });
});

describe("suite-shell: vendored contracts", () => {
  // Runs inside waronsaas/wos only; the product repo receives the copy and has no packages/contracts.
  it.skipIf(!existsSync(`${root}../../packages/contracts/src`))(
    "modules/core-contracts/src/vendor is a current copy of packages/contracts/src",
    () => {
      const out = execFileSync(process.execPath, [`${root}modules/core-contracts/vendor.mjs`, "--check"], { encoding: "utf8" });
      expect(out).toContain("current");
    },
  );
});
