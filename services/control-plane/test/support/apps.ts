/** Fixtures for the one-product routes: manifests, signed desktop packages and their bundles (throwaway keys only). */
import type { KeyObject } from "node:crypto";
import type { ModulePackage, WosAppManifest } from "@waronsaas/contracts";
import { canonicalSha256, modulePackageSigningPayload, sha256Of, signEd25519 } from "@waronsaas/contracts/canonical";
import type { Harness } from "./harness.js";

export const COMMIT = "a".repeat(40);

export function manifest(
  id: string,
  opts: {
    version?: string;
    kind?: "app" | "module";
    requires?: Array<{ id: string; version: string }>;
    features?: string[];
    replaces?: string[];
    desktop?: boolean;
    web?: boolean;
    hosted?: boolean;
  } = {},
): WosAppManifest {
  const kind = opts.kind ?? "app";
  const desktop = opts.desktop ?? false;
  const web = opts.web ?? true;
  return {
    protocol: "wos-app/v1",
    app: {
      id,
      name: `wOS ${id.toUpperCase()}`,
      version: opts.version ?? "0.1.0",
      kind,
      billing: kind === "module" ? "free" : "addon",
      summary: `The ${id} application of wOS, for tests.`,
    },
    requires: { wos: ">=0.1.0", apps: opts.requires ?? [] },
    provides: [],
    features: opts.features ?? [],
    replaces: opts.replaces ?? [],
    surfaces: {
      web: web ? { supported: true, entry: "./web" } : { supported: false },
      desktop: desktop ? { supported: true, entry: "./desktop" } : { supported: false },
      ios: { supported: false },
      android: { supported: false },
      api: { supported: true },
    },
    mobile: null,
    data: { schema: `app_${id.replace(/-/g, "_")}`, migrations: null, owns: [] },
    permissions: [],
    events: { publishes: [], consumes: [] },
    routes: { ui: `/${id}`, api: `/apps/${id}` },
    navigation: [],
    hosting: { selfHost: { supported: true, services: ["postgres"] }, hosted: { supported: opts.hosted ?? true } },
  };
}

export function signedPackage(m: WosAppManifest, key: KeyObject, keyId: string, files: Record<string, string>): ModulePackage {
  const unsigned = {
    schema: "wos-module-package.v1" as const,
    app: m.app.id,
    version: m.app.version,
    surface: "desktop" as const,
    manifest: m,
    manifestSha256: canonicalSha256(m),
    entry: "index.html",
    files: Object.entries(files).map(([path, content]) => ({ path, sha256: sha256Of(content), bytes: Buffer.byteLength(content) })),
    source: { repo: "waronsaas/product", tag: `${m.app.id}@${m.app.version}`, commit: COMMIT },
    builtAt: "2026-09-30T12:00:00.000Z",
  };
  const signature = { alg: "ed25519" as const, keyId, value: signEd25519(key, modulePackageSigningPayload(unsigned as ModulePackage)) };
  return { ...unsigned, signature };
}

export function bundleBytes(pkg: ModulePackage, files: Record<string, string>): Uint8Array {
  const contents = Object.entries(files).map(([path, content]) => ({ path, base64: Buffer.from(content).toString("base64") }));
  return Buffer.from(JSON.stringify({ schema: "wos-module-bundle.v1", package: pkg, contents }));
}

export const DESKTOP_FILES = { "index.html": "<!doctype html><title>crm</title>", "app.js": "export const crm = 1;\n" };

/** Publishes a release through the API as `maintainerToken`; a desktop manifest gets a signed package and a served bundle. */
export async function publish(h: Harness, maintainerToken: string, m: WosAppManifest, files: Record<string, string> = DESKTOP_FILES) {
  let desktopPackage: ModulePackage | null = null;
  let desktopPackageUrl: string | null = null;
  if (m.surfaces.desktop.supported) {
    desktopPackage = signedPackage(m, h.keys.modulePrivate, h.keys.moduleKeyId, files);
    desktopPackageUrl = `https://github.com/waronsaas/wos/releases/download/modules/${m.app.id}@${m.app.version}/bundle.json`;
    h.bundles.set(desktopPackageUrl, bundleBytes(desktopPackage, files));
  }
  return h.call("POST", "/v1/admin/app-releases", {
    token: maintainerToken,
    idem: true,
    body: {
      manifest: m,
      desktopPackage,
      desktopPackageUrl,
      source: { repo: "waronsaas/product", tag: `${m.app.id}@${m.app.version}`, commit: COMMIT },
    },
  });
}

export async function personalOrg(h: Harness, token: string): Promise<string> {
  const r = await h.call("GET", "/v1/orgs", { token });
  if (r.status !== 200) throw new Error(`listMyOrganizations ${r.status}`);
  return r.body.items[0].id;
}
