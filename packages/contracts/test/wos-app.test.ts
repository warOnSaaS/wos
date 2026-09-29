/**
 * WOS-APP protocol (Amendment 01, contracts 5.0.0): the manifest, signed desktop packages, declarative
 * mobile screens, activation and the entitlement machine.
 */
import { describe, expect, it } from "vitest";
import {
  canonicalSha256,
  ed25519PrivateKeyFromSeed,
  encodeDevicePublicKey,
  modulePackageSigningPayload,
  signEd25519,
  verifyModulePackage,
} from "../src/canonical.js";
import {
  activeAppIds,
  EntitlementMachine,
  FeatureContract,
  findTransition,
  MobileScreen,
  ModulePackage,
  satisfiesRange,
  WosAppManifest,
} from "../src/index.js";
import { createPublicKey } from "node:crypto";

export const crmManifest = () => ({
  protocol: "wos-app/v1",
  app: { id: "crm", name: "wOS CRM", version: "0.1.0", kind: "app", billing: "addon", summary: "Accounts, opportunities and pipelines." },
  requires: { wos: ">=0.1.0", apps: [{ id: "contacts", version: "^0.1.0" }] },
  provides: ["opportunities", "pipelines"],
  features: ["opportunities", "pipelines"],
  replaces: ["salesforce", "hubspot"],
  surfaces: {
    web: { supported: true, entry: "./web" },
    desktop: { supported: true, entry: "./desktop" },
    ios: { supported: true },
    android: { supported: true },
    api: { supported: true },
  },
  mobile: { screens: "./mobile/screens" },
  data: { schema: "app_crm", migrations: "./migrations", owns: ["opportunity", "pipeline"] },
  permissions: [
    { key: "crm.opportunities.read", description: "Read opportunities", grantedTo: ["owner", "admin", "member"] },
    { key: "crm.opportunities.write", description: "Create and edit opportunities" },
  ],
  events: { publishes: ["crm.opportunity.created"], consumes: ["contacts.contact.updated"] },
  routes: { ui: "/crm", api: "/apps/crm" },
  navigation: [
    {
      id: "crm.pipeline",
      title: "Pipeline",
      route: "/crm/pipeline",
      surfaces: ["web", "desktop", "ios", "android"],
      permission: "crm.opportunities.read",
      order: 10,
    },
  ],
  hosting: { selfHost: { supported: true, services: ["postgres"] }, hosted: { supported: true } },
});

describe("WosAppManifest", () => {
  it("accepts the CRM example", () => {
    expect(WosAppManifest.safeParse(crmManifest()).error?.issues ?? []).toEqual([]);
  });

  it.each([
    [
      "a foreign permission prefix",
      (m: ReturnType<typeof crmManifest>) => m.permissions.push({ key: "chat.messages.read", description: "x x x" } as never),
    ],
    ["publishing another app's event", (m: ReturnType<typeof crmManifest>) => m.events.publishes.push("contacts.contact.created")],
    ["a wrong data schema", (m: ReturnType<typeof crmManifest>) => (m.data.schema = "crm")],
    ["a desktop surface without entry", (m: ReturnType<typeof crmManifest>) => delete (m.surfaces.desktop as { entry?: string }).entry],
    ["mobile without screens", (m: ReturnType<typeof crmManifest>) => ((m as { mobile: unknown }).mobile = null)],
    ["a priced module", (m: ReturnType<typeof crmManifest>) => (m.app.kind = "module")],
    ["a navigation entry outside the app's routes", (m: ReturnType<typeof crmManifest>) => (m.navigation[0]!.route = "/chat")],
    ["an app requiring itself", (m: ReturnType<typeof crmManifest>) => m.requires.apps.push({ id: "crm", version: "^0.1.0" })],
    ["a priced Build", (m: ReturnType<typeof crmManifest>) => (m.app.id = "build")],
  ])("rejects %s", (_name, mutate) => {
    const m = crmManifest();
    mutate(m);
    expect(WosAppManifest.safeParse(m).success).toBe(false);
  });
});

