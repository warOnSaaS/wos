/**
 * Renders the human-readable scan files from the JSON sources. Deterministic: no network, no clock.
 *
 *   node tools/scans/build.ts           # write docs/scans/*.md, overlap.json, OVERLAP.md, VOCABULARY.md
 *   node tools/scans/build.ts --check   # exit 1 if any generated file is stale or any JSON is invalid
 *
 * Sources of truth: docs/scans/vocabulary.json and docs/scans/<slug>.json. Everything else is generated.
 */
import { execFileSync } from "node:child_process";
import { isDeepStrictEqual } from "node:util";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { type Capability, computeOverlap, crossCheck, type Overlap, SCAN_LABEL, Scan, TARGETS, Vocabulary } from "./schema.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const DIR = join(ROOT, "docs", "scans");

const BANNER = `> **${SCAN_LABEL}.** A short, shallow table of contents of a public product surface, written from public sources only. It is not a roadmap: no build units, weights, budgets or progress. It has not been reviewed and it counts toward no progress percentage. Roadmap v1 for the target starts from its scan and supersedes it.`;

const cell = (s: string) => s.replace(/\|/g, "\\|").replace(/\n/g, " ");
const links = (urls: string[]) => urls.map((u, i) => `[${i + 1}](${u})`).join(" ");

function tier(c: Capability): string {
  const t = c.lowestTier ?? "not stated";
  return c.tierNote ? `${t} (${c.tierNote})` : t;
}

export function renderScan(s: Scan, v: Vocabulary): string {
  const groupOf = new Map(v.capabilities.map((c) => [c.id, c.group]));
  const unconfirmed = s.capabilities.filter((c) => c.status === "unconfirmed").length;
  const out: string[] = [];
  out.push(`# ${s.target.name} (${s.target.id}): scan`, "", BANNER, "");
  out.push(
    `${s.capabilities.length} capability areas (${s.capabilities.length - unconfirmed} confirmed from sources, ${unconfirmed} unconfirmed). Generated from \`${s.target.slug}.json\` by \`tools/scans/build.ts\`; edit the JSON, not this file.`,
    "",
  );
  out.push("## Scope", "", s.scope.included, "");
  if (s.scope.excluded.length) {
    out.push("Left out of this scan:", "");
    for (const e of s.scope.excluded) out.push(`- ${e}`);
    out.push("");
  }
  out.push("## The product's own client apps", "", "| Surface | App | Platforms | Sources |", "|---|---|---|---|");
  for (const a of s.clientApps) out.push(`| ${a.surface} | ${cell(a.name)} | ${cell(a.platforms ?? "not stated")} | ${links(a.sources)} |`);
  out.push("", "## Public API", "", `**Style:** ${s.api.style}`, "", s.api.notes, "", `Sources: ${links(s.api.sources)}`, "");
  out.push(
    "## Capability areas",
    "",
    "Ids are from the shared vocabulary (`VOCABULARY.md`). Surfaces list only what public sources showed. Lowest tier is the lowest plan or edition a public page states includes it.",
    "",
    "| Id | Group | Vendor's name | What it does here | Surfaces | Lowest tier | Sources |",
    "|---|---|---|---|---|---|---|",
  );
  for (const c of s.capabilities) {
    const what = c.status === "unconfirmed" ? `**Unconfirmed** (${c.unconfirmedReason}). ${c.description}` : c.description;
    out.push(
      `| \`${c.id}\` | ${groupOf.get(c.id) ?? ""} | ${cell(c.vendorName)} | ${cell(what)} | ${c.surfaces.join(", ") || "not shown"} | ${cell(tier(c))} | ${links(c.sources)} |`,
    );
  }
  out.push("", ...renderDataExport(s));
  out.push("## Limits of this scan", "");
  if (s.limits.length) for (const l of s.limits) out.push(`- ${l}`);
  else out.push("- None recorded.");
  out.push("", "## Search and fetch failures", "");
  if (s.failures.length) {
    out.push("| Kind | What | Result |", "|---|---|---|");
    for (const f of s.failures) out.push(`| ${f.kind} | ${cell(f.what)} | ${cell(f.result)} |`);
  } else out.push("None recorded.");
  out.push("");
  return out.join("\n");
}

