/**
 * D61 "Bugs and maintenance", the planning and build side (contracts 5.7.0). The economy side (task budgets, rewards,
 * outcomes) is the protocol's (ws/protocol); it binds to the records here, never to their prose.
 *
 *   BugReport         intake: `wos bug` (CLI, Desktop) or a sweep files it through the App as a GitHub Issue (D9) in
 *                     waronsaas/product, label `wos:bug`, the report as a fenced `wos-bug-report` JSON block.
 *   TriageDecision    a triage task's output (agent or maintainer): reproduced or not, severity, duplicate, and the
 *                     mapping to a catalog feature, requirements, ABUs and files; its canonical hash is what the
 *                     protocol binds a reward to.
 *   fix units         AbuSpec.fix (artifacts.ts) + planning.validateFixUnit: scope inside the feature's module and
 *                     acceptance paths, a regression test that goes red on the parent and green on the head.
 *   RedGreenEvidence  the CI evidence for the red-then-green order (`redGreenRefusals`).
 *   BugSweep          sweep tasks run acceptance journeys across surfaces and explore; their output is bug reports only.
 *   BugsPolicy        severity boosts in build next and critical-bug holds (data/bugs-policy.v1.json).
 *
 * Holds use the D60 overlay (WorkHoldMachine) with a bug source: `computeBugHolds`.
 */
import { z } from "zod";
import { type ArchitectureHoldState, abuOffered } from "./architecture.js";
import { AbuKey, Browser, FeatureKey, GitSha, RepoPath, RequirementKey, Sha256, Timestamp, Uuid } from "./primitives.js";
import type { AbuState } from "./state-machines.js";
import { ProductSurface } from "./wos-app.js";

// ---------------------------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------------------------

/** A bug is its GitHub Issue in waronsaas/product: BUG-<issue number>. */
export const BugId = z.string().regex(/^BUG-\d{1,9}$/);
export type BugId = z.infer<typeof BugId>;
export const bugIdOf = (issueNumber: number): string => `BUG-${issueNumber}`;

export const BugSeverity = z.enum(["low", "medium", "high", "critical"]);
export type BugSeverity = z.infer<typeof BugSeverity>;

/** Task kinds of D61 (they join `TaskKind` when the control plane serves them; the protocol prices them). */
export const BugTaskKind = z.enum(["bug_triage", "bug_sweep"]);
export type BugTaskKind = z.infer<typeof BugTaskKind>;

export const BUG_ISSUE_LABEL = "wos:bug" as const;

// ---------------------------------------------------------------------------------------------
// Intake
// ---------------------------------------------------------------------------------------------

export const BugReport = z.object({
  schema: z.literal("wos-bug-report.v1"),
  title: z.string().min(8).max(120),
  surface: ProductSurface,
  /** The reporter's guess; triage decides. */
  feature: FeatureKey.nullable(),
  environment: z.object({
    /** The wOS build the bug was seen on: an app version or a commit of waronsaas/product. */
    version: z.string().min(1).max(60),
    os: z.string().max(60).nullable(),
    browser: Browser.nullable(),
    device: z.string().max(60).nullable(),
  }),
  /** Required: numbered reproduction steps a stranger can follow. */
  steps: z.array(z.string().min(3).max(500)).min(1).max(30),
  expected: z.string().min(3).max(2000),
  actual: z.string().min(3).max(2000),
  /** Ideally a failing test (it becomes the regression test's starting point). */
  failingTest: z.object({ path: RepoPath, content: z.string().min(1).max(20_000) }).nullable(),
  reportedVia: z.enum(["cli", "desktop", "sweep"]),
  /** Set exactly when reportedVia is sweep. */
  sweepId: Uuid.nullable(),
});
export type BugReport = z.infer<typeof BugReport>;

export const bugIssueTitle = (r: Pick<BugReport, "title" | "surface">): string => `[bug][${r.surface}] ${r.title}`;

