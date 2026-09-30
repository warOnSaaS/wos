/**
 * D60 "Architecture changes" (contracts 5.5.0). The product must stay flexible: when an architecture change
 * happens, the affected work is HELD and reprioritised and everything else keeps building.
 *
 *   ArchitectureRecord     architecture/ADR-nnn.yaml in waronsaas/product: the elements (`arch:<name>`) it
 *                          introduces, changes or retires, and its migration: its own build graph of ABUs
 *                          (architecture/ADR-nnn/BUILD-GRAPH.yaml, feature key `adr-nnn`, ABU keys `adr-nnn#NN`).
 *   architectureRegistry   the live elements, from merged records in merge order. Elements are defined ONLY by
 *                          architecture records (ADR-000 records the core that exists when the product repo is seeded).
 *   computeArchitectureImpact  deterministic, from database rows: which contracts, ABUs, attempts and tasks rely on
 *                          the changed elements. Published on the record's PR and as `architecture.impact_computed`.
 *   ArchitectureHoldMachine   an overlay on ABUs (the ABU, attempt and task machines are unchanged): a held ABU is
 *                          not offered by self-pick or build next; the hold ends in release or supersede.
 *   rankWithArchitecture   the published boost: an active record's migration ABUs rank first, held work is filtered.
 *
 * Pure and node-free. Policy values live in data/architecture-policy.v1.json. Prose: ARCHITECTURE.md section 15,
 * FEATURE-CONTRACT.md "Architecture elements", DECISIONS D60.
 */
import { z } from "zod";
import type { AbuState, AttemptState, TaskState } from "./state-machines.js";
import { WriteScope } from "./primitives.js";

// ---------------------------------------------------------------------------------------------
// Keys, paths, titles
// ---------------------------------------------------------------------------------------------

/** A stable architectural element, e.g. arch:auth-session, arch:data-layer, arch:api-conventions, arch:ui-shell. */
export const ArchElementKey = z.string().regex(/^arch:[a-z][a-z0-9-]{1,48}[a-z0-9]$/, "arch:<lowercase-name>");
export type ArchElementKey = z.infer<typeof ArchElementKey>;

export const ArchitectureRecordId = z.string().regex(/^ADR-\d{3}$/, "ADR-nnn");
export type ArchitectureRecordId = z.infer<typeof ArchitectureRecordId>;

/** The migration build graph's feature key and ABU prefix: ADR-007 -> "adr-007" (ABUs adr-007#01...). */
export const architectureGraphKey = (id: string): string => id.toLowerCase();

export const ARCHITECTURE_PATHS = {
  record: (id: string) => `architecture/${id}.yaml`,
  buildGraph: (id: string) => `architecture/${id}/BUILD-GRAPH.yaml`,
} as const;

/** Allowed paths of an `architecture` document's author changesets (OUT_OF_SCOPE otherwise): the record and its graph. */
export function architectureDocumentAllowedPaths(id: string): string[] {
  return [ARCHITECTURE_PATHS.record(id), ARCHITECTURE_PATHS.buildGraph(id)];
}

/** PR title of the record's PR. Migration ABU PRs keep the ABU convention with their `adr-nnn#NN` key. */
export const architecturePrTitle = (id: string, title: string): string => `${id}: ${title} (Architecture Record)`;

// ---------------------------------------------------------------------------------------------
// The record
// ---------------------------------------------------------------------------------------------

export const ArchitectureElementChange = z.object({
  key: ArchElementKey,
  change: z.enum(["introduce", "change", "retire"]),
  summary: z.string().min(20),
  /**
   * The shared paths this element governs once the record merges (exact files or `<dir>/**`). Required for
   * introduce and change, empty for retire. Any ABU whose write scope can touch them must declare the element.
   */
  paths: z.array(WriteScope).default([]),
});
export type ArchitectureElementChange = z.infer<typeof ArchitectureElementChange>;

