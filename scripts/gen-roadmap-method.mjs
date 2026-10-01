// D72 (contracts 5.19.0): writes the roadmap method data of agent-policy.v3 from the scans. Deterministic.
//   node scripts/gen-roadmap-method.mjs           regenerate `roadmapMethod` of agent-policy.v3 (method v1) and v4 (method v2)
//   node scripts/gen-roadmap-method.mjs --check   fail if it is stale
// Per target (docs/scans/<target>.json):
//   scanCapabilityIds  every capability id of the scan, in scan order;
//   requiredReading    derived, deduplicated, at most one per kind:
//     editions_pricing  the most-cited capability source whose URL contains "pricing" or "editions";
//     feature_docs      the most-cited capability source that is neither editions_pricing nor an app store listing
//                       (ties: lexical order);
//     app_store         the first client-app source on apps.apple.com;  google_play: the first on play.google.com;
//     api_docs          the scan's first API source;
//     export_api        the first source of a dataExport API of kind bulk-export, else of the first export option;
//   partition          the scan's ids grouped by vocabulary group (a group larger than ceil(ids / 4) is split into
//                      consecutive parts of at most that size); groups sorted by size (desc) then name, each given to the
//                      helper (1..4) holding the fewest ids so far (ties: the lowest helper number).
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const check = process.argv.includes("--check");
const policyPath = `${root}packages/contracts/src/data/agent-policy.v3.json`;
const vocab = JSON.parse(readFileSync(`${root}docs/scans/vocabulary.json`, "utf8"));
const groupOf = new Map(vocab.capabilities.map((c) => [c.id, c.group]));
const TARGETS = ["salesforce", "hubspot", "slack", "zoom", "shopify", "quickbooks", "jira", "zendesk", "docusign", "netsuite"];
const HELPERS = 4;

const mostCited = (urls) => {
  const n = new Map();
  for (const u of urls) n.set(u, (n.get(u) ?? 0) + 1);
  return [...n].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)).map(([u]) => u);
};

function method(slug) {
  const scan = JSON.parse(readFileSync(`${root}docs/scans/${slug}.json`, "utf8"));
  const ids = scan.capabilities.map((c) => c.id);
  const capSources = scan.capabilities.flatMap((c) => c.sources);
  const ranked = mostCited(capSources);
  const reading = [];
  const add = (kind, url) => {
    if (url && !reading.some((r) => r.url === url)) reading.push({ kind, url });
  };
  const pricing = ranked.find((u) => /pricing|editions/i.test(u));
  add("editions_pricing", pricing);
  const store = (u) => ["apps.apple.com", "play.google.com"].includes(new URL(u).hostname);
  add(
    "feature_docs",
    ranked.find((u) => u !== pricing && !store(u)),
  );
  const appSources = scan.clientApps.flatMap((a) => a.sources);
  add(
    "app_store",
    appSources.find((u) => new URL(u).hostname === "apps.apple.com"),
  );
  add(
    "google_play",
    appSources.find((u) => new URL(u).hostname === "play.google.com"),
  );
  add("api_docs", scan.api.sources[0]);
  const bulk = scan.dataExport.apis.find((a) => a.kind === "bulk-export");
  add("export_api", bulk?.sources[0] ?? scan.dataExport.exportOptions[0]?.sources[0]);
  const groups = new Map();
  for (const id of ids) {
    const g = groupOf.get(id) ?? "Other";
    groups.set(g, [...(groups.get(g) ?? []), id]);
  }
  // A group larger than a fair share (ceil(ids / helpers)) is split into consecutive parts of at most that size.
  const share = Math.ceil(ids.length / HELPERS);
  for (const [g, gIds] of [...groups]) {
    if (gIds.length <= share) continue;
    groups.delete(g);
    for (let i = 0; i * share < gIds.length; i++) groups.set(`${g} (part ${i + 1})`, gIds.slice(i * share, (i + 1) * share));
  }
  const order = [...groups].sort((a, b) => b[1].length - a[1].length || (a[0] < b[0] ? -1 : 1));
  const helpers = Array.from({ length: HELPERS }, (_, i) => ({ helper: i + 1, groups: [], scanIds: [] }));
  for (const [g, gIds] of order) {
    const h = [...helpers].sort((a, b) => a.scanIds.length - b.scanIds.length || a.helper - b.helper)[0];
    h.groups.push(g);
    h.scanIds.push(...gIds);
  }
  return { scanCapabilityIds: ids, requiredReading: reading, partition: helpers.filter((h) => h.scanIds.length > 0) };
}

// D73 (agent-policy.v4, method v2): the fixed capability template (one capability per vocabulary group the scan uses,
// in vocabulary order, key = the group in kebab case), every URL the scan cites (the grounding allowlist besides the
// run's fetch log), and the vocabulary itself (every id is a default catalog feature).
const groupOrder = [...new Set(vocab.capabilities.map((c) => c.group))];
const kebab = (g) =>
  g
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
function methodV2(slug) {
  const scan = JSON.parse(readFileSync(`${root}docs/scans/${slug}.json`, "utf8"));
  const ids = scan.capabilities.map((c) => c.id);
  const template = groupOrder
    .map((g) => ({ key: kebab(g), title: g, group: g, scanIds: ids.filter((id) => groupOf.get(id) === g) }))
    .filter((t) => t.scanIds.length > 0);
  const urls = new Set();
  const walk = (v) => {
    if (typeof v === "string" && /^https?:\/\//.test(v)) urls.add(v);
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") Object.values(v).forEach(walk);
  };
  walk(scan);
  return { ...method(slug), template, scanSources: [...urls].sort() };
}

const files = [
  { path: policyPath, targets: Object.fromEntries(TARGETS.map((t) => [t, method(t)])), vocabulary: undefined },
  {
    path: `${root}packages/contracts/src/data/agent-policy.v4.json`,
    targets: Object.fromEntries(TARGETS.map((t) => [t, methodV2(t)])),
    vocabulary: vocab.capabilities.map((c) => ({ id: c.id, group: c.group, definition: c.definition })),
  },
];
let stale = false;
for (const f of files) {
  const policy = JSON.parse(readFileSync(f.path, "utf8"));
  const want = { targets: f.targets, vocabulary: f.vocabulary };
  const have = { targets: policy.roadmapMethod?.targets ?? null, vocabulary: policy.roadmapMethod?.vocabulary };
  if (check) {
    if (JSON.stringify(have) !== JSON.stringify(want)) {
      console.error(`${f.path}: roadmapMethod is stale: run node scripts/gen-roadmap-method.mjs`);
      stale = true;
    }
    continue;
  }
  policy.roadmapMethod = { ...policy.roadmapMethod, targets: f.targets, ...(f.vocabulary ? { vocabulary: f.vocabulary } : {}) };
  writeFileSync(f.path, `${JSON.stringify(policy, null, 2)}\n`);
  console.log(`wrote roadmapMethod for ${TARGETS.length} targets into ${f.path}`);
}
if (stale) process.exit(1);