function renderDataExport(s: Scan): string[] {
  const d = s.dataExport;
  const out: string[] = [];
  out.push(
    "## Getting data out",
    "",
    "How a customer gets their data out of this product, from public sources: facts for a future shared import engine, not a design.",
    "",
    `| Full extraction | Incremental (delta) | By API |`,
    "|---|---|---|",
    `| ${d.extraction.full} | ${d.extraction.incremental} | ${d.extraction.apiBased} |`,
    "",
    d.extraction.note,
    "",
    "### Export options",
    "",
  );
  if (d.exportOptions.length) {
    out.push("| Export | What it exports | Formats | Limits | Lowest tier | Sources |", "|---|---|---|---|---|---|");
    for (const e of d.exportOptions)
      out.push(
        `| ${cell(e.name)} | ${cell(e.description)} | ${cell(e.formats.join(", ") || "not stated")} | ${cell(e.limits ?? "not stated")} | ${cell(e.lowestTier ?? "not stated")} | ${links(e.sources)} |`,
      );
  } else out.push("None found in public sources.");
  out.push("", "### Bulk, incremental and event APIs", "");
  if (d.apis.length) {
    out.push("| API | Kind | What it gives an importer | Sources |", "|---|---|---|---|");
    for (const a of d.apis) out.push(`| ${cell(a.name)} | ${a.kind} | ${cell(a.description)} | ${links(a.sources)} |`);
  } else out.push("None found in public sources.");
  out.push(
    "",
    "### Auth for a third-party importer",
    "",
    `**Models:** ${d.auth.models.join(", ")}`,
    "",
    d.auth.notes,
    "",
    `Sources: ${links(d.auth.sources)}`,
  );
  out.push("", "### Rate limits and quotas", "", d.rateLimits.summary ?? "Not stated in the public sources checked.");
  if (d.rateLimits.sources.length) out.push("", `Sources: ${links(d.rateLimits.sources)}`);
  out.push("", "### Hard to get out", "");
  if (d.hardToExtract.length) {
    out.push("| Data class | Detail | Sources |", "|---|---|---|");
    for (const h of d.hardToExtract) out.push(`| ${h.dataClass} | ${cell(h.detail)} | ${links(h.sources)} |`);
  } else out.push("Nothing recorded.");
  out.push("", "### Migration tools and importers the vendor documents", "");
  if (d.migrationTools.length) {
    out.push("| Tool | Direction | What it does | Sources |", "|---|---|---|---|");
    for (const m of d.migrationTools) out.push(`| ${cell(m.name)} | ${m.direction} | ${cell(m.description)} | ${links(m.sources)} |`);
  } else out.push("None found in public sources.");
  out.push("", "### Limits of the data-out scan", "");
  if (d.limits.length) for (const l of d.limits) out.push(`- ${l}`);
  else out.push("- None recorded.");
  if (d.failures.length) {
    out.push("", "| Kind | What | Result |", "|---|---|---|");
    for (const f of d.failures) out.push(`| ${f.kind} | ${cell(f.what)} | ${cell(f.result)} |`);
  }
  out.push("");
  return out;
}

export function renderVocabulary(v: Vocabulary, overlap: Overlap): string {
  const used = new Map(overlap.capabilities.map((r) => [r.id, r.count + r.unconfirmedTargets.length]));
  const out: string[] = [];
  out.push("# Scan capability vocabulary", "", BANNER, "");
  out.push(
    `${v.capabilities.length} stable kebab-case ids for catalog-level capability areas, shared by all ten scans. A vendor's feature maps to an id when it is genuinely the same capability, whatever the vendor calls it; where versions differ materially the id stays one and the difference is noted. Generated from \`vocabulary.json\` by \`tools/scans/build.ts\`.`,
    "",
    "These ids are scan vocabulary only. They are not Feature Catalog keys; a roadmap may adopt, split or rename them through its own review.",
    "",
  );
  const groups = [...new Set(v.capabilities.map((c) => c.group))];
  for (const g of groups) {
    out.push(`## ${g}`, "", "| Id | Definition | Scans using it |", "|---|---|---|");
    for (const c of v.capabilities.filter((x) => x.group === g)) {
      const def = c.notes ? `${c.definition} *Note:* ${c.notes}` : c.definition;
      out.push(`| \`${c.id}\` | ${cell(def)} | ${used.get(c.id) ?? 0} |`);
    }
    out.push("");
  }
  return out.join("\n");
}

