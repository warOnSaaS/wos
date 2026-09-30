/** D61 "Bugs and maintenance" (contracts 5.7.0): intake, triage, red then green, sweeps, holds and priority. */
import { describe, expect, it } from "vitest";
import {
  ARCHITECTURE_POLICY_V1,
  BUGS_POLICY_V1,
  BugMachine,
  type BugReport,
  BugReport as BugReportSchema,
  type BugSweep,
  bugIssueTitle,
  bugReportRefusals,
  computeBugHolds,
  DomainEventBody,
  findTransition,
  parseBugIssueBody,
  type RedGreenEvidence,
  rankBuildNext,
  redGreenRefusals,
  renderBugIssueBody,
  type SweepOutput,
  sweepOutputRefusals,
  TriageDecision,
  WorkHoldMachine,
  ArchitectureHoldMachine,
} from "../src/index.js";

const U = (n: number) => `0192f000-0000-7000-8000-${String(n).padStart(12, "0")}`;
const SHA = (c: string) => c.repeat(40);
const report = (over: Partial<BugReport> = {}): BugReport =>
  BugReportSchema.parse({
    schema: "wos-bug-report.v1",
    title: "Search ignores accented names",
    surface: "web",
    feature: "contacts",
    environment: { version: "0.3.0", os: "macOS 16", browser: "webkit", device: null },
    steps: ["Create a contact named José", "Search for Jose"],
    expected: "José is found",
    actual: "No results",
    failingTest: null,
    reportedVia: "cli",
    sweepId: null,
    ...over,
  });

describe("intake", () => {
  it("renders an issue whose report block reads back verbatim, and refuses what is not a report", () => {
    const r = report({ failingTest: { path: "features/contacts/acceptance/x.spec.ts", content: "test('x', () => {})" } });
    const body = renderBugIssueBody(r);
    expect(body).toContain("1. Create a contact named José");
    expect(parseBugIssueBody(body)).toEqual(r);
    expect(parseBugIssueBody("no block here")).toBeNull();
    expect(parseBugIssueBody('```wos-bug-report\n{"schema":"nope"}\n```')).toBeNull();
    expect(bugIssueTitle(r)).toBe("[bug][web] Search ignores accented names");
  });

  it("requires reproduction steps and binds sweep reports to their sweep", () => {
    expect(() => report({ steps: [] })).toThrow();
    expect(bugReportRefusals(report())).toEqual([]);
    expect(bugReportRefusals(report({ reportedVia: "sweep" }))).toHaveLength(1);
  });
});

describe("triage decisions", () => {
  const base = {
    schema: "wos-triage-decision.v1",
    bug: "BUG-42",
    decidedBy: { kind: "agent", taskId: U(1), leaseId: U(2) },
    reproduced: true,
    reproduction: { commit: SHA("a"), surface: "web", notes: "Reproduced on main at the given commit in webkit.", failingTestRan: true },
    outcome: "fix",
    severity: "high",
    duplicateOf: null,
    mapping: {
      feature: "contacts",
      contractVersion: 2,
      requirements: ["R-001"],
      abus: ["contacts#03"],
      files: ["modules/contacts/api/search.ts"],
    },
    rationale: "The merged contract requires accent-insensitive search (R-001); the code compares bytes.",
    decidedAt: "2026-09-30T00:00:00Z",
  };
  it("accepts a consistent decision", () => expect(TriageDecision.safeParse(base).error?.issues ?? []).toEqual([]));
  it.each([
    ["a fix without a reproduction", { reproduced: false, reproduction: null }],
    ["a fix without the mapping", { mapping: null }],
    ["a duplicate without duplicateOf", { outcome: "duplicate", severity: null, mapping: null }],
    ["its own duplicate", { outcome: "duplicate", duplicateOf: "BUG-42" }],
    ["wont_fix by an agent", { outcome: "wont_fix" }],
    ["not_reproducible while reproduced", { outcome: "not_reproducible" }],
  ])("refuses %s", (_n, over) => expect(TriageDecision.safeParse({ ...base, ...over }).success).toBe(false));
});

describe("red then green", () => {
  const T = "features/contacts/acceptance/acme-crm/web/regressions/BUG-42.spec.ts";
  const e = (over: Partial<RedGreenEvidence> = {}): RedGreenEvidence => ({
    bug: "BUG-42",
    feature: "contacts",
    regressionTest: T,
    parent: { sha: SHA("a"), conclusion: "failure", failedTests: [T] },
    head: { sha: SHA("b"), conclusion: "success", failedTests: [] },
    testSha256: `sha256:${"c".repeat(64)}`,
    ...over,
  });
  it("passes when the test fails on the parent and passes on the head", () => expect(redGreenRefusals(e())).toEqual([]));
  it("refuses green-first, a parent failing for another test, a red head, and one commit", () => {
    expect(redGreenRefusals(e({ parent: { sha: SHA("a"), conclusion: "success", failedTests: [] } }))).toHaveLength(1);
    expect(redGreenRefusals(e({ parent: { sha: SHA("a"), conclusion: "failure", failedTests: ["other.spec.ts"] } }))).toHaveLength(1);
    expect(redGreenRefusals(e({ head: { sha: SHA("b"), conclusion: "failure", failedTests: [T] } }))).toHaveLength(1);
    expect(redGreenRefusals(e({ head: { sha: SHA("a"), conclusion: "success", failedTests: [] } }))).toHaveLength(1);
  });
});

