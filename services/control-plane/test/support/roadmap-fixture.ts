/**
 * A valid roadmap revision for any target (the documents.test.ts fixture, parameterised), and the author's side of a
 * document revision driven through the API. Used by the first-run tests (D53 human seat, repository case, versions).
 */
import { expect } from "vitest";
import { type Account, type Harness, manifestFor, signedChangeset, signedRun } from "./harness.js";

const WHY = "Chosen against its siblings for size, user importance, complexity and share of the product's value.";

export interface RoadmapFixture {
  target: string;
  version?: number;
  feature?: string;
  /** How the surfaces name the product repository (GitHub's display case in the first-run tests). */
  repo?: string;
  /** Catalog keys this revision creates (default: the feature and import-engine). */
  newCatalogFeatures?: string[];
}

export function roadmapFiles(f: RoadmapFixture): Array<{ path: string; content: string }> {
  const feature = f.feature ?? "contacts";
  const repo = f.repo ?? "waronsaas/product";
  const newCatalog = f.newCatalogFeatures ?? [feature, "import-engine"];
  const inventory = {
    schema: "wos-inventory.v1",
    target: f.target,
    version: 1,
    sources: [{ title: "Vendor docs", url: "https://example.com/docs", retrievedOn: "2026-09-01" }],
    surfaces: [{ surface: "web", title: "Web app", source: 0, platforms: [], browsers: ["chromium", "firefox"] }],
    items: [
      { key: "INV-0001", area: "Core", title: "Records", description: "The core records", source: 0, weight: 1 },
      { key: "INV-0002", area: "Legacy", title: "Classic UI", description: "The retired interface", source: 0, weight: 1 },
    ],
  };
  const roadmap = {
    schema: "wos-roadmap.v1",
    target: f.target,
    version: f.version ?? 1,
    inventoryVersion: 1,
    productName: "OpenThing",
    summary: "An open-source replacement.",
    architecture: {
      overview: "Modules composed per app.",
      composition: "One module of the one suite (D14).",
      appSpecificData: "None yet.",
      selfHosting: "Docker.",
    },
    surfaces: [{ surface: "web", status: "in_scope", reason: null, repo, path: "apps/web" }],
    capabilities: [
      {
        key: "core",
        title: "Core",
        summary: "The core records",
        weightBp: 10000,
        weightRationale: WHY,
        inventoryItems: ["INV-0001"],
        features: [
          {
            feature,
            weightBp: 10000,
            weightRationale: WHY,
            surfaces: [{ surface: "web", weightBp: 10000, weightRationale: WHY }],
            journeys: [
              {
                key: "J-001",
                surface: "web",
                title: "Find a record",
                steps: ["Open the list", "Search by name"],
                entryPoints: ["navigation"],
                platformBehaviour: "none",
                nativeCapabilities: [],
              },
            ],
            inventoryItems: ["INV-0001"],
            appNotes: "The core records.",
            phase: "core",
          },
        ],
      },
    ],
    excluded: [{ item: "INV-0002", reason: "Retired by the vendor itself." }],
    newCatalogFeatures: newCatalog,
    proposals: [],
    migration: {
      engine: "import-engine",
      classes: ["records", "custom_objects_fields", "files_attachments", "history_activity", "users_permissions"].map((dataClass) => ({
        dataClass,
        connector: null,
        objects: [],
        extraction: null,
        deltaSync: null,
        notExtractable: [
          { item: `all ${dataClass}`, reason: "Test fixture: no connector is planned yet.", source: "https://example.com/export" },
        ],
      })),
    },
  };
  const entry = (key: string, title: string) => ({
    schema: "wos-catalog-entry.v1",
    key,
    title,
    summary: `The ${title} shared feature, for tests.`,
    aliasOf: null,
  });
  return [
    { path: `roadmaps/${f.target}/ROADMAP.yaml`, content: JSON.stringify(roadmap) },
    { path: `roadmaps/${f.target}/INVENTORY.yaml`, content: JSON.stringify(inventory) },
    ...newCatalog.map((k) => ({ path: `catalog/${k}.yaml`, content: JSON.stringify(entry(k, k)) })),
  ];
}

type Summary = {
  schema: "author-summary.v1";
  summary: string;
  responses: Array<{ findingId: string; action: "fixed" | "disputed"; note: string }>;
  proposalsAddressed: string[];
};

/** Claims an author task, builds its context, runs a signed (fake) agent run and submits the files. */
export async function authorRevision(
  h: Harness,
  acct: Account,
  taskId: string,
  files: Array<{ path: string; content: string }>,
  opts: {
    model?: string;
    summary?: Summary;
    launch?: { provider: string; baseUrl: string | null; identity: "self_reported" };
    run?: Record<string, unknown>;
  } = {},
) {
  const claim = await h.call("POST", `/v1/tasks/${taskId}/claim`, {
    token: acct.token,
    idem: true,
    body: { deviceId: acct.deviceId, ...(opts.model ? { model: opts.model } : {}), ...(opts.launch ? { launch: opts.launch } : {}) },
  });
  expect(claim.status, JSON.stringify(claim.body)).toBe(200);
  const plan = claim.body.contextPlan;
  const m = await manifestFor(h, plan, claim.body.task.kind);
  expect((await h.call("POST", `/v1/leases/${claim.body.lease.id}/manifest`, { token: acct.token, idem: true, body: m })).status).toBe(200);
  await h.call("POST", `/v1/leases/${claim.body.lease.id}/agent-runs`, {
    token: acct.token,
    idem: true,
    body: signedRun(acct.key, plan, claim.body.lease.id, acct.deviceId, m.manifestSha256, opts.run ?? {}),
  });
  const [doc] = await h.owner<{ head_sha: string | null }[]>`select head_sha from wos.documents where id = ${claim.body.task.documentId}`;
  const cs = signedChangeset(acct.key, {
    taskId,
    leaseId: claim.body.lease.id,
    deviceId: acct.deviceId,
    parentCommit: doc!.head_sha ?? plan.source.commit,
    manifestSha256: m.manifestSha256,
    files,
    summary: opts.summary ?? { schema: "author-summary.v1", summary: "Revision.", responses: [], proposalsAddressed: [] },
  });
  const res = await h.call("POST", `/v1/leases/${claim.body.lease.id}/changeset`, { token: acct.token, idem: true, body: cs });
  return { claim, plan, manifest: m, res };
}
