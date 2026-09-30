/**
 * warOnSaaS target scans: local schema (not a contract).
 *
 * A scan is a short, shallow table of contents of one Sniper List target's public product surface. It is NOT a
 * roadmap: no build units, weights, budgets or progress, it is never reviewed, and it never counts toward any
 * percentage. Roadmap v1 for a target starts from its scan and supersedes it. See docs/scans/README.md.
 *
 * This file is deliberately local to tools/scans (it does not live in packages/contracts): scans feed nothing
 * that the control plane computes.
 */
import { z } from "zod";

export const SCAN_DATE = "2026-09-30";
export const SCAN_LABEL = `SCAN — unreviewed, ${SCAN_DATE}`;

export const TARGETS = [
  { id: "TGT-01", slug: "salesforce", name: "Salesforce" },
  { id: "TGT-02", slug: "hubspot", name: "HubSpot" },
  { id: "TGT-03", slug: "slack", name: "Slack" },
  { id: "TGT-04", slug: "zoom", name: "Zoom" },
  { id: "TGT-05", slug: "shopify", name: "Shopify" },
  { id: "TGT-06", slug: "quickbooks", name: "QuickBooks" },
  { id: "TGT-07", slug: "jira", name: "Jira" },
  { id: "TGT-08", slug: "zendesk", name: "Zendesk" },
  { id: "TGT-09", slug: "docusign", name: "DocuSign" },
  { id: "TGT-10", slug: "netsuite", name: "NetSuite" },
] as const;

const kebab = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "kebab-case id");
const url = z.url({ protocol: /^https?$/ });
const text = z.string().trim().min(1);

export const VocabularyEntry = z.strictObject({
  id: kebab,
  group: text,
  definition: text,
  /** Where vendors' versions differ materially under one id, the difference is noted here. */
  notes: z.string().trim().min(1).nullable(),
});
export type VocabularyEntry = z.infer<typeof VocabularyEntry>;

export const Vocabulary = z
  .strictObject({
    schema: z.literal("wos-scan-vocabulary.v0"),
    label: z.literal(SCAN_LABEL),
    capabilities: z.array(VocabularyEntry).min(1),
  })
  .superRefine((v, ctx) => {
    const seen = new Set<string>();
    for (const c of v.capabilities) {
      if (seen.has(c.id)) ctx.addIssue({ code: "custom", message: `duplicate vocabulary id ${c.id}` });
      seen.add(c.id);
    }
  });
export type Vocabulary = z.infer<typeof Vocabulary>;

/** Surfaces a capability can be seen on in public sources. */
export const CapabilitySurface = z.enum(["web", "ios", "android", "desktop", "api"]);
/** Client apps the vendor ships (the parity rule: iPhone app, browser and each target's own apps). */
export const ClientSurface = z.enum(["web", "ios", "android", "desktop", "browser_extension", "email_addin", "other"]);

export const Capability = z
  .strictObject({
    id: kebab,
    vendorName: text,
    description: text,
    surfaces: z.array(CapabilitySurface),
    lowestTier: text.nullable(),
    tierNote: text.nullable(),
    status: z.enum(["confirmed", "unconfirmed"]),
    unconfirmedReason: text.nullable(),
    sources: z.array(url).min(1, "every capability needs at least one source URL").max(3),
  })
  .superRefine((c, ctx) => {
    if (c.status === "unconfirmed" && !c.unconfirmedReason)
      ctx.addIssue({ code: "custom", message: `${c.id}: unconfirmed without a reason` });
    if (c.status === "confirmed" && c.unconfirmedReason)
      ctx.addIssue({ code: "custom", message: `${c.id}: confirmed but has an unconfirmedReason` });
    if (new Set(c.surfaces).size !== c.surfaces.length) ctx.addIssue({ code: "custom", message: `${c.id}: duplicate surface` });
  });
export type Capability = z.infer<typeof Capability>;

const sourced = z.array(url).min(1, "every item needs at least one source URL");
const tri = z.enum(["yes", "partial", "no", "unknown"]);

