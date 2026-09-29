/**
 * Valid baseline documents. Every negative test clones one of these and breaks exactly one rule, so each
 * failing fixture proves one code.
 */
import {
  AGENT_POLICY_V1,
  type BuildGraph,
  type CatalogEntry,
  type FeatureContract,
  type Inventory,
  MINIMUM_BROWSERS,
  PRODUCT_REPO,
  type RepoManifest,
  type ReviewVerdict,
  type Roadmap,
} from "@waronsaas/contracts";

export const policy = AGENT_POLICY_V1;
export const clone = <T>(x: T): T => structuredClone(x);
const why = (s: string) => `${s} — compared with its siblings on size, user importance and complexity.`;

// ---------------------------------------------------------------------------------------------
// Roadmap side: a small CRM target with web, iPhone and Android surfaces.
// ---------------------------------------------------------------------------------------------

export function inventory(): Inventory {
  return {
    schema: "wos-inventory.v1",
    target: "acme-crm",
    version: 1,
    sources: [
      { title: "Acme help center", url: "https://help.example.com/", retrievedOn: "2026-09-01" },
      { title: "Acme mobile apps", url: "https://example.com/mobile", retrievedOn: "2026-09-01" },
    ],
    surfaces: [
      { surface: "web", title: "Web app", source: 0, platforms: [], browsers: ["chromium", "webkit", "firefox"] },
      { surface: "ios", title: "iPhone and iPad app", source: 1, platforms: ["iPhone", "iPad"], browsers: [] },
      { surface: "android", title: "Android app", source: 1, platforms: ["Android"], browsers: [] },
    ],
    items: [
      { key: "INV-0001", area: "Contacts", title: "Contact list", description: "Browse contacts", source: 0, weight: 1 },
      { key: "INV-0002", area: "Contacts", title: "Contact import", description: "Import CSV", source: 0, weight: 1 },
      { key: "INV-0003", area: "Deals", title: "Deal pipeline", description: "Kanban of deals", source: 0, weight: 1 },
      { key: "INV-0004", area: "Admin", title: "Legacy fax gateway", description: "Send faxes", source: 0, weight: 1 },
      { key: "INV-0005", area: "Reports", title: "Dashboards", description: "Charts", source: 0, weight: 1 },
    ],
  };
}

const journey = (key: string, surface: "web" | "ios" | "android", caps: string[] = []) => ({
  key,
  surface,
  title: `Find a contact on ${surface}`,
  steps: ["Open contacts", "Search by name"],
  entryPoints: ["Main navigation"],
  platformBehaviour: "works offline from cache",
  nativeCapabilities: caps,
});

export function roadmap(): Roadmap {
  return {
    schema: "wos-roadmap.v1",
    target: "acme-crm",
    version: 1,
    inventoryVersion: 1,
    productName: "Open CRM",
    apps: ["crm"],
    summary: "A CRM parity profile.",
    architecture: { overview: "modules", composition: "suite modules", appSpecificData: "none", selfHosting: "one suite" },
    surfaces: [
      { surface: "web", status: "in_scope", reason: null, repo: PRODUCT_REPO, path: "apps/web" },
      { surface: "ios", status: "in_scope", reason: null, repo: PRODUCT_REPO, path: "apps/mobile" },
      { surface: "android", status: "in_scope", reason: null, repo: PRODUCT_REPO, path: "apps/mobile" },
    ],
    capabilities: [
      {
        key: "contacts",
        title: "Contacts",
        summary: "People and companies",
        weightBp: 6000,
        weightRationale: why("Contacts are the core record every other capability hangs off"),
        inventoryItems: ["INV-0001", "INV-0002"],
        features: [
          {
            feature: "contacts",
            weightBp: 7000,
            weightRationale: why("Browsing and editing contacts is the daily job of every user"),
            surfaces: [
              { surface: "web", weightBp: 5000, weightRationale: why("Most contact work happens at a desk in the browser") },
              { surface: "ios", weightBp: 3000, weightRationale: why("Field sales look contacts up on iPhone before meetings") },
              { surface: "android", weightBp: 2000, weightRationale: why("Android has the smaller share of this vendor's field users") },
            ],
            journeys: [journey("J-001", "web"), journey("J-002", "ios"), journey("J-003", "android")],
            inventoryItems: ["INV-0001"],
            appNotes: "",
            phase: "core",
          },
          {
            feature: "csv-import",
            weightBp: 3000,
            weightRationale: why("Import is used at onboarding and occasionally afterwards"),
            surfaces: [{ surface: "web", weightBp: 10_000, weightRationale: why("Import runs only in the browser at the vendor too") }],
            journeys: [journey("J-001", "web")],
            inventoryItems: ["INV-0002"],
            appNotes: "",
            phase: "later",
          },
        ],
      },
      {
        key: "deals",
        title: "Deals",
        summary: "Pipeline",
        weightBp: 3000,
        weightRationale: why("Deals drive revenue but fewer users touch them than contacts"),
        inventoryItems: ["INV-0003"],
        features: [],
      },
      {
        key: "reports",
        title: "Reports",
        summary: "Dashboards",
        weightBp: 1000,
        weightRationale: why("Reports are read weekly by managers, a small share of use"),
        inventoryItems: ["INV-0005"],
        features: [],
      },
    ],
    excluded: [{ item: "INV-0004", reason: "Fax is retired by nearly every customer." }],
    newCatalogFeatures: ["csv-import"],
    proposals: [],
  };
}