describe("sweeps output bug reports only", () => {
  const spec: BugSweep = {
    schema: "wos-bug-sweep.v1",
    id: U(9),
    openedBy: "schedule",
    commit: SHA("d"),
    features: ["contacts"],
    surfaces: ["web", "ios"],
    browsers: ["chromium", "webkit"],
    explore: true,
  };
  const out = (over: Partial<SweepOutput> = {}): SweepOutput => ({
    schema: "wos-sweep-output.v1",
    sweepId: U(9),
    commit: SHA("d"),
    journeysRun: [
      { feature: "contacts", journey: "J-001", surface: "web", browser: "webkit", result: "failed" },
      { feature: "contacts", journey: "J-002", surface: "ios", browser: null, result: "passed" },
    ],
    reports: [report({ reportedVia: "sweep", sweepId: U(9) })],
    ...over,
  });
  it("accepts reports within the sweep", () => expect(sweepOutputRefusals(spec, out())).toEqual([]));
  it("refuses a surface, browser or feature outside the sweep, a foreign report, and a silent failure", () => {
    expect(sweepOutputRefusals(spec, out({ reports: [] }))).toEqual(["failed journeys need at least one bug report"]);
    expect(sweepOutputRefusals(spec, out({ reports: [report()] }))).toHaveLength(1);
    const j = out().journeysRun;
    expect(sweepOutputRefusals(spec, out({ journeysRun: [{ ...j[1]!, surface: "android" }] }))).toHaveLength(1);
    expect(sweepOutputRefusals(spec, out({ journeysRun: [{ ...j[1]!, feature: "deals" }] }))).toHaveLength(1);
    expect(sweepOutputRefusals(spec, out({ journeysRun: [{ ...j[1]!, browser: "firefox" }] }))).toHaveLength(1);
  });
});

describe("holds and priority", () => {
  const abus = [
    { key: "contacts#04", feature: "contacts", state: "ready" as const, fix: false },
    { key: "contacts#05", feature: "contacts", state: "pending_dependencies" as const, fix: false },
    { key: "contacts#06", feature: "contacts", state: "in_progress" as const, fix: false },
    { key: "contacts#09", feature: "contacts", state: "ready" as const, fix: true },
    { key: "deals#01", feature: "deals", state: "ready" as const, fix: false },
  ];
  const decision = { outcome: "fix" as const, severity: "critical" as const, mapping: { feature: "contacts" } as never };

  it("a critical bug holds the unstarted NEW feature ABUs of its feature, never its fix or other features", () => {
    expect(computeBugHolds(BUGS_POLICY_V1, decision, abus)).toEqual(["contacts#04", "contacts#05"]);
    expect(computeBugHolds(BUGS_POLICY_V1, { ...decision, severity: "high" }, abus)).toEqual([]);
    expect(computeBugHolds(BUGS_POLICY_V1, { ...decision, outcome: "duplicate" }, abus)).toEqual([]);
    expect(computeBugHolds({ criticalHoldsFeature: false }, decision, abus)).toEqual([]);
  });

  it("uses the D60 hold overlay (one machine, both sources)", () => {
    expect(ArchitectureHoldMachine).toBe(WorkHoldMachine);
    expect(WorkHoldMachine.name).toBe("work_hold");
  });

  it("ranks fixes by severity, migrations above all but critical, and never offers held units", () => {
    const P = { migrationBoost: ARCHITECTURE_POLICY_V1.migrationBoost, severityBoost: BUGS_POLICY_V1.severityBoost };
    const c = (unitId: string, baseScore: number, extra: object = {}) => ({
      unitId,
      baseScore,
      migrationOf: null,
      bugSeverity: null,
      holds: [],
      ...extra,
    });
    const ranked = rankBuildNext(P, [
      c("contacts#04", 500, { holds: [{ state: "held" }] }),
      c("deals#01", 400),
      c("contacts#09", 100, { bugSeverity: "critical" }),
      c("adr-001#01", 60, { migrationOf: "ADR-001" }),
      c("deals#07", 100, { bugSeverity: "medium" }),
      c("deals#08", 100, { bugSeverity: "low" }),
    ]).map((u) => u.unitId);
    expect(ranked).toEqual(["contacts#09", "adr-001#01", "deals#01", "deals#07", "deals#08"]);
  });
});

describe("the bug machine and events", () => {
  it("goes reported -> triaging -> confirmed -> fixed, or to a contract revision, or closed", () => {
    expect(findTransition(BugMachine, "reported", "triage_claimed")?.to).toBe("triaging");
    expect(findTransition(BugMachine, "triaging", "confirm")?.to).toBe("confirmed");
    expect(findTransition(BugMachine, "triaging", "needs_revision")?.to).toBe("contract_revision");
    expect(findTransition(BugMachine, "confirmed", "fix_merged")?.to).toBe("fixed");
    expect(findTransition(BugMachine, "triaging", "close")?.to).toBe("closed");
    expect(findTransition(BugMachine, "reported", "fix_merged")).toBeUndefined();
    expect(findTransition(BugMachine, "closed", "reopen")?.actor).toEqual(["maintainer"]);
  });
  it("publishes the triage with the decision hash the protocol binds to", () => {
    const ev = {
      type: "bug.triaged",
      v: 1,
      visibility: "public",
      payload: {
        bug: "BUG-42",
        outcome: "fix",
        severity: "high",
        feature: "contacts",
        decisionSha256: `sha256:${"e".repeat(64)}`,
        fixAbu: "contacts#09",
      },
    };
    expect(DomainEventBody.safeParse(ev).success).toBe(true);
  });
});