/** "Getting data out": facts about extracting a customer's data from the vendor (informs a shared import engine). */
export const DataExport = z.strictObject({
  extraction: z.strictObject({ full: tri, incremental: tri, apiBased: tri, note: text }),
  exportOptions: z.array(
    z.strictObject({
      name: text,
      description: text,
      formats: z.array(text),
      limits: text.nullable(),
      lowestTier: text.nullable(),
      sources: sourced,
    }),
  ),
  apis: z.array(
    z.strictObject({
      name: text,
      kind: z.enum(["bulk-export", "incremental", "webhooks-events", "read-api", "other"]),
      description: text,
      sources: sourced,
    }),
  ),
  auth: z.strictObject({
    models: z.array(z.enum(["oauth-app", "api-key", "personal-token", "service-account", "admin-consent", "basic", "other"])).min(1),
    notes: text,
    sources: sourced,
  }),
  rateLimits: z
    .strictObject({ summary: text.nullable(), sources: z.array(url) })
    .refine((r) => r.summary === null || r.sources.length > 0, "a stated rate limit needs a source"),
  hardToExtract: z.array(
    z.strictObject({
      dataClass: z.enum([
        "attachments-files",
        "history-audit",
        "custom-objects-fields",
        "automations-workflows",
        "permissions",
        "metadata-config",
        "other",
      ]),
      detail: text,
      sources: sourced,
    }),
  ),
  migrationTools: z.array(
    z.strictObject({
      name: text,
      direction: z.enum(["into-vendor", "out-of-vendor", "both", "unknown"]),
      description: text,
      sources: sourced,
    }),
  ),
  limits: z.array(text),
  failures: z.array(z.strictObject({ kind: z.enum(["search", "fetch"]), what: text, result: text })),
});
export type DataExport = z.infer<typeof DataExport>;

export const Scan = z
  .strictObject({
    schema: z.literal("wos-scan.v0"),
    label: z.literal(SCAN_LABEL),
    /** A scan is never reviewed. */
    reviewed: z.literal(false),
    /** A scan never counts toward any progress percentage. */
    countsTowardProgress: z.literal(false),
    target: z.strictObject({ id: z.string().regex(/^TGT-\d{2}$/), slug: kebab, name: text }),
    scannedAt: z.literal(SCAN_DATE),
    scope: z.strictObject({ included: text, excluded: z.array(text) }),
    clientApps: z
      .array(z.strictObject({ surface: ClientSurface, name: text, platforms: text.nullable(), sources: z.array(url).min(1) }))
      .min(1),
    api: z.strictObject({ style: text, notes: text, sources: z.array(url).min(1) }),
    capabilities: z.array(Capability).min(20).max(60),
    limits: z.array(text),
    failures: z.array(z.strictObject({ kind: z.enum(["search", "fetch"]), what: text, result: text })),
    dataExport: DataExport,
  })
  .superRefine((s, ctx) => {
    const seen = new Set<string>();
    for (const c of s.capabilities) {
      if (seen.has(c.id)) ctx.addIssue({ code: "custom", message: `duplicate capability id ${c.id}` });
      seen.add(c.id);
    }
    const t = TARGETS.find((x) => x.id === s.target.id);
    if (!t || t.slug !== s.target.slug || t.name !== s.target.name)
      ctx.addIssue({ code: "custom", message: `unknown target ${s.target.id}/${s.target.slug}/${s.target.name}` });
  });
export type Scan = z.infer<typeof Scan>;

/** Cross-file rules the schema alone cannot express. Returns human-readable errors (empty when valid). */
export function crossCheck(scan: Scan, vocabulary: Vocabulary): string[] {
  const ids = new Set(vocabulary.capabilities.map((c) => c.id));
  const errors: string[] = [];
  for (const c of scan.capabilities) {
    if (!ids.has(c.id)) errors.push(`${scan.target.slug}: capability id "${c.id}" is not in the vocabulary`);
    if (c.sources.length < 1) errors.push(`${scan.target.slug}: ${c.id} has no source`);
  }
  return errors;
}