export function catalog(): Map<string, CatalogEntry> {
  const e = (key: string, aliasOf: string | null = null): CatalogEntry => ({
    schema: "wos-catalog-entry.v1",
    key,
    title: key,
    summary: `The ${key} feature, app-neutral.`,
    aliasOf,
  });
  return new Map([
    ["contacts", e("contacts")],
    ["csv-import", e("csv-import")],
    ["people", e("people", "contacts")],
  ]);
}

// ---------------------------------------------------------------------------------------------
// Contract side: the shared "contacts" feature, web + iOS + Android, two app profiles.
// ---------------------------------------------------------------------------------------------

export function repoManifest(): RepoManifest {
  return {
    schema: "wos-repo.v1",
    displayName: "warOnSaaS product",
    apps: [
      { surface: "web", path: "apps/web" },
      { surface: "ios", path: "apps/mobile" },
      { surface: "android", path: "apps/mobile" },
    ],
    defaultBranch: "main",
    stack: { language: "typescript", runtime: "node", packageManager: "npm", nodeVersion: "22" },
    install: ["npm", "ci", "--ignore-scripts"],
    verify: [{ id: "test", run: ["npm", "test"], timeoutSeconds: 600 }],
    protectedPaths: [".github/**", "wos.json", "catalog/**"],
    lockfiles: ["package-lock.json", "modules/contacts/native/package-lock.json"],
    toolchainPaths: [
      "wos.json",
      "**/package.json",
      "package-lock.json",
      "**/tsconfig*.json",
      "biome.json",
      "biome.jsonc",
      "**/vitest.config.*",
      "**/vitest.workspace.*",
      "**/vite.config.*",
      "**/eslint.config.*",
      "**/.eslintrc*",
      "**/.prettierrc*",
      ".npmrc",
      ".nvmrc",
    ],
    generatedPaths: ["dist/**"],
    migrationsDir: "apps/web/db/migrations",
    maxChangesetBytes: 1_000_000,
    toolchainRequirements: [
      {
        id: "ios-native",
        paths: ["apps/mobile/ios/**", "modules/*/native/ios/**"],
        os: ["macos"],
        tools: [{ name: "xcode", minVersion: "16.0" }],
      },
      {
        id: "android-native",
        paths: ["apps/mobile/android/**", "modules/*/native/android/**"],
        os: ["macos", "linux"],
        tools: [],
      },
    ],
    browsers: [...MINIMUM_BROWSERS],
  };
}

const req = (key: string, surfaces: Array<"web" | "ios" | "android">) => ({
  key,
  kind: "functional" as const,
  statement: `The system MUST do ${key}.`,
  acceptance: [`${key} passes`],
  surfaces,
});

const suite = (target: string, surface: "web" | "ios" | "android") => ({
  surface,
  dir: `features/contacts/acceptance/${target}/${surface}`,
  run: ["npm", "run", "acceptance"],
  browsers: surface === "web" ? [...MINIMUM_BROWSERS] : [],
  runner: surface === "ios" ? ("macos" as const) : ("linux" as const),
});