/** The issue body the App writes: prose for humans, then the report as the one machine-readable block. */
export function renderBugIssueBody(r: BugReport): string {
  const steps = r.steps.map((s, i) => `${i + 1}. ${s}`).join("\n");
  return [
    `**Surface:** ${r.surface} · **Version:** ${r.environment.version}`,
    "",
    "**Steps**",
    steps,
    "",
    `**Expected:** ${r.expected}`,
    "",
    `**Actual:** ${r.actual}`,
    "",
    r.failingTest ? `A failing test is attached: \`${r.failingTest.path}\`.` : "No failing test attached.",
    "",
    "```wos-bug-report",
    JSON.stringify(r, null, 2),
    "```",
  ].join("\n");
}

/** Reads the report back from an issue body: the last `wos-bug-report` block, validated; null if absent or invalid. */
export function parseBugIssueBody(body: string): BugReport | null {
  const blocks = [...body.matchAll(/```wos-bug-report\n([\s\S]*?)\n```/g)];
  const last = blocks.at(-1)?.[1];
  if (last === undefined) return null;
  try {
    const r = BugReport.safeParse(JSON.parse(last));
    return r.success ? r.data : null;
  } catch {
    return null;
  }
}

export const bugReportRefusals = (r: BugReport): string[] =>
  (r.reportedVia === "sweep") === (r.sweepId !== null) ? [] : ["sweepId is set exactly for reports filed by a sweep"];

// ---------------------------------------------------------------------------------------------
// Triage
// ---------------------------------------------------------------------------------------------

export const TriageOutcome = z.enum(["fix", "contract_revision", "duplicate", "not_reproducible", "not_a_bug", "wont_fix"]);
export type TriageOutcome = z.infer<typeof TriageOutcome>;

export const TriageDecision = z
  .object({
    schema: z.literal("wos-triage-decision.v1"),
    bug: BugId,
    decidedBy: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("agent"), taskId: Uuid, leaseId: Uuid }),
      z.object({ kind: z.literal("maintainer"), accountId: Uuid }),
    ]),
    reproduced: z.boolean(),
    /** Where and how it was reproduced (required when reproduced). */
    reproduction: z.object({ commit: GitSha, surface: ProductSurface, notes: z.string().min(20), failingTestRan: z.boolean() }).nullable(),
    outcome: TriageOutcome,
    severity: BugSeverity.nullable(),
    duplicateOf: BugId.nullable(),
    /** The divergence, through the scope paths: required for fix and contract_revision. */
    mapping: z
      .object({
        feature: FeatureKey,
        /** The merged contract version the code diverges from (fix) or that is wrong (contract_revision). */
        contractVersion: z.number().int().positive(),
        requirements: z.array(RequirementKey).min(1),
        /** Merged ABUs whose code diverges (may be empty when the divergence predates ABU tracking). */
        abus: z.array(AbuKey),
        files: z.array(RepoPath).min(1),
      })
      .nullable(),
    rationale: z.string().min(40),
    decidedAt: Timestamp,
  })
  .superRefine((d, ctx) => {
    const issue = (path: string[], message: string) => ctx.addIssue({ code: "custom", path, message });
    if (d.reproduced !== (d.reproduction !== null)) issue(["reproduction"], "reproduction is set exactly when reproduced");
    const acts = d.outcome === "fix" || d.outcome === "contract_revision";
    if (acts && !d.reproduced) issue(["reproduced"], `${d.outcome} needs a reproduced bug`);
    if (acts && (d.severity === null || d.mapping === null)) issue(["mapping"], `${d.outcome} needs a severity and the mapping`);
    if (d.outcome === "not_reproducible" && d.reproduced) issue(["outcome"], "a reproduced bug is not not_reproducible");
    if ((d.outcome === "duplicate") !== (d.duplicateOf !== null)) issue(["duplicateOf"], "duplicateOf is set exactly for duplicates");
    if (d.duplicateOf === d.bug) issue(["duplicateOf"], "a bug is not its own duplicate");
    if (d.outcome === "wont_fix" && d.decidedBy.kind !== "maintainer") issue(["decidedBy"], "only a maintainer decides wont_fix");
  });
export type TriageDecision = z.infer<typeof TriageDecision>;

// ---------------------------------------------------------------------------------------------
// Fix units: red then green
// ---------------------------------------------------------------------------------------------