describe("signed desktop module packages (S-37)", () => {
  const key = ed25519PrivateKeyFromSeed(new Uint8Array(32).fill(7));
  const pub = encodeDevicePublicKey(createPublicKey(key));
  const unsigned = () => {
    const manifest = WosAppManifest.parse(crmManifest());
    return {
      schema: "wos-module-package.v1" as const,
      app: "crm",
      version: "0.1.0",
      surface: "desktop" as const,
      manifest,
      manifestSha256: canonicalSha256(manifest),
      entry: "index.html",
      files: [{ path: "index.html", sha256: `sha256:${"1".repeat(64)}`, bytes: 120 }],
      source: { repo: "waronsaas/product", tag: "crm@0.1.0", commit: "a".repeat(40) },
      builtAt: "2026-09-30T00:00:00Z",
    };
  };
  const signed = () => {
    const u = unsigned();
    return {
      ...u,
      signature: { alg: "ed25519" as const, keyId: "wos-module-2026", value: signEd25519(key, modulePackageSigningPayload(u as never)) },
    };
  };

  it("verifies against a pinned key", () => {
    expect(verifyModulePackage(signed(), { "wos-module-2026": pub })).toEqual([]);
  });
  it("refuses an unpinned key, a tampered file list and a swapped manifest", () => {
    expect(verifyModulePackage(signed(), {})).toEqual(["signature: key wos-module-2026 is not pinned in this Desktop"]);
    const tampered = signed();
    tampered.files[0]!.bytes = 121;
    expect(verifyModulePackage(tampered, { "wos-module-2026": pub })).toEqual(["signature: invalid"]);
    const swapped = signed();
    swapped.manifest.app.summary = "Something else entirely.";
    expect(verifyModulePackage(swapped, { "wos-module-2026": pub })).toContain("manifestSha256 does not match the manifest");
  });
  it("never packages native code or scripts", () => {
    const p = signed();
    p.files.push({ path: "helper.node", sha256: `sha256:${"2".repeat(64)}`, bytes: 1 });
    expect(ModulePackage.safeParse(p).success).toBe(false);
  });
});

describe("mobile declarative screens", () => {
  const detail = {
    schema: "wos-screen.v1",
    id: "crm.opportunity.detail",
    app: "crm",
    kind: "detail",
    resource: "/apps/crm/opportunities/:id",
    title: { field: "name" },
    permission: "crm.opportunities.read",
    sections: [
      { type: "fields", fields: [{ field: "amount" }, { field: "stage" }] },
      { type: "related_list", relationship: "contacts", screen: "crm.contact.list" },
    ],
    actions: [{ kind: "edit", id: "edit", screen: "crm.opportunity.form", permission: "crm.opportunities.write" }],
  };
  it("accepts a detail screen and refuses code-like or foreign definitions", () => {
    expect(MobileScreen.safeParse(detail).success).toBe(true);
    expect(MobileScreen.safeParse({ ...detail, resource: "https://evil.example/x" }).success).toBe(false);
    expect(MobileScreen.safeParse({ ...detail, actions: [{ kind: "eval", id: "x", code: "alert(1)" }] }).success).toBe(false);
    expect(MobileScreen.safeParse({ ...detail, permission: "chat.messages.read" }).success).toBe(false);
    expect(MobileScreen.safeParse({ ...detail, kind: "form" }).success).toBe(false);
  });
});

describe("activation and entitlements", () => {
  const registry = new Map([
    ["core", { kind: "core" as const, dependencies: [] }],
    ["contacts", { kind: "module" as const, dependencies: [] }],
    ["crm", { kind: "app" as const, dependencies: [{ id: "contacts" }] }],
    ["helpdesk", { kind: "app" as const, dependencies: [{ id: "contacts" }] }],
  ]);
  it("core is always active; enabling CRM activates Contacts; nothing else", () => {
    expect(activeAppIds(registry, [])).toEqual(["core"]);
    expect(activeAppIds(registry, ["crm"])).toEqual(["contacts", "core", "crm"]);
    expect(() => activeAppIds(registry, ["meet"])).toThrow(/not in the registry/);
  });
  it("semver ranges", () => {
    expect(satisfiesRange("0.1.4", "^0.1.0")).toBe(true);
    expect(satisfiesRange("1.0.0", "^0.1.0")).toBe(false);
    expect(satisfiesRange("1.2.0", ">=1.0.0 <2.0.0")).toBe(true);
  });
  it("the machine has no path from disabled to suspended and none back to available", () => {
    expect(findTransition(EntitlementMachine, "disabled", "suspend")).toBeUndefined();
    expect(EntitlementMachine.transitions.some((t) => t.to === "available")).toBe(false);
    expect(findTransition(EntitlementMachine, "available", "enable")?.to).toBe("enabled");
  });
});

describe("surfaces in roadmaps and contracts (5.0.0)", () => {
  it("a contract's required surfaces need capabilities, requirements and journeys", () => {
    const shape = FeatureContract.shape.surfaces;
    expect(
      shape.safeParse({
        desktop: { required: true, capabilities: ["bulk_import"] },
        api: { required: true, capabilities: ["list_contacts"] },
      }).success,
    ).toBe(true);
  });
});