export function contract(): FeatureContract {
  return {
    schema: "wos-feature-contract.v1",
    feature: "contacts",
    version: 1,
    title: "Contacts",
    summary: "People and companies with search.",
    requirements: [req("R-001", ["web", "ios", "android"]), req("R-002", ["web"]), req("R-003", ["ios", "android"])],
    journeys: [
      { ...journey("J-001", "web"), requirements: ["R-001", "R-002"] },
      { ...journey("J-002", "ios", ["push"]), requirements: ["R-001", "R-003"] },
      { ...journey("J-003", "android"), requirements: ["R-001"] },
    ],
    sharedApi: "modules/contacts/api: typed client listContacts(query) used by web and mobile.",
    profiles: [
      {
        target: "acme-crm",
        requirements: ["R-001", "R-002", "R-003"],
        acceptance: [suite("acme-crm", "web"), suite("acme-crm", "ios"), suite("acme-crm", "android")],
      },
      { target: "other-crm", requirements: ["R-001", "R-002"], acceptance: [suite("other-crm", "web")] },
    ],
    impactedTargets: [],
    interfaces: { data: [], api: [], ui: [], events: [] },
    dependsOnFeatures: [],
    openQuestions: [],
    surfaces: {
      web: { required: true, capabilities: ["view_contact", "search_contacts"] },
      ios: { required: true, capabilities: ["view_contact", "call_contact"] },
      android: { required: true, capabilities: ["view_contact", "call_contact"] },
    },
  };
}

type Abu = BuildGraph["abus"][number];
const abu = (n: string, over: Partial<Abu>): Abu => ({
  repo: PRODUCT_REPO,
  key: `contacts#${n}`,
  title: `Unit ${n}`,
  objective: "Implement the unit described by its requirements.",
  requirements: ["R-001"],
  dependsOn: [],
  sizePoints: 3,
  scope: { write: [`modules/contacts/u${n}/**`], read: [] },
  resources: [],
  acceptance: { checks: [{ id: "test", run: ["npm", "test"] }], tests: [] },
  ...over,
});

export function graph(): BuildGraph {
  return {
    schema: "wos-build-graph.v1",
    feature: "contacts",
    contractVersion: 1,
    abus: [
      abu("01", {
        requirements: ["R-001"],
        scope: { write: ["modules/contacts/api/**", "apps/web/db/migrations/0007_contacts.sql"], read: [] },
        resources: [{ key: "db:migrations", mode: "exclusive" }],
        acceptance: { checks: [{ id: "test", run: ["npm", "test"] }], tests: ["modules/contacts/api/api.test.ts"] },
      }),
      abu("02", { requirements: ["R-002"], dependsOn: ["contacts#01"], scope: { write: ["modules/contacts/web/**"], read: [] } }),
      abu("03", { requirements: ["R-003"], dependsOn: ["contacts#01"], scope: { write: ["modules/contacts/mobile/**"], read: [] } }),
      abu("04", {
        requirements: ["R-003"],
        dependsOn: ["contacts#03"],
        scope: { write: ["modules/contacts/native/ios/**", "modules/contacts/native/package.json"], read: [] },
        resources: [{ key: "toolchain:modules/contacts/native/package.json", mode: "exclusive" }],
      }),
      abu("05", {
        requirements: ["R-001"],
        dependsOn: ["contacts#02", "contacts#04"],
        scope: { write: ["features/contacts/acceptance/**"], read: [] },
      }),
    ],
  };
}

/** A small, fixed estimate; tests override it for the budget case. */
export const estimate = () => 10_000;

// ---------------------------------------------------------------------------------------------
// Verdicts
// ---------------------------------------------------------------------------------------------

export const F1 = "0190f000-0000-7000-8000-0000000000f1";
export const F2 = "0190f000-0000-7000-8000-0000000000f2";

type Finding = ReviewVerdict["findings"][number];
export const finding = (localId: string, severity: "material" | "minor"): Finding => ({
  localId,
  severity,
  category: "missing_scope",
  title: `finding ${localId}`,
  detail: "detail",
  evidence: [],
  suggestedResolution: "",
});

export function verdict(findings: Finding[] = [], prior: Array<[string, "resolved" | "still_open"]> = []): ReviewVerdict {
  const priorFindings = prior.map(([findingId, status]) => ({ findingId, status, note: "" }));
  const gaps = findings.some((f) => f.severity === "material") || priorFindings.some((p) => p.status === "still_open");
  return { schema: "review-verdict.v1", verdict: gaps ? "MATERIAL_GAPS" : "NO_MATERIAL_GAPS", summary: "s", findings, priorFindings };
}