/** The regression test's path: `<profile acceptance dir>/regressions/BUG-<n>.<ext>` (it joins that suite for good). */
export const regressionTestPattern = (acceptanceDir: string, bug: string): RegExp =>
  new RegExp(`^${acceptanceDir.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/regressions/${bug}\\.[A-Za-z0-9.]+$`);

/** The CI check that runs the regression test on the parent and on the head of a fix PR. */
export const regressionCheckName = (feature: string, bug: string): string => `wos-regression/${feature}/${bug}`;

export const RedGreenEvidence = z.object({
  bug: BugId,
  feature: FeatureKey,
  regressionTest: RepoPath,
  parent: z.object({ sha: GitSha, conclusion: z.enum(["failure", "success"]), failedTests: z.array(RepoPath) }),
  head: z.object({ sha: GitSha, conclusion: z.enum(["failure", "success"]), failedTests: z.array(RepoPath) }),
  /** The regression test file's content at the head (the parent run uses the same file). */
  testSha256: Sha256,
});
export type RedGreenEvidence = z.infer<typeof RedGreenEvidence>;

/** Red then green: the regression test fails on the parent (for itself, not another test) and passes on the head. */
export function redGreenRefusals(e: RedGreenEvidence): string[] {
  const r: string[] = [];
  if (e.parent.sha === e.head.sha) r.push("parent and head are the same commit");
  if (e.parent.conclusion !== "failure" || !e.parent.failedTests.includes(e.regressionTest))
    r.push(`the regression test ${e.regressionTest} must fail on the parent commit (red first)`);
  if (e.head.conclusion !== "success" || e.head.failedTests.length > 0) r.push("the regression test must pass on the head (then green)");
  return r;
}

// ---------------------------------------------------------------------------------------------
// Sweeps: acceptance journeys across surfaces, plus exploration; output is bug reports only
// ---------------------------------------------------------------------------------------------

export const BugSweep = z.object({
  schema: z.literal("wos-bug-sweep.v1"),
  id: Uuid,
  openedBy: z.enum(["schedule", "maintainer"]),
  /** The default-branch commit under test. */
  commit: GitSha,
  /** Empty = every feature with a merged ABU. */
  features: z.array(FeatureKey),
  surfaces: z.array(ProductSurface).min(1),
  /** Web: the browser matrix to run the journeys in. */
  browsers: z.array(Browser),
  explore: z.boolean(),
});
export type BugSweep = z.infer<typeof BugSweep>;

export const SweepOutput = z.object({
  schema: z.literal("wos-sweep-output.v1"),
  sweepId: Uuid,
  commit: GitSha,
  journeysRun: z.array(
    z.object({
      feature: FeatureKey,
      journey: z.string().regex(/^J-\d{3}$/),
      surface: ProductSurface,
      browser: Browser.nullable(),
      result: z.enum(["passed", "failed", "skipped"]),
    }),
  ),
  reports: z.array(BugReport).max(50),
});
export type SweepOutput = z.infer<typeof SweepOutput>;

/**
 * A sweep's output is bug reports only (its task has no write scope; a changeset is refused elsewhere). Every
 * report and journey run stays inside the sweep's spec, and every failed journey is reported.
 */
export function sweepOutputRefusals(spec: BugSweep, out: SweepOutput): string[] {
  const r: string[] = [];
  if (out.sweepId !== spec.id || out.commit !== spec.commit) r.push("the output is for another sweep or commit");
  const inFeatures = (f: string | null) => spec.features.length === 0 || (f !== null && spec.features.includes(f));
  for (const j of out.journeysRun) {
    if (!spec.surfaces.includes(j.surface)) r.push(`journey ${j.feature}/${j.journey} ran on ${j.surface}, outside the sweep`);
    if (!inFeatures(j.feature)) r.push(`journey ${j.feature}/${j.journey} is outside the sweep's features`);
    if (j.browser !== null && !spec.browsers.includes(j.browser)) r.push(`browser ${j.browser} is outside the sweep's matrix`);
  }
  for (const [i, b] of out.reports.entries()) {
    if (b.reportedVia !== "sweep" || b.sweepId !== spec.id) r.push(`reports[${i}] must be filed via this sweep`);
    if (!spec.surfaces.includes(b.surface)) r.push(`reports[${i}] is on ${b.surface}, outside the sweep`);
  }
  const failed = out.journeysRun.filter((j) => j.result === "failed");
  if (failed.length > 0 && out.reports.length === 0) r.push("failed journeys need at least one bug report");
  return r;
}