export const ArchitectureRecord = z
  .object({
    schema: z.literal("wos-architecture-record.v1"),
    id: ArchitectureRecordId,
    /** 1 for the first merged version; +1 per merged revision (like contracts). */
    version: z.number().int().positive(),
    title: z.string().min(5).max(100),
    context: z.string().min(40),
    decision: z.string().min(40),
    consequences: z.string().min(40),
    alternatives: z.array(z.object({ option: z.string().min(3), rejectedBecause: z.string().min(20) })).min(1),
    elements: z.array(ArchitectureElementChange).min(1),
    /**
     * The migration plan as its own build graph (ARCHITECTURE_PATHS.buildGraph). Null only when every element is
     * introduced (nothing existing moves). The graph's `contractVersion` is this record's version.
     */
    migration: z
      .object({ buildGraph: z.string().regex(/^architecture\/ADR-\d{3}\/BUILD-GRAPH\.yaml$/), summary: z.string().min(20) })
      .nullable(),
    supersedes: z.array(ArchitectureRecordId).default([]),
  })
  .superRefine((r, ctx) => {
    const issue = (path: (string | number)[], message: string) => ctx.addIssue({ code: "custom", path, message });
    for (const [i, e] of r.elements.entries()) {
      if (e.change !== "retire" && e.paths.length === 0) issue(["elements", i, "paths"], `${e.change} needs the paths the element governs`);
      if (e.change === "retire" && e.paths.length > 0) issue(["elements", i, "paths"], "a retired element governs no paths");
    }
    const moves = r.elements.some((e) => e.change !== "introduce");
    if (moves && r.migration === null) issue(["migration"], "changing or retiring an element needs a migration build graph");
    if (r.migration && r.migration.buildGraph !== ARCHITECTURE_PATHS.buildGraph(r.id))
      issue(["migration", "buildGraph"], `must be ${ARCHITECTURE_PATHS.buildGraph(r.id)}`);
  });
export type ArchitectureRecord = z.infer<typeof ArchitectureRecord>;

// ---------------------------------------------------------------------------------------------
// Registry and record validation
// ---------------------------------------------------------------------------------------------

export interface ArchElement {
  key: string;
  /** The record that last introduced or changed it. */
  definedBy: string;
  paths: string[];
}

export const ArchitectureRecordErrorCode = z.enum([
  "ARCH_ELEMENT_DUPLICATE",
  "ARCH_INTRODUCE_EXISTING",
  "ARCH_CHANGE_UNKNOWN",
  "ARCH_PATH_OVERLAP",
  "ARCH_MIGRATION_KEY",
  "ARCH_MIGRATION_RESOURCE",
  "ARCH_MIGRATION_UNCOVERED",
  "ARCH_VERSION_NOT_NEXT",
]);
export type ArchitectureRecordErrorCode = z.infer<typeof ArchitectureRecordErrorCode>;
export interface ArchitectureRecordIssue {
  code: ArchitectureRecordErrorCode;
  message: string;
}

const base = (p: string) => (p.endsWith("/**") ? p.slice(0, -3) : p);
/** Overlap of two exact-or-`<dir>/**` scopes (the only shapes WriteScope allows). */
export function archPathsOverlap(a: string, b: string): boolean {
  const [x, y] = [base(a), base(b)];
  if (x === y) return true;
  if (a.endsWith("/**") && y.startsWith(`${x}/`)) return true;
  if (b.endsWith("/**") && x.startsWith(`${y}/`)) return true;
  return false;
}

/** Applies one record's element changes to a registry (no validation; see architectureRecordIssues). */
function apply(reg: Map<string, ArchElement>, r: Pick<ArchitectureRecord, "id" | "elements">): void {
  for (const e of r.elements) {
    if (e.change === "retire") reg.delete(e.key);
    else reg.set(e.key, { key: e.key, definedBy: r.id, paths: [...e.paths] });
  }
}

