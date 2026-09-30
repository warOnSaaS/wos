/**
 * DEVELOPMENT AND TESTS ONLY: signed desktop module bundles made with THROWAWAY keys (never pinned in the binary:
 * `src/main/keys/module-signing-keys.json` stays empty until the coordinator adds the real public key). The fake
 * registry serves these; tests pass the throwaway public key to the installer explicitly.
 *
 * The sample app is labelled a test module everywhere it appears. It is not CRM and shows no business data.
 */
import type { KeyObject } from "node:crypto";
import { createPublicKey } from "node:crypto";
import { type AppReleaseView, type ModuleBundle, ModulePackage, WosAppManifest } from "@waronsaas/contracts";
import {
  canonicalSha256,
  ed25519PrivateKeyFromSeed,
  encodeDevicePublicKey,
  modulePackageSigningPayload,
  sha256Of,
  signEd25519,
} from "@waronsaas/contracts/canonical";

export interface TestKey {
  keyId: string;
  privateKey: KeyObject;
  publicKey: string;
}

/** A deterministic throwaway Ed25519 key (seed = 32 copies of `seedByte`). */
export function testKey(seedByte = 7, keyId = "wos-module-0000-test"): TestKey {
  const privateKey = ed25519PrivateKeyFromSeed(new Uint8Array(32).fill(seedByte));
  return { keyId, privateKey, publicKey: encodeDevicePublicKey(createPublicKey(privateKey)) };
}

export const SAMPLE_APP = "sample" as const;

/** The test module's manifest: a desktop page and an API under /apps/sample. */
export function sampleManifest(version: string, requiresWos = ">=0.1.0"): WosAppManifest {
  return WosAppManifest.parse({
    protocol: "wos-app/v1",
    app: {
      id: SAMPLE_APP,
      name: "Sample (TEST MODULE)",
      version,
      kind: "app",
      billing: "addon",
      summary: "A test module for the wOS Desktop installer. Not a product app.",
    },
    requires: { wos: requiresWos, apps: [] },
    surfaces: {
      web: { supported: false },
      desktop: { supported: true, entry: "./desktop" },
      ios: { supported: false },
      android: { supported: false },
      api: { supported: true },
    },
    data: { schema: "app_sample", migrations: null, owns: [] },
    permissions: [{ key: "sample.read", description: "Read the test module", grantedTo: ["owner", "admin", "member"] }],
    events: { publishes: [], consumes: [] },
    routes: { ui: "/sample", api: "/apps/sample" },
    navigation: [
      { id: "sample.home", title: "SAMPLE (TEST)", route: "/sample", surfaces: ["desktop"], permission: "sample.read", order: 50 },
    ],
    hosting: { selfHost: { supported: true, services: ["postgres"] }, hosted: { supported: true } },
  });
}

/** The test module's page: shows its origin and one host-bridge call. Scripts come from its own origin only. */
export function sampleFiles(version: string): Record<string, string> {
  return {
    "index.html": `<!doctype html><html><head><meta charset="utf-8"><title>Sample (TEST MODULE)</title><link rel="stylesheet" href="./style.css"></head><body><h1>SAMPLE TEST MODULE ${version}</h1><p id="origin"></p><p id="ping">CALLING THE HOST BRIDGE...</p><script src="./app.js"></script></body></html>\n`,
    "app.js": `document.getElementById("origin").textContent = "ORIGIN " + location.origin + " ROUTE " + location.hash;
window.wos.app("sample").request("GET", "/apps/sample/ping").then(
  (r) => { document.getElementById("ping").textContent = "BRIDGE " + r.status + " " + JSON.stringify(r.body); },
  (e) => { document.getElementById("ping").textContent = "BRIDGE ERROR " + e.message; },
);\n`,
    "style.css": "body{background:#0b0b0b;color:#e6e6e3;font-family:monospace;padding:2rem}\n",
  };
}

export interface BuiltModule {
  bundle: ModuleBundle;
  bytes: Uint8Array;
  sha256: string;
  release: AppReleaseView;
}

/** Builds, hashes and signs a module package and its one-file bundle, plus the registry's release view. */
export function buildModule(opts: {
  manifest: WosAppManifest;
  files: Record<string, string | Uint8Array>;
  entry?: string;
  key: TestKey;
  url: string;
  state?: "published" | "yanked";
  yankReason?: string | null;
  /** Tamper hooks for tests: run after signing. */
  mutate?: (b: { package: ModulePackage; contents: Array<{ path: string; base64: string }> }) => void;
}): BuiltModule {
  const m = opts.manifest;
  const bufs = Object.entries(opts.files).map(([path, c]) => ({ path, buf: Buffer.from(typeof c === "string" ? c : c) }));
  const unsigned = {
    schema: "wos-module-package.v1" as const,
    app: m.app.id,
    version: m.app.version,
    surface: "desktop" as const,
    manifest: m,
    manifestSha256: canonicalSha256(m),
    entry: opts.entry ?? "index.html",
    files: bufs.map((f) => ({ path: f.path, sha256: sha256Of(f.buf), bytes: f.buf.byteLength })),
    source: { repo: "waronsaas/product", tag: `${m.app.id}@${m.app.version}`, commit: "0".repeat(40) },
    builtAt: "2026-09-30T00:00:00.000Z",
  };
  // The manifest is already parsed (defaults applied), so these are the bytes verifyModulePackage rebuilds.
  const signed = {
    ...unsigned,
    signature: {
      alg: "ed25519" as const,
      keyId: opts.key.keyId,
      value: signEd25519(opts.key.privateKey, modulePackageSigningPayload(unsigned)),
    },
  };
  // Tests build schema-invalid packages on purpose (a native binary): those are served as signed, unparsed.
  const parsedPkg = ModulePackage.safeParse(signed);
  const pkg = (parsedPkg.success ? parsedPkg.data : signed) as ModulePackage;
  const raw = { package: pkg, contents: bufs.map((f) => ({ path: f.path, base64: f.buf.toString("base64") })) };
  opts.mutate?.(raw);
  const bundle = { schema: "wos-module-bundle.v1", ...raw } as ModuleBundle;
  const bytes = new TextEncoder().encode(JSON.stringify(bundle));
  const sha256 = sha256Of(bytes);
  const release: AppReleaseView = {
    app: m.app.id,
    version: m.app.version,
    state: opts.state ?? "published",
    manifest: m,
    manifestSha256: canonicalSha256(m),
    desktopPackage: { url: opts.url, sha256, keyId: opts.key.keyId },
    source: { repo: "waronsaas/product", tag: `${m.app.id}@${m.app.version}`, commit: "0".repeat(40) },
    publishedAt: "2026-09-30T00:00:00.000Z",
    yankedAt: opts.state === "yanked" ? "2026-09-30T01:00:00.000Z" : null,
    yankReason: opts.state === "yanked" ? (opts.yankReason ?? "withdrawn in a test") : null,
  };
  return { bundle, bytes, sha256, release };
}
