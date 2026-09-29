/**
 * Canonical documents end to end (ROADMAP-PROTOCOL.md sections 3 and 5, FEATURE-CONTRACT.md section 7):
 * author revision -> validation -> round -> consensus -> merge -> materialisation / ingestion -> progress.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEFAULT_LOGIC } from "../src/deps.js";
import { reviewAs } from "./support/flow.js";
import {
  type Account,
  BASE_SHA,
  CRON_SECRET,
  createHarness,
  HAS_DB,
  type Harness,
  manifestFor,
  signedChangeset,
  signedRun,
  verdict,
  webhookHeaders,
} from "./support/harness.js";

const WHY = "Chosen against its siblings for size, user importance, complexity and share of the product's value.";

const inventory = {
  schema: "wos-inventory.v1",
  target: "salesforce",
  version: 1,
  sources: [{ title: "Vendor docs", url: "https://example.com/docs", retrievedOn: "2026-09-01" }],
  // contracts 4.0.0 (D13) fixture update by the architect: surfaces are required.
  surfaces: [
    { surface: "web", title: "Web app", source: 0, platforms: [], browsers: ["chromium", "firefox"] },
    { surface: "ios", title: "iPhone app", source: 0, platforms: ["iPhone"], browsers: [] },
  ],
  items: [
    { key: "INV-0001", area: "Sales", title: "Contacts", description: "Contact records", source: 0, weight: 1 },
    { key: "INV-0002", area: "Analytics", title: "Reports", description: "Reports and dashboards", source: 0, weight: 1 },
    { key: "INV-0003", area: "Legacy", title: "Classic UI", description: "The retired interface", source: 0, weight: 1 },
  ],
};
const roadmap = (crmWeight: number) => ({
  schema: "wos-roadmap.v1",
  target: "salesforce",
  version: 1,
  inventoryVersion: 1,
  productName: "OpenCRM",
  summary: "An open-source CRM.",
  architecture: {
    overview: "Modules composed per app.",
    composition: "Contacts module of the one suite (D14).",
    appSpecificData: "None yet.",
    selfHosting: "Docker.",
  },
  surfaces: [
    { surface: "web", status: "in_scope", reason: null, repo: "waronsaas/product", path: "apps/web" },
    { surface: "ios", status: "in_scope", reason: null, repo: "waronsaas/product", path: "apps/mobile" },
  ],
  capabilities: [
    {
      key: "crm",
      title: "CRM",
      summary: "Customer records",
      weightBp: crmWeight,
      weightRationale: WHY,
      inventoryItems: ["INV-0001"],
      features: [
        {
          feature: "contacts",
          weightBp: 10000,
          weightRationale: WHY,
          surfaces: [
            { surface: "web", weightBp: 6000, weightRationale: WHY },
            { surface: "ios", weightBp: 4000, weightRationale: WHY },
          ],
          journeys: [
            {
              key: "J-002",
              surface: "ios",
              title: "Call a contact",
              steps: ["Open Contacts", "Tap a contact", "Tap call"],
              entryPoints: ["tab bar"],
              platformBehaviour: "native navigation and swipe back",
              nativeCapabilities: [],
            },
            {
              key: "J-001",
              surface: "web",
              title: "Find a contact",
              steps: ["Open Contacts", "Search by name"],
              entryPoints: ["navigation"],
              platformBehaviour: "none",
              nativeCapabilities: [],
            },
          ],
          inventoryItems: ["INV-0001"],
          appNotes: "Accounts and people.",
          phase: "core",
        },
      ],
    },
    {
      key: "analytics",
      title: "Analytics",
      summary: "Reports",
      weightBp: 3000,
      weightRationale: WHY,
      inventoryItems: ["INV-0002"],
      features: [],
    },
  ],
  excluded: [{ item: "INV-0003", reason: "Retired by the vendor itself." }],
  newCatalogFeatures: ["contacts"],
  proposals: [],
});
const catalogEntry = {
  schema: "wos-catalog-entry.v1",
  key: "contacts",
  title: "Contacts",
  summary: "People and companies you work with.",
  aliasOf: null,
};
const contract = {
  schema: "wos-feature-contract.v1",
  feature: "contacts",
  version: 1,
  title: "Contacts",
  summary: "People and companies.",
  requirements: [
    {
      key: "R-001",
      kind: "functional",
      statement: "Users MUST be able to list contacts.",
      acceptance: ["the list shows every contact"],
      surfaces: ["web", "ios"],
    },
    {
      key: "R-002",
      kind: "functional",
      statement: "Users MUST be able to open one contact.",
      acceptance: ["the detail shows the contact"],
      surfaces: ["web"],
    },
  ],
  journeys: [
    {
      key: "J-001",
      surface: "web",
      title: "Find a contact",
      steps: ["Open Contacts", "Search by name"],
      entryPoints: ["navigation"],
      platformBehaviour: "none",
      nativeCapabilities: [],
      requirements: ["R-001", "R-002"],
    },
    {
      key: "J-002",
      surface: "ios",
      title: "Call a contact",
      steps: ["Open Contacts", "Tap a contact", "Tap call"],
      entryPoints: ["tab bar"],
      platformBehaviour: "native navigation and swipe back",
      nativeCapabilities: [],
      requirements: ["R-001"],
    },
  ],
  sharedApi: "modules/contacts exports listContacts() and getContact(id), typed, consumed by web and iOS.",
  profiles: [
    {
      target: "salesforce",
      requirements: ["R-001", "R-002"],
      acceptance: [
        {
          surface: "web",
          dir: "features/contacts/acceptance/salesforce",
          run: ["npm", "test"],
          browsers: ["chromium", "edge", "webkit", "firefox", "mobile_safari", "mobile_chrome"],
          runner: "linux",
        },
        { surface: "ios", dir: "features/contacts/acceptance/salesforce-ios", run: ["maestro", "test"], browsers: [], runner: "macos" },
      ],
    },
  ],
  impactedTargets: [],
  interfaces: {},
  dependsOnFeatures: [],
  openQuestions: [],
};
const unit = (n: string, req: string, write: string, deps: string[], size: number) => ({
  repo: "waronsaas/product",
  key: `contacts#${n}`,
  title: `Unit ${n}`,
  objective: "Build this unit so that its acceptance checks pass.",
  requirements: [req],
  dependsOn: deps,
  sizePoints: size,
  scope: { write: [write], read: [] },
  resources: [],
  acceptance: { checks: [{ id: "t", run: ["npm", "test"] }], tests: [] },
});
const graph = {
  schema: "wos-build-graph.v1",
  feature: "contacts",
  contractVersion: 1,
  abus: [unit("01", "R-001", "modules/contacts/list/**", [], 2), unit("02", "R-002", "modules/contacts/detail/**", ["contacts#01"], 3)],
};

const buildGraphContexts: unknown[] = [];

describe.skipIf(!HAS_DB)("roadmap and feature contract workflows", () => {
  let h: Harness;
  let maint: Account;
  beforeAll(async () => {
    h = await createHarness({
      validateBuildGraph: (...args) => {
        buildGraphContexts.push(args[5]);
        return DEFAULT_LOGIC.validateBuildGraph(...args);
      },
    });
    maint = await h.contributor("doc-maint", { maintainer: true });
  });
  afterAll(async () => {
    await h?.close();
  });

  const author = async (acct: Account, taskId: string, files: Array<{ path: string; content: string }>) => {
    const claim = await h.call("POST", `/v1/tasks/${taskId}/claim`, { token: acct.token, idem: true, body: { deviceId: acct.deviceId } });
    expect(claim.status, JSON.stringify(claim.body)).toBe(200);
    const plan = claim.body.contextPlan;
    const kind = claim.body.task.kind;
    const m = await manifestFor(h, plan, kind);
    expect((await h.call("POST", `/v1/leases/${claim.body.lease.id}/manifest`, { token: acct.token, idem: true, body: m })).status).toBe(
      200,
    );
    await h.call("POST", `/v1/leases/${claim.body.lease.id}/agent-runs`, {
      token: acct.token,
      idem: true,
      body: signedRun(acct.key, plan, claim.body.lease.id, acct.deviceId, m.manifestSha256),
    });
    const [doc] = await h.owner<{ head_sha: string | null }[]>`select head_sha from wos.documents where id = ${claim.body.task.documentId}`;
    const cs = signedChangeset(acct.key, {
      taskId,
      leaseId: claim.body.lease.id,
      deviceId: acct.deviceId,
      parentCommit: doc!.head_sha ?? plan.source.commit,
      manifestSha256: m.manifestSha256,
      files,
      summary: { schema: "author-summary.v1", summary: "Revision.", responses: [], proposalsAddressed: [] },
    });
    return h.call("POST", `/v1/leases/${claim.body.lease.id}/changeset`, { token: acct.token, idem: true, body: cs });
  };
  const dispatch = () => h.call("GET", "/v1/cron/dispatch", { headers: { authorization: `Bearer ${CRON_SECRET}` } });

  it("materialises a merged roadmap (D11) and ingests the merged contract, with progress at every step", async () => {
    const opened = await h.call("POST", "/v1/admin/targets/salesforce/roadmaps", {
      token: maint.token,
      idem: true,
      body: { reason: "First roadmap" },
    });
    expect(opened.status).toBe(200);
    const again = await h.call("POST", "/v1/admin/targets/salesforce/roadmaps", {
      token: maint.token,
      idem: true,
      body: { reason: "Second one" },
    });
    expect(again.body.error.code).toBe("CONFLICT"); // ONE canonical open roadmap per app
    const writer = await h.contributor("roadmap-writer");
    const files = (crmWeight: number) => [
      { path: "roadmaps/salesforce/ROADMAP.yaml", content: JSON.stringify(roadmap(crmWeight)) },
      { path: "roadmaps/salesforce/INVENTORY.yaml", content: JSON.stringify(inventory) },
      { path: "catalog/contacts.yaml", content: JSON.stringify(catalogEntry) },
    ];

    // A path outside the document's allowed paths is refused before anything is committed (422, lease kept).
    const probe = await h.call("POST", `/v1/tasks/${opened.body.taskId}/claim`, {
      token: writer.token,
      idem: true,
      body: { deviceId: writer.deviceId },
    });
    const pm = await manifestFor(h, probe.body.contextPlan, "roadmap_author");
    await h.call("POST", `/v1/leases/${probe.body.lease.id}/manifest`, { token: writer.token, idem: true, body: pm });
    const evil = signedChangeset(writer.key, {
      taskId: opened.body.taskId,
      leaseId: probe.body.lease.id,
      deviceId: writer.deviceId,
      parentCommit: probe.body.contextPlan.source.commit,
      manifestSha256: pm.manifestSha256,
      files: [{ path: "modules/contacts/evil.ts", content: "x" }],
      summary: { schema: "author-summary.v1", summary: "Sneaky.", responses: [], proposalsAddressed: [] },
    });
    const refused = await h.call("POST", `/v1/leases/${probe.body.lease.id}/changeset`, { token: writer.token, idem: true, body: evil });
    expect(refused.status).toBe(422);
    expect(refused.body.error.code).toBe("SCOPE_VIOLATION");
    expect(h.github.commits).toHaveLength(0);
    const [still] = await h.owner<{ state: string }[]>`select state from wos.documents where id = ${opened.body.documentId}`;
    expect(still!.state).toBe("drafting");
    await h.call("POST", `/v1/leases/${probe.body.lease.id}/release`, { token: writer.token, idem: true, body: { reason: "retry" } });

    // Invalid weights (D12 sums): validation_failed -> revising, errors carried to a new author task.
    const bad = await author(writer, opened.body.taskId, files(6000));
    expect(bad.status, JSON.stringify(bad.body)).toBe(200);
    const [d1] = await h.owner<
      { state: string; round_number: number }[]
    >`select state, round_number from wos.documents where id = ${opened.body.documentId}`;
    expect(d1).toEqual({ state: "revising", round_number: 0 });
    const [carry] = await h.owner<{ id: string; carry: { validatorErrors: unknown[] } }[]>`
      select id, carry from wos.tasks where document_id = ${opened.body.documentId} and kind = 'roadmap_author' and state = 'open'`;
    expect(carry!.carry.validatorErrors.length).toBeGreaterThan(0);

    // Valid revision: round 1 opens with one task per slot; the author is excluded from both.
    const good = await author(writer, carry!.id, files(7000));
    expect(good.status).toBe(200);
    const [d2] = await h.owner<
      { state: string; round_number: number; head_sha: string }[]
    >`select state, round_number, head_sha from wos.documents where id = ${opened.body.documentId}`;
    expect(d2!.state).toBe("in_review");
    expect(d2!.round_number).toBe(1);
    const reviewTasks = await h.owner<
      { excluded_account_ids: string[] }[]
    >`select excluded_account_ids from wos.tasks where document_id = ${opened.body.documentId} and kind = 'roadmap_review'`;
    expect(reviewTasks).toHaveLength(2);
    for (const t of reviewTasks) expect(t.excluded_account_ids).toContain(writer.id);
    await dispatch();
    const draft = h.github.prs.find((p) => p.title === "salesforce Replacement Roadmap" || p.title === "OpenCRM Replacement Roadmap")!;
    expect(draft.draft).toBe(true);

    const selfReview = await h.call("POST", "/v1/reviews/claim", {
      token: writer.token,
      idem: true,
      body: { deviceId: writer.deviceId, slot: "astra", kinds: ["roadmap_review"] },
    });
    expect(selfReview.body).toBeNull(); // the author is never assigned their own subject
    await reviewAs(h, await h.contributor("rm-astra"), "astra", "roadmap_review", verdict("NO_MATERIAL_GAPS"));
    await reviewAs(h, await h.contributor("rm-fable"), "fable", "roadmap_review", verdict("NO_MATERIAL_GAPS"));
    const [d3] = await h.owner<{ state: string }[]>`select state from wos.documents where id = ${opened.body.documentId}`;
    expect(d3!.state).toBe("consensus");
    await dispatch();
    expect(h.github.statuses.some((s) => s.context === "wos/consensus" && s.sha === d2!.head_sha)).toBe(true);

    // Merge -> materialisation.
    const merged = {
      action: "closed",
      repository: { full_name: "waronsaas/product" },
      pull_request: { number: draft.number, merged: true, merge_commit_sha: d2!.head_sha },
    };
    expect((await h.call("POST", "/v1/github/webhook", { body: merged, headers: webhookHeaders("pull_request", merged) })).status).toBe(
      200,
    );
    // D13 materialisation: both surfaces, the feature's surface weights and journeys.
    const ts = await h.owner<{ surface: string; status: string; path: string }[]>`
      select s.surface, s.status, s.path from wos.target_surfaces s join wos.targets t on t.id = s.target_id where t.slug = 'salesforce' order by s.surface`;
    expect(ts).toEqual([
      { surface: "ios", status: "in_scope", path: "apps/mobile" },
      { surface: "web", status: "in_scope", path: "apps/web" },
    ]);
    const afs = await h.owner<{ surface: string; weight_bp: number }[]>`
      select s.surface, s.weight_bp from wos.app_feature_surfaces s join wos.app_features af on af.id = s.app_feature_id
        join wos.catalog_features f on f.id = af.catalog_feature_id where f.key = 'contacts' order by s.surface`;
    expect(afs).toEqual([
      { surface: "ios", weight_bp: 4000 },
      { surface: "web", weight_bp: 6000 },
    ]);
    const [jr] = await h.owner<
      { n: number }[]
    >`select jsonb_array_length(af.journeys) as n from wos.app_features af join wos.catalog_features f on f.id = af.catalog_feature_id where f.key = 'contacts'`;
    expect(jr!.n).toBe(2);
    const target = await h.call("GET", "/v1/public/targets/salesforce");
    expect(target.body.productName).toBe("OpenCRM");
    expect(target.body.progress).toMatchObject({
      mappedBp: 7000,
      specifiedBp: 0,
      builtBp: 0,
      roadmapVersion: 1,
      inventoryItems: 3,
      excludedItems: 1,
    });
    expect(target.body.capabilities.map((c: { key: string; mapped: boolean }) => [c.key, c.mapped])).toEqual([
      ["crm", true],
      ["analytics", false],
    ]);
    expect(target.body.excluded).toEqual([{ item: "INV-0003", title: "Classic UI", reason: "Retired by the vendor itself." }]);
    const feature = target.body.capabilities[0].features[0];
    expect(feature).toMatchObject({ key: "contacts", state: "specifying", weightBp: 10000, effectiveAppWeightBp: 7000 });
    expect(feature.contract).toMatchObject({ kind: "feature_contract", version: 1, state: "drafting" });
    const catalog = await h.call("GET", "/v1/public/catalog");
    expect(catalog.body.items.map((i: { key: string }) => i.key)).toContain("contacts");

    // The contract workflow that the merge opened: author, validate, review, merge, ingest.
    const [ft] = await h.owner<{ id: string }[]>`select t.id from wos.tasks t join wos.documents d on d.id = t.document_id
                                                 where d.kind = 'feature_contract' and t.kind = 'feature_author' and t.state = 'open'`;
    const contractWriter = await h.contributor("contract-writer");
    const submitted = await author(contractWriter, ft!.id, [
      { path: "features/contacts/CONTRACT.yaml", content: JSON.stringify(contract) },
      { path: "features/contacts/BUILD-GRAPH.yaml", content: JSON.stringify(graph) },
    ]);
    expect(submitted.status, JSON.stringify(submitted.body)).toBe(200);
    const carries = await h.owner<
      { carry: unknown }[]
    >`select carry from wos.tasks where kind = 'feature_author' and carry ? 'validatorErrors'`;
    expect(carries.map((c) => c.carry)).toEqual([]);
    await reviewAs(h, await h.contributor("fc-astra"), "astra", "feature_review", verdict("NO_MATERIAL_GAPS"));
    await reviewAs(h, await h.contributor("fc-fable"), "fable", "feature_review", verdict("NO_MATERIAL_GAPS"));
    await dispatch();
    const contractPr = h.github.prs.find((p) => p.title === "contacts Feature Contract")!;
    const [cd] = await h.owner<
      { id: string; head_sha: string; state: string }[]
    >`select id, head_sha, state from wos.documents where kind = 'feature_contract'`;
    expect(cd!.state).toBe("consensus");
    const mergedContract = {
      action: "closed",
      repository: { full_name: "waronsaas/product" },
      pull_request: { number: contractPr.number, merged: true, merge_commit_sha: cd!.head_sha },
    };
    await h.call("POST", "/v1/github/webhook", { body: mergedContract, headers: webhookHeaders("pull_request", mergedContract) });
    const abus = await h.owner<{ key: string; state: string; task: string }[]>`
      select a.key, a.state, t.state as task from wos.abus a join wos.tasks t on t.abu_id = a.id and t.kind = 'abu_build' order by a.key`;
    expect(abus).toEqual([
      { key: "contacts#01", state: "ready", task: "open" },
      { key: "contacts#02", state: "pending_dependencies", task: "blocked" },
    ]);
    const rs = await h.owner<{ key: string; surfaces: string[] }[]>`
      select r.key, array_agg(s.surface order by s.surface) as surfaces from wos.requirements r join wos.requirement_surfaces s on s.requirement_id = r.id
       group by r.key order by r.key`;
    expect(rs).toEqual([
      { key: "R-001", surfaces: ["ios", "web"] },
      { key: "R-002", surfaces: ["web"] },
    ]);
    // validateBuildGraph got the ratified sixth argument (FEATURE-CONTRACT.md section 9).
    const ctx = buildGraphContexts.at(-1) as {
      repositories: Map<string, string>;
      contractRepo: string;
      surfacesInScope: Map<string, string[]>;
    };
    expect(ctx.contractRepo).toBe("waronsaas/product");
    expect(ctx.repositories.get("waronsaas/product")).toBe("product");
    expect(ctx.repositories.get("waronsaas/wos")).toBe("platform");
    expect(ctx.surfacesInScope.get("salesforce")).toEqual(["ios", "web"]);
    // Document pool: the contract author's feature_contract_work share was written by the real rules.
    const pool = await h.owner<{ category: string; amount: string }[]>`
      select category, amount from wos.ledger_entries where category in ('roadmap_work', 'feature_contract_work') order by category`;
    expect(pool.map((p) => [p.category, Number(p.amount)])).toEqual([
      ["feature_contract_work", h.deps.schedule.featureContract.mergedContractPool],
      ["roadmap_work", h.deps.schedule.roadmap.mergedRoadmapPool],
    ]);
    const after = await h.call("GET", "/v1/public/targets/salesforce/features/contacts");
    expect(after.body).toMatchObject({ state: "specified", specifiedBp: 10000, builtBp: 0, relevantPoints: 5, mergedPoints: 0 });
    expect(after.body.requirements.map((r: { key: string }) => r.key)).toEqual(["R-001", "R-002"]);
    const t2 = await h.call("GET", "/v1/public/targets/salesforce");
    expect(t2.body.progress).toMatchObject({ mappedBp: 7000, specifiedBp: 7000, builtBp: 0 });
    const history = await h.call("GET", "/v1/public/targets/salesforce/progress");
    expect(history.body.items.length).toBeGreaterThanOrEqual(2);
    // Replaying the same merge delivery changes nothing (dedupe by X-GitHub-Delivery and the consensus guard).
    const before = await h.owner<{ n: number }[]>`select count(*)::int as n from wos.events`;
    await h.call("POST", "/v1/github/webhook", { body: mergedContract, headers: webhookHeaders("pull_request", mergedContract) });
    const afterReplay = await h.owner<{ n: number }[]>`select count(*)::int as n from wos.events`;
    expect(afterReplay[0]!.n).toBe(before[0]!.n);
    expect(BASE_SHA).toHaveLength(40);
    expect(h.violations).toEqual([]);
  });
});