// ---------------------------------------------------------------------------------------------
// Priority and holds
// ---------------------------------------------------------------------------------------------

export const BugsPolicy = z.object({
  schema: z.literal("wos-bugs-policy.v1"),
  /** Added to a fix unit's build-next score by its bug's severity; published. */
  severityBoost: z.object({
    low: z.number().int().min(0),
    medium: z.number().int().min(0),
    high: z.number().int().min(0),
    critical: z.number().int().min(0),
  }),
  /** A critical bug with outcome fix or contract_revision holds the unstarted NEW feature ABUs of its feature. */
  criticalHoldsFeature: z.boolean(),
  triage: z.object({
    /** fix and contract_revision need a reproduction on a default-branch commit. */
    requiresReproduction: z.literal(true),
    /** A maintainer confirms every critical severity before its holds open. */
    maintainerConfirmsCritical: z.boolean(),
  }),
  regressions: z.object({ dir: z.literal("regressions"), removableOnlyByContractRevision: z.literal(true) }),
});
export type BugsPolicy = z.infer<typeof BugsPolicy>;

/**
 * The ABUs a critical bug holds: the unstarted (pending_dependencies, ready) ABUs of its feature that are not fix
 * units. Nothing is held below critical, for other outcomes, or when the policy turns holds off. The fix itself and
 * other bugs' fixes keep building.
 */
export function computeBugHolds(
  policy: Pick<BugsPolicy, "criticalHoldsFeature">,
  decision: Pick<TriageDecision, "outcome" | "severity" | "mapping">,
  abus: ReadonlyArray<{ key: string; feature: string; state: AbuState; fix: boolean }>,
): string[] {
  if (!policy.criticalHoldsFeature || decision.severity !== "critical" || !decision.mapping) return [];
  if (decision.outcome !== "fix" && decision.outcome !== "contract_revision") return [];
  const feature = decision.mapping.feature;
  return abus
    .filter((a) => a.feature === feature && !a.fix && (a.state === "pending_dependencies" || a.state === "ready"))
    .map((a) => a.key)
    .sort();
}

/** A hold's source (D60 architecture record or D61 bug); the overlay, its states and its end rule are shared. */
export type WorkHoldSource = { kind: "architecture"; record: string } | { kind: "bug"; bug: string };

export interface BuildNextCandidate {
  unitId: string;
  /** The D56 base score (the protocol's ranking). */
  baseScore: number;
  /** Set while the unit belongs to a migrating architecture record. */
  migrationOf: string | null;
  /** Set for a fix unit: its bug's severity. */
  bugSeverity: BugSeverity | null;
  /** Active holds on the unit's ABU, from any source. */
  holds: ReadonlyArray<{ state: ArchitectureHoldState }>;
}

/**
 * Build next with D60 and D61: held units are not offered; the published boosts add to the base score (a migration
 * boost from architecture-policy, a severity boost from bugs-policy); ties by unit id. Released units keep their
 * base score, so they return in their prior order.
 */
export function rankBuildNext(
  policies: { migrationBoost: number; severityBoost: BugsPolicy["severityBoost"] },
  units: readonly BuildNextCandidate[],
): Array<{ unitId: string; score: number }> {
  return units
    .filter((u) => abuOffered("ready", u.holds))
    .map((u) => ({
      unitId: u.unitId,
      score: u.baseScore + (u.migrationOf ? policies.migrationBoost : 0) + (u.bugSeverity ? policies.severityBoost[u.bugSeverity] : 0),
    }))
    .sort((a, b) => b.score - a.score || (a.unitId < b.unitId ? -1 : a.unitId > b.unitId ? 1 : 0));
}
