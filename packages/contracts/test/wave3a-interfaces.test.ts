/**
 * Wave 3a interfaces (contracts 5.2.0): the Build manifest, environment tokens (C-8), module bundles, release and
 * progress routes, and the wos-screen.v1 data contract.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  canonicalSha256,
  ed25519PrivateKeyFromSeed,
  encodeDevicePublicKey,
  signEnvironmentToken,
  verifyEnvironmentToken,
} from "../src/canonical.js";
import {
  AppRoutes,
  BUILD_APP_ID,
  ENVIRONMENT_TOKEN_TTL_SECONDS,
  EnvironmentKey,
  MobileScreen,
  ModuleBundle,
  ScreenListData,
  ScreenRecordData,
  TargetSummary,
  WOS_CLOUD_ENVIRONMENT_ID,
  WosAppManifest,
} from "../src/index.js";
import { createPublicKey } from "node:crypto";

const BUILD_MANIFEST = new URL("../../../apps/desktop/src/apps/build/wos-app.json", import.meta.url);
const buildManifest = JSON.parse(readFileSync(BUILD_MANIFEST, "utf8"));

describe("the Build app's manifest (apps/desktop/src/apps/build/wos-app.json)", () => {
  const raw = buildManifest;
  const parsed = WosAppManifest.safeParse(raw);

  it("is valid against the WOS-APP manifest contract", () => {
    expect(parsed.error?.issues ?? []).toEqual([]);
  });

  it("is the free, desktop-only, built-in Build app that matches its registry seed (migration 0006)", () => {
    const m = parsed.data!;
    expect(m.app).toMatchObject({ id: BUILD_APP_ID, name: "Build", kind: "app", billing: "free" });
    expect(
      Object.entries(m.surfaces)
        .filter(([, s]) => s.supported)
        .map(([k]) => k),
    ).toEqual(["desktop"]);
    expect(m.routes).toEqual({ ui: "/build", api: null });
    expect(m.navigation.every((n) => n.surfaces.join() === "desktop" && n.permission === "build.contribute")).toBe(true);
    expect(m.hosting.selfHost.supported).toBe(false);
    // Nothing invented: Build ships no catalog features and claims to replace nothing.
    expect(m.features).toEqual([]);
    expect(m.replaces).toEqual([]);
  });

  it("is written verbatim as it parses (no defaults filled in by the schema)", () => {
    expect(canonicalSha256(parsed.data)).toBe(canonicalSha256(raw));
  });
});

describe("C-8 environment tokens", () => {
  const priv = ed25519PrivateKeyFromSeed(new Uint8Array(32).fill(7));
  const pub = encodeDevicePublicKey(createPublicKey(priv));
  const keys = { "wos-env-2026": pub };
  const claims = {
    iss: "https://api.waronsaas.com",
    aud: WOS_CLOUD_ENVIRONMENT_ID,
    sub: "0192f000-0000-7000-8000-000000000001",
    org: "0192f000-0000-7000-8000-000000000002",
    role: "owner" as const,
    apps: ["contacts", "core", "crm"],
    iat: 1_790_000_000,
    exp: 1_790_000_000 + ENVIRONMENT_TOKEN_TTL_SECONDS,
  };
  const expected = { environmentId: WOS_CLOUD_ENVIRONMENT_ID, nowSeconds: claims.iat + 10 };

  it("publishes keys in the C-5 encoding", () => {
    expect(EnvironmentKey.safeParse({ kid: "wos-env-2026", alg: "EdDSA", publicKey: pub }).success).toBe(true);
  });

  it("round-trips, deterministically", () => {
    const token = signEnvironmentToken(claims, "wos-env-2026", priv);
    expect(signEnvironmentToken(claims, "wos-env-2026", priv)).toBe(token);
    expect(token.split(".")).toHaveLength(3);
    expect(token).not.toMatch(/[=+/]/);
    expect(verifyEnvironmentToken(token, keys, expected)).toEqual({ ok: true, claims });
  });

  it("refuses a 16-minute token at minting", () => {
    expect(() => signEnvironmentToken({ ...claims, exp: claims.exp + 60 }, "wos-env-2026", priv)).toThrow(RangeError);
  });

  it.each([
    ["an unknown key", (t: string) => t, { keys: {} }, "unknown key wos-env-2026"],
    ["another environment", (t: string) => t, { environmentId: "0192f000-0000-7000-8000-000000000003" }, "wrong audience"],
    ["an expired token", (t: string) => t, { nowSeconds: claims.exp + 61 }, "expired"],
    ["a token from the future", (t: string) => t, { nowSeconds: claims.iat - 61 }, "issued in the future"],
    ["a tampered claim", (t: string) => swapClaims(t, { ...claims, apps: ["core", "crm", "chat"] }), {}, "invalid signature"],
    ["garbage", () => "a.b", {}, "malformed token"],
  ])("rejects %s", (_n, mutate, over, reason) => {
    const token = mutate(signEnvironmentToken(claims, "wos-env-2026", priv));
    const k = (over as { keys?: Record<string, string> }).keys ?? keys;
    expect(verifyEnvironmentToken(token, k, { ...expected, ...over })).toEqual({ ok: false, reason });
  });
});

function swapClaims(token: string, claims: object): string {
  const [h, , s] = token.split(".");
  return `${h}.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.${s}`;
}

describe("contracts 5.2.0 additions for the Wave 3a consumers", () => {
  it("adds the release and application-progress routes to AppRoutes", () => {
    expect(AppRoutes.getAppRelease.path).toBe("/v1/public/apps/:app/releases/:version");
    expect(AppRoutes.getApplicationProgress.path).toBe("/v1/public/apps/:app/progress");
  });

  it("lets a target name its applications (optional, unknown-safe)", () => {
    expect(TargetSummary.shape.apps.safeParse(["crm"]).success).toBe(true);
    expect(TargetSummary.shape.apps.safeParse(undefined).success).toBe(true);
    expect(TargetSummary.shape.apps.safeParse(["CRM"]).success).toBe(false);
  });

  it("requires options on (and only on) a select input", () => {
    const form = (field: object) => ({
      schema: "wos-screen.v1",
      id: "crm.opportunity.edit",
      app: "crm",
      kind: "form",
      resource: "/apps/crm/opportunities/:id",
      title: { text: "Opportunity" },
      permission: "crm.opportunities.write",
      sections: [{ type: "fields", fields: [field] }],
    });
    const options = [{ value: "open", label: "Open" }];
    expect(MobileScreen.safeParse(form({ field: "stage", input: "select", options })).success).toBe(true);
    expect(MobileScreen.safeParse(form({ field: "stage", input: "select" })).success).toBe(false);
    expect(MobileScreen.safeParse(form({ field: "name", input: "text", options })).success).toBe(false);
  });

  it("fixes the screen data envelopes: flat records with an id", () => {
    expect(ScreenListData.safeParse({ items: [{ id: "c1", name: "Ada", open: true, amount: 3 }], nextCursor: null }).success).toBe(true);
    expect(ScreenListData.safeParse({ items: [{ name: "no id" }], nextCursor: null }).success).toBe(false);
    expect(ScreenRecordData.safeParse({ item: { id: "c1", nested: { no: 1 } } }).success).toBe(false);
  });

  it("requires a module bundle's contents to be exactly the package's files", () => {
    const pkg = {
      schema: "wos-module-package.v1",
      app: "build",
      version: "0.1.0",
      surface: "desktop",
      manifest: buildManifest,
      manifestSha256: canonicalSha256(buildManifest),
      entry: "index.html",
      files: [{ path: "index.html", sha256: `sha256:${"1".repeat(64)}`, bytes: 120 }],
      source: { repo: "waronsaas/wos", tag: "build@0.1.0", commit: "a".repeat(40) },
      builtAt: "2026-09-30T00:00:00Z",
      signature: { alg: "ed25519", keyId: "wos-module-2026", value: `${"A".repeat(86)}==` },
    };
    const contents = [{ path: "index.html", base64: "PGh0bWw+" }];
    const bundle = (c: typeof contents) => ModuleBundle.safeParse({ schema: "wos-module-bundle.v1", package: pkg, contents: c });
    expect(bundle(contents).error?.issues ?? []).toEqual([]);
    expect(bundle([...contents, { path: "extra.js", base64: "" }]).success).toBe(false);
    expect(bundle([]).success).toBe(false);
  });
});