export function renderOverlap(o: Overlap): string {
  const slugs = o.targets.map((t) => t.slug);
  const name = new Map(o.targets.map((t) => [t.slug, t.name]));
  const top = o.capabilities.filter((r) => r.count > 0).slice(0, 10);
  const out: string[] = [];
  out.push("# Capability overlap across the Sniper List", "", BANNER, "");
  out.push(
    `A capability x target matrix from ${o.targets.length} scans, most shared first: the "build once, reuse everywhere" list. A mark means the scan lists the capability area from a public source; it says nothing about depth, weight or importance, and it is not a progress measure. Counts are confirmed entries only; unconfirmed entries are shown as \`?\` and not counted. Generated by \`tools/scans/build.ts\`.`,
    "",
  );
  out.push("## Summary: the 10 most shared capabilities", "");
  top.forEach((r, i) => {
    out.push(`${i + 1}. \`${r.id}\`: ${r.count} of ${o.targets.length} (${r.targets.map((s) => name.get(s)).join(", ")})`);
  });
  const ties = (n: number) => o.capabilities.filter((r) => r.count === n).length;
  const last = top.at(-1)?.count ?? 0;
  out.push(
    "",
    `Ties are broken by vocabulary order. ${ties(o.targets.length)} capability areas are listed by all ${o.targets.length} scans and ${ties(last)} by exactly ${last}, so the cut at ten falls inside a tie; see the matrix.`,
  );
  const x = o.dataExport;
  const names = (slugs: string[]) => (slugs.length ? slugs.map((s) => name.get(s)).join(", ") : "none");
  out.push(
    "",
    "## Getting data out: across targets",
    "",
    'From each scan\'s "Getting data out" section (public sources, unreviewed). Facts for a future shared import engine, not a design.',
    "",
    `- **Full, incremental and API-based extraction (all three "yes"):** ${names(x.fullIncrementalApi)}.`,
    `- **Export-only, limited or unknown on at least one of the three:** ${names(x.limitedOrUnknown)}.`,
    "",
    "| Target | Full | Incremental | By API |",
    "|---|---|---|---|",
  );
  for (const t of x.targets) out.push(`| ${t.name} | ${t.full} | ${t.incremental} | ${t.apiBased} |`);
  out.push("", "Hardest data classes (number of scans naming each as hard to get out):", "");
  for (const h of x.hardClasses) out.push(`- \`${h.dataClass}\`: ${h.count} (${names(h.targets)})`);
  out.push("", "## Matrix", "", `| Capability | Count | ${slugs.join(" | ")} |`, `|---|---|${slugs.map(() => "---|").join("")}`);
  for (const r of o.capabilities) {
    if (r.count === 0 && r.unconfirmedTargets.length === 0) continue;
    const marks = slugs.map((s) => (r.targets.includes(s) ? "x" : r.unconfirmedTargets.includes(s) ? "?" : ""));
    out.push(`| \`${r.id}\` | ${r.count} | ${marks.join(" | ")} |`);
  }
  const unused = o.capabilities.filter((r) => r.count === 0 && r.unconfirmedTargets.length === 0).map((r) => `\`${r.id}\``);
  out.push("", "## Vocabulary ids no scan used", "", unused.length ? unused.join(", ") : "None.", "");
  out.push("## Capability areas per scan", "", "| Target | Capability areas |", "|---|---|");
  for (const t of o.targets) out.push(`| ${t.name} (${t.id}) | ${t.capabilities} |`);
  out.push("");
  return out.join("\n");
}

export function loadAll(): { vocabulary: Vocabulary; scans: Scan[]; missing: string[]; errors: string[] } {
  const errors: string[] = [];
  const vocabulary = Vocabulary.parse(JSON.parse(readFileSync(join(DIR, "vocabulary.json"), "utf8")));
  const scans: Scan[] = [];
  const missing: string[] = [];
  for (const t of TARGETS) {
    const p = join(DIR, `${t.slug}.json`);
    if (!existsSync(p)) {
      missing.push(t.slug);
      continue;
    }
    const r = Scan.safeParse(JSON.parse(readFileSync(p, "utf8")));
    if (!r.success) {
      errors.push(`${t.slug}.json: ${r.error.message}`);
      continue;
    }
    errors.push(...crossCheck(r.data, vocabulary));
    scans.push(r.data);
  }
  return { vocabulary, scans, missing, errors };
}

export function generate(): Map<string, string> {
  const { vocabulary, scans, errors } = loadAll();
  if (errors.length) throw new Error(errors.join("\n"));
  const overlap = computeOverlap(scans, vocabulary);
  const files = new Map<string, string>();
  for (const s of scans) files.set(`${s.target.slug}.md`, renderScan(s, vocabulary));
  files.set("VOCABULARY.md", renderVocabulary(vocabulary, overlap));
  files.set("overlap.json", `${JSON.stringify(overlap, null, 2)}\n`);
  files.set("OVERLAP.md", renderOverlap(overlap));
  return files;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const check = process.argv.includes("--check");
  const files = generate();
  const stale: string[] = [];
  for (const [name, content] of files) {
    const p = join(DIR, name);
    if (check) {
      // JSON is compared by value, because the repo formatter (biome) owns its layout.
      const same =
        existsSync(p) &&
        (name.endsWith(".json")
          ? isDeepStrictEqual(JSON.parse(readFileSync(p, "utf8")), JSON.parse(content))
          : readFileSync(p, "utf8") === content);
      if (!same) stale.push(name);
    } else writeFileSync(p, content);
  }
  if (stale.length) {
    process.stderr.write(`stale generated scan files (run node tools/scans/build.ts): ${stale.join(", ")}\n`);
    process.exit(1);
  }
  if (!check) {
    // Leave the JSON sources and overlap.json in the repo's formatting so `npm run lint` passes.
    execFileSync(join(ROOT, "node_modules", ".bin", "biome"), ["format", "--write", DIR], { cwd: ROOT, stdio: "ignore" });
    process.stdout.write(`wrote ${files.size} files\n`);
  }
}