/** The live elements after the merged records, applied in merge order. */
export function architectureRegistry(merged: ReadonlyArray<Pick<ArchitectureRecord, "id" | "elements">>): Map<string, ArchElement> {
  const reg = new Map<string, ArchElement>();
  for (const r of merged) apply(reg, r);
  return reg;
}

/**
 * Deterministic checks of a record against the live registry and its migration graph (run with the build-graph
 * validator before any round opens). `previousMergedVersion` is null for a new record.
 */
export function architectureRecordIssues(
  record: ArchitectureRecord,
  registry: ReadonlyMap<string, ArchElement>,
  migration: {
    feature: string;
    contractVersion: number;
    abus: ReadonlyArray<{ key: string; requirements: readonly string[]; resources: ReadonlyArray<{ key: string; mode: string }> }>;
  } | null,
  previousMergedVersion: number | null,
): ArchitectureRecordIssue[] {
  const out: ArchitectureRecordIssue[] = [];
  const add = (code: ArchitectureRecordErrorCode, message: string) => out.push({ code, message });
  if (record.version !== (previousMergedVersion ?? 0) + 1)
    add("ARCH_VERSION_NOT_NEXT", `${record.id} version ${record.version}; expected ${(previousMergedVersion ?? 0) + 1}`);
  const seen = new Set<string>();
  for (const e of record.elements) {
    if (seen.has(e.key)) add("ARCH_ELEMENT_DUPLICATE", `${e.key} is listed twice`);
    seen.add(e.key);
    const live = registry.get(e.key);
    // A revision of a record re-introduces its own element: that is not "existing".
    if (e.change === "introduce" && live && live.definedBy !== record.id)
      add("ARCH_INTRODUCE_EXISTING", `${e.key} already exists (defined by ${live.definedBy}); change it instead`);
    if (e.change !== "introduce" && !live) add("ARCH_CHANGE_UNKNOWN", `${e.key} is not a live element; it cannot be ${e.change}d`);
  }
  for (const e of record.elements)
    for (const p of e.paths)
      for (const other of registry.values()) {
        if (seen.has(other.key)) continue;
        const hit = other.paths.find((q) => archPathsOverlap(p, q));
        if (hit) add("ARCH_PATH_OVERLAP", `${e.key} path ${p} overlaps ${other.key} path ${hit}; one path, one element`);
      }
  if (migration) {
    const key = architectureGraphKey(record.id);
    if (migration.feature !== key || migration.contractVersion !== record.version)
      add("ARCH_MIGRATION_KEY", `the migration graph must be feature ${key}, contractVersion ${record.version}`);
    const moving = new Set(record.elements.filter((e) => e.change !== "introduce").map((e) => e.key));
    // Requirement keys of a migration graph name the record's elements in order: R-001 is elements[0], R-002 elements[1]...
    const covered = new Set<string>();
    for (const a of migration.abus)
      for (const req of a.requirements) {
        const e = record.elements[Number(/^R-(\d{3})$/.exec(req)?.[1] ?? 0) - 1];
        if (e) covered.add(e.key);
        else add("ARCH_MIGRATION_UNCOVERED", `${a.key} names ${req}, which is not an element of ${record.id} (R-001 is elements[0])`);
      }
    for (const k of moving) if (!covered.has(k)) add("ARCH_MIGRATION_UNCOVERED", `no migration ABU covers ${k}`);
    for (const a of migration.abus) {
      const arch = a.resources.filter((r) => r.key.startsWith("arch:"));
      if (!arch.some((r) => moving.has(r.key) && r.mode === "exclusive") && moving.size > 0)
        add("ARCH_MIGRATION_RESOURCE", `${a.key} must claim at least one element this record changes or retires, exclusive`);
      for (const r of arch)
        if (r.mode === "exclusive" && !moving.has(r.key) && !seen.has(r.key))
          add("ARCH_MIGRATION_RESOURCE", `${a.key} claims ${r.key} exclusive, which this record does not change`);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Impact: who relies on what changes (deterministic, never an agent)
// ---------------------------------------------------------------------------------------------

export interface ArchitectureImpactInput {
  record: Pick<ArchitectureRecord, "id" | "elements">;
  /** Latest version of every feature contract (merged or open), with the elements it declares. */
  contracts: ReadonlyArray<{ feature: string; version: number; architecture: readonly string[] }>;
  abus: ReadonlyArray<{
    key: string;
    feature: string;
    state: AbuState;
    resources: ReadonlyArray<{ key: string; mode: "exclusive" | "shared" }>;
    dependsOn: readonly string[];
  }>;
  attempts: ReadonlyArray<{ id: string; abu: string; state: AttemptState }>;
  /** Build-side tasks: abu_build and abu_revision on an ABU; review tasks name the attempt. */
  tasks: ReadonlyArray<{ id: string; state: TaskState; abu: string | null }>;
}

export interface ArchitectureImpact {
  record: string;
  /** The elements changed or retired (introduced elements affect nobody). */
  elements: string[];
  contracts: Array<{ feature: string; version: number }>;
  /** Unstarted affected ABUs (pending_dependencies or ready): held. */
  held: string[];
  /** Unmerged ABUs that depend, transitively, on a held ABU but rely on nothing changed: not held, already blocked. */
  blockedByHold: string[];
  /** Affected ABUs in progress: their live attempts may finish (then re-reviewed against the new architecture). */
  finishing: string[];
  liveAttempts: string[];
  /** Open or blocked tasks of held ABUs: withdrawn, their budgets released and reissued when the hold ends. */
  heldTasks: string[];
  /** Merged ABUs that rely on a changed element: the migration graph must cover their code. */
  merged: string[];
}

const UNSTARTED: ReadonlySet<AbuState> = new Set(["pending_dependencies", "ready"]);
const LIVE_ATTEMPT: ReadonlySet<AttemptState> = new Set([
  "leased",
  "building",
  "verifying",
  "submitted",
  "candidate_pushed",
  "in_review",
  "changes_requested",
  "qualified",
  "pr_open",
]);
const sorted = (xs: Iterable<string>) => [...new Set(xs)].sort();

export function computeArchitectureImpact(input: ArchitectureImpactInput): ArchitectureImpact {
  const changed = new Set(input.record.elements.filter((e) => e.change !== "introduce").map((e) => e.key));
  const own = architectureGraphKey(input.record.id);
  const relies = (a: ArchitectureImpactInput["abus"][number]) => a.feature !== own && a.resources.some((r) => changed.has(r.key));
  const affected = input.abus.filter(relies);
  const held = affected.filter((a) => UNSTARTED.has(a.state)).map((a) => a.key);
  const heldSet = new Set(held);
  const finishing = affected.filter((a) => a.state === "in_progress").map((a) => a.key);
  const finishingSet = new Set(finishing);

  // Transitive dependents of held ABUs, not themselves affected and not merged/superseded: blocked, not held.
  const dependents = new Map<string, string[]>();
  for (const a of input.abus) for (const d of a.dependsOn) dependents.set(d, [...(dependents.get(d) ?? []), a.key]);
  const state = new Map(input.abus.map((a) => [a.key, a.state]));
  const blocked = new Set<string>();
  const stack = [...held];
  while (stack.length > 0) {
    for (const k of dependents.get(stack.pop()!) ?? []) {
      if (heldSet.has(k) || blocked.has(k)) continue;
      const s = state.get(k);
      if (s === "merged" || s === "superseded") continue;
      blocked.add(k);
      stack.push(k);
    }
  }
  return {
    record: input.record.id,
    elements: sorted(changed),
    contracts: input.contracts
      .filter((c) => c.architecture.some((k) => changed.has(k)))
      .map((c) => ({ feature: c.feature, version: c.version }))
      .sort((a, b) => (a.feature < b.feature ? -1 : a.feature > b.feature ? 1 : a.version - b.version)),
    held: sorted(held),
    blockedByHold: sorted(blocked),
    finishing: sorted(finishing),
    liveAttempts: sorted(input.attempts.filter((t) => finishingSet.has(t.abu) && LIVE_ATTEMPT.has(t.state)).map((t) => t.id)),
    heldTasks: sorted(
      input.tasks.filter((t) => t.abu !== null && heldSet.has(t.abu) && (t.state === "open" || t.state === "blocked")).map((t) => t.id),
    ),
    merged: sorted(affected.filter((a) => a.state === "merged").map((a) => a.key)),
  };
}

// ---------------------------------------------------------------------------------------------
// Holds: an overlay, so the ABU, attempt and task machines stay as they are
// ---------------------------------------------------------------------------------------------

export const ArchitectureHoldStates = ["held", "released", "superseded"] as const;
export type ArchitectureHoldState = (typeof ArchitectureHoldStates)[number];

/**
 * The end of a hold, when the record's migration graph has fully merged or the record was abandoned. `carriedOver`
 * is the FEATURE-CONTRACT section 5 decision for the held ABU's feature: null when no newer contract version merged
 * (the ABU is unchanged), true when a newer version carries it over unchanged, false when it does not.
 */
export function holdOutcome(x: { recordAbandoned: boolean; carriedOver: boolean | null }): "release" | "supersede" {
  if (x.recordAbandoned) return "release";
  return x.carriedOver === false ? "supersede" : "release";
}

/** Self-pick and build next offer an ABU only when it is ready and no hold on it is active. */
export function abuOffered(state: AbuState, holds: ReadonlyArray<{ state: ArchitectureHoldState }>): boolean {
  return state === "ready" && !holds.some((h) => h.state === "held");
}

// ---------------------------------------------------------------------------------------------
// Priority (policy data) and the policy document
// ---------------------------------------------------------------------------------------------

export const ArchitecturePolicy = z.object({
  schema: z.literal("wos-architecture-policy.v1"),
  /** Astra/Fable rounds for an architecture record before escalation (then the maintainer rules, as for contracts). */
  maxRounds: z.number().int().positive(),
  /** A maintainer's explicit sign-off is required between consensus and merge. */
  maintainerSignOff: z.literal(true),
  /** Added to a migration ABU's build-next score while its record is merged and its migration is not; published. */
  migrationBoost: z.number().int().positive(),
  /** When holds start and end. */
  holds: z.object({
    startAt: z.literal("record_merged"),
    endAt: z.literal("migration_merged_or_record_abandoned"),
    /** Dependents of held ABUs are not held themselves: they cannot start until the held ABU merges anyway. */
    holdTransitiveDependents: z.literal(false),
  }),
  /** Live attempts finish; their review runs (never paused) with the record in context. */
  review: z.object({ pauseInFlight: z.literal(false), recordInContext: z.literal(true) }),
});
export type ArchitecturePolicy = z.infer<typeof ArchitecturePolicy>;

export interface ArchitectureRankCandidate {
  unitId: string;
  /** The unit's base build-next score (D56 ranking, from the protocol's policy). */
  baseScore: number;
  /** The record whose migration graph this unit belongs to, when that record is migrating; else null. */
  migrationOf: string | null;
  held: boolean;
}

/**
 * Build next with D60: held units are filtered out; migration units get the published boost; ties by unit id.
 * Held work that is released returns with its base score unchanged, so it takes its prior place.
 */
export function rankWithArchitecture(
  policy: Pick<ArchitecturePolicy, "migrationBoost">,
  units: readonly ArchitectureRankCandidate[],
): Array<{ unitId: string; score: number }> {
  return units
    .filter((u) => !u.held)
    .map((u) => ({ unitId: u.unitId, score: u.baseScore + (u.migrationOf ? policy.migrationBoost : 0) }))
    .sort((a, b) => b.score - a.score || (a.unitId < b.unitId ? -1 : a.unitId > b.unitId ? 1 : 0));
}

/** Declared by a Feature Contract (FeatureContract.architecture): the elements the feature relies on. */
export const ContractArchitecture = z.array(ArchElementKey).optional();
