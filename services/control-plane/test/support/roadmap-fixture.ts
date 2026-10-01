/**
 * A valid roadmap revision for any target (the documents.test.ts fixture, parameterised), and the author's side of a
 * document revision driven through the API. Used by the first-run tests (D53 human seat, repository case, versions).
 */
import { AGENT_POLICY, type EnsembleRecord } from "@waronsaas/contracts";
import { defaultCatalogEntry } from "@waronsaas/planning";
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
  const method = AGENT_POLICY.roadmapMethod?.targets[f.target];
  // D73 (agent-policy.v4): capabilities follow the target's fixed template, one item per template capability (scanId =
  // the group's first scan id); targets without a scan get one sourced capability.
  const template = method?.template ?? [{ key: "core", title: "Core", group: "Core", scanIds: [] as string[] }];
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
      ...template.map((t, k) => ({
        key: `INV-${String(k + 1).padStart(4, "0")}`,
        area: t.title,
        title: k === 0 ? "Records" : `${t.title} records`,
        description: `The ${t.title} records`,
        source: 0,
        weight: 1,
        scanId: t.scanIds[0] ?? null,
      })),
      {
        key: `INV-${String(template.length + 1).padStart(4, "0")}`,
        area: "Legacy",
        title: "Classic UI",
        description: "The retired interface",
        source: 0,
        weight: 1,
        scanId: null,
      },
    ],
  };
  const score = (n: number, what: string) => ({ score: n, basis: `${what} (test fixture).` });
  const rubric = {
    editionBreadth: score(5, "Every edition"),
    coreDailyUse: score(5, "Used daily"),
    surfaceParity: score(3, "Web only"),
    migrationGravity: score(4, "Most records"),
  };
  // Every capability has the same scores, so the derived weights split 10000 evenly by largest remainder.
  const even = Array.from(
    { length: template.length },
    (_, k) => Math.floor(10_000 / template.length) + (k < 10_000 % template.length ? 1 : 0),
  );
  const journey = {
    key: "J-001",
    surface: "web",
    title: "Find a record",
    steps: ["Open the list", "Search by name"],
    entryPoints: ["navigation"],
    platformBehaviour: "none",
    nativeCapabilities: [],
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
    capabilities: template.map((t, k) => ({
      key: t.key,
      title: t.title,
      summary: `The ${t.title} capability`,
      weightBp: even[k]!,
      weightRationale: WHY,
      inventoryItems: [`INV-${String(k + 1).padStart(4, "0")}`],
      ...(t.scanIds.length > 0 ? { scanIds: t.scanIds } : { sources: ["https://example.com/docs"] }),
      rubric,
      features:
        k === 0
          ? [
              {
                feature,
                weightBp: 10000,
                weightRationale: WHY,
                surfaces: [{ surface: "web", weightBp: 10000, weightRationale: WHY }],
                journeys: [journey],
                inventoryItems: ["INV-0001"],
                appNotes: "The core records.",
                phase: "core",
              },
            ]
          : [],
    })),
    excluded: [{ item: `INV-${String(template.length + 1).padStart(4, "0")}`, reason: "Retired by the vendor itself." }],
    newCatalogFeatures: newCatalog,
    weightRubric: "wos-weight-rubric.v1",
    // D73: a feature that is not a vocabulary default is a catalog proposal the reviewers rule on.
    decisions: newCatalog
      .filter((k) => k !== "import-engine" && !(AGENT_POLICY.roadmapMethod?.vocabulary ?? []).some((v) => v.id === k))
      .map((k, n) => ({
        id: `DEC-${String(n + 1).padStart(3, "0")}`,
        kind: "catalog_proposal",
        subject: k,
        summary: `The ${k} catalog feature, proposed by this roadmap (test fixture).`,
        options: [],
        chosen: "proposed",
      })),
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
  // D73: a vocabulary id's catalog file is its default entry; other keys get a test entry.
  const vocab = AGENT_POLICY.roadmapMethod?.vocabulary ?? [];
  const entry = (key: string, title: string) => {
    const v = vocab.find((x) => x.id === key);
    return v
      ? defaultCatalogEntry(v)
      : { schema: "wos-catalog-entry.v1", key, title, summary: `The ${title} shared feature, for tests.`, aliasOf: null };
  };
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
  /** D73: an ensemble revision's provenance and stability. */
  ensemble?: EnsembleRecord;
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
    summary: {
      ensemble: null,
      ...(opts.summary ?? { schema: "author-summary.v1", summary: "Revision.", responses: [], proposalsAddressed: [] }),
    },
  });
  const res = await h.call("POST", `/v1/leases/${claim.body.lease.id}/changeset`, { token: acct.token, idem: true, body: cs });
  return { claim, plan, manifest: m, res };
}