/** `count` and `targets` hold confirmed capabilities only; `unconfirmedTargets` lists scans that name it as unconfirmed. */
export type OverlapRow = { id: string; group: string; definition: string; count: number; targets: string[]; unconfirmedTargets: string[] };
export type Overlap = {
  schema: "wos-scan-overlap.v0";
  label: typeof SCAN_LABEL;
  reviewed: false;
  countsTowardProgress: false;
  targets: { id: string; slug: string; name: string; capabilities: number }[];
  capabilities: OverlapRow[];
  dataExport: {
    /** Per target, the three extraction answers as the scan recorded them. */
    targets: { slug: string; name: string; full: Tri; incremental: Tri; apiBased: Tri }[];
    /** Targets where all three answers are "yes". */
    fullIncrementalApi: string[];
    /** Every other target: export-only, partial or unknown on at least one answer. */
    limitedOrUnknown: string[];
    /** Data classes the scans name as hard to get out, most targets first. */
    hardClasses: { dataClass: DataExport["hardToExtract"][number]["dataClass"]; count: number; targets: string[] }[];
  };
};
type Tri = z.infer<typeof tri>;

/** Capability x target matrix, most shared first (ties: vocabulary order). Deterministic. */
export function computeOverlap(scans: Scan[], vocabulary: Vocabulary): Overlap {
  const order = [...scans].sort((a, b) => a.target.id.localeCompare(b.target.id));
  const rows: OverlapRow[] = vocabulary.capabilities.map((v) => {
    const has = (s: Scan, status: Capability["status"]) => s.capabilities.some((c) => c.id === v.id && c.status === status);
    const targets = order.filter((s) => has(s, "confirmed")).map((s) => s.target.slug);
    const unconfirmedTargets = order.filter((s) => has(s, "unconfirmed")).map((s) => s.target.slug);
    return { id: v.id, group: v.group, definition: v.definition, count: targets.length, targets, unconfirmedTargets };
  });
  const index = new Map(vocabulary.capabilities.map((v, i) => [v.id, i]));
  rows.sort(
    (a, b) =>
      b.count - a.count || b.unconfirmedTargets.length - a.unconfirmedTargets.length || (index.get(a.id) ?? 0) - (index.get(b.id) ?? 0),
  );
  return {
    schema: "wos-scan-overlap.v0",
    label: SCAN_LABEL,
    reviewed: false,
    countsTowardProgress: false,
    targets: order.map((s) => ({ id: s.target.id, slug: s.target.slug, name: s.target.name, capabilities: s.capabilities.length })),
    capabilities: rows,
    dataExport: exportSummary(order),
  };
}

const HARD_CLASSES = DataExport.shape.hardToExtract.element.shape.dataClass.options;

function exportSummary(order: Scan[]): Overlap["dataExport"] {
  const targets = order.map((s) => ({ slug: s.target.slug, name: s.target.name, ...pick(s.dataExport.extraction) }));
  const all = (t: (typeof targets)[number]) => t.full === "yes" && t.incremental === "yes" && t.apiBased === "yes";
  const hardClasses = HARD_CLASSES.map((dataClass) => {
    const ts = order.filter((s) => s.dataExport.hardToExtract.some((h) => h.dataClass === dataClass)).map((s) => s.target.slug);
    return { dataClass, count: ts.length, targets: ts };
  })
    .filter((h) => h.count > 0)
    .sort((a, b) => b.count - a.count || HARD_CLASSES.indexOf(a.dataClass) - HARD_CLASSES.indexOf(b.dataClass));
  return {
    targets,
    fullIncrementalApi: targets.filter(all).map((t) => t.slug),
    limitedOrUnknown: targets.filter((t) => !all(t)).map((t) => t.slug),
    hardClasses,
  };
}

function pick(e: DataExport["extraction"]): { full: Tri; incremental: Tri; apiBased: Tri } {
  return { full: e.full, incremental: e.incremental, apiBased: e.apiBased };
}
