import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GAUGE_C, gaugeFraction, gaugeModel, tickLine } from "../apps/web/lib/gauge.mjs";
import {
  type ChangelogEntry,
  GRANDFATHERED_UNASSESSED,
  type GapRun,
  buildGapRegister,
  checkAssessedGate,
  extractChangelog,
  extractGapCitations,
  extractVersion,
  latestGapRunPerVersion,
  selfAssessmentPending,
  unmentionedHighGaps,
} from "../apps/web/scripts/wp-history-lib.mjs";

// The white paper's self-assessment rule (paper v0.9): the version gate, the gap register, the pending state, the
// workflow's wait for the deployed version, and the score gauges. Fixture data only; no network beyond a local fake
// server; no model calls.

const root = join(import.meta.dirname, "..");
const run = promisify(execFile);

// ------------------------------------------------------------------ fixtures (test data only, never written to docs/)
type Gap = NonNullable<GapRun["block"]["gaps"]>[number];
const gap = (id: string, severity: Gap["severity"] = "high", part: Gap["part"] = "I"): Gap => ({
  id,
  title: `Fixture gap ${id}`,
  concerns: "section 3",
  part,
  severity,
});
let seq = 0;
const runOf = (
  version: string,
  gaps: Gap[] | undefined,
  recordedAt = `2026-10-0${++seq % 9}T12:00:00.000Z`,
  model = "fixture-model",
): GapRun => {
  const id = `${recordedAt.slice(0, 10)}-v${version}-fixture-${seq}`;
  return {
    id,
    recordedAt,
    servedPaperVersion: version,
    reportFile: `${id}.md`,
    block: { schema: gaps ? "wos-assessment/v2" : "wos-assessment/v1", evaluator: { model }, ...(gaps ? { gaps } : {}) },
  };
};
const entry = (version: string, ...lines: string[]): ChangelogEntry => ({ version, heading: `### v${version}`, text: lines.join("\n") });

// ------------------------------------------------------------------ the gate: no version superseded unassessed
describe("checkAssessedGate: a new version cannot ship until the previous one has a recorded self-assessment", () => {
  const versions = ["0.1", "0.2", "0.3", "0.4", "0.5", "0.6", "0.7", "0.8", "0.9", "0.10"];

  it("passes when the previous version has a run (servedPaperVersion match)", () => {
    expect(checkAssessedGate("0.10", versions, [{ servedPaperVersion: "0.9" }])).toEqual({ ok: true, errors: [] });
  });

  it("fails when the previous version has no run, and names it", () => {
    const r = checkAssessedGate("0.10", versions, []);
    expect(r.ok).toBe(false);
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]).toMatch(/v0\.9 is superseded by v0\.10 but has no recorded self-assessment/);
  });

  it("does not count a run of another version, or the agent's own reported version", () => {
    expect(checkAssessedGate("0.10", versions, [{ servedPaperVersion: "0.10" }, { servedPaperVersion: "0.8" }]).ok).toBe(false);
  });

  it("compares versions numerically (0.9 = 0.9.0) and checks patch versions too", () => {
    expect(checkAssessedGate("0.10", versions, [{ servedPaperVersion: "0.9.0" }]).ok).toBe(true);
    const r = checkAssessedGate("0.9.2", ["0.8", "0.9", "0.9.1", "0.9.2"], [{ servedPaperVersion: "0.9" }]);
    expect(r.errors).toEqual([expect.stringMatching(/^v0\.9\.1 is superseded/)]);
  });

  it("never requires the current version (it cannot be assessed before it is deployed)", () => {
    expect(checkAssessedGate("0.9", versions.slice(0, 9), []).ok).toBe(true);
  });

  it("grandfathers v0.1 to v0.8 by a frozen list, and nothing else", () => {
    expect([...GRANDFATHERED_UNASSESSED]).toEqual(["0.1", "0.2", "0.3", "0.4", "0.5", "0.6", "0.7", "0.8"]);
    expect(Object.isFrozen(GRANDFATHERED_UNASSESSED)).toBe(true);
    expect(checkAssessedGate("0.9", versions.slice(0, 9), []).ok).toBe(true);
    // Without the list every old version would fail: the list, not an accident, is what exempts them.
    expect(checkAssessedGate("0.9", versions.slice(0, 9), [], []).errors).toHaveLength(8);
  });

  it("the live repository passes (the paper's changelog versions against docs/assessments)", async () => {
    const out = await run(process.execPath, ["--no-warnings", "apps/web/scripts/check-whitepaper-version.mjs"], { cwd: root });
    expect(out.stdout).toMatch(/check-whitepaper-version: OK/);
    const paper = readFileSync(join(root, "docs/whitepaper/WHITEPAPER.md"), "utf8");
    expect(extractVersion(paper)).toBe("0.9");
  });
});

// ------------------------------------------------------------------ the pending state
describe("selfAssessmentPending", () => {
  it("is pending until a run of that version is recorded", () => {
    expect(selfAssessmentPending("0.9", [])).toBe(true);
    expect(selfAssessmentPending("0.9", [{ servedPaperVersion: "0.8" }])).toBe(true);
    expect(selfAssessmentPending("0.9", [{ servedPaperVersion: "0.9" }])).toBe(false);
  });

  it("the site shows it for the current version while docs/assessments has no run of it", () => {
    const runs = (
      JSON.parse(readFileSync(join(root, "apps/web/generated/assessments.json"), "utf8")) as { runs: { servedPaperVersion: string }[] }
    ).runs;
    const current = extractVersion(readFileSync(join(root, "docs/whitepaper/WHITEPAPER.md"), "utf8"))!;
    const changesMd = readFileSync(join(root, "apps/web/lib/whitepaper-history.ts"), "utf8");
    expect(changesMd).toMatch(/SELF-ASSESSMENT PENDING/);
    if (selfAssessmentPending(current, runs)) {
      expect(readFileSync(join(root, "apps/web/lib/self-assessment.ts"), "utf8")).toMatch(/PENDING_LABEL = "SELF-ASSESSMENT PENDING"/);
    }
  });
});

// ------------------------------------------------------------------ the gap register
describe("extractGapCitations: the changelog convention", () => {
  it("reads addressed and declined lines, with or without a bullet or bold, one reason per declined line", () => {
    const c = extractGapCitations([
      entry(
        "0.10",
        "- **Gaps addressed:** `duplication-share-unsourced`, `no-pilot-data`",
        "- Gap declined: `token-needed`: a token is out of scope until the protocol is reviewed.",
        "Gaps declined: `a-b-c` — not in this paper's scope",
        "- A bullet that mentions `not-a-citation` in passing.",
      ),
    ]);
    expect(c).toEqual([
      { version: "0.10", kind: "addressed", id: "duplication-share-unsourced", reason: null },
      { version: "0.10", kind: "addressed", id: "no-pilot-data", reason: null },
      { version: "0.10", kind: "declined", id: "token-needed", reason: "a token is out of scope until the protocol is reviewed." },
      { version: "0.10", kind: "declined", id: "a-b-c", reason: "not in this paper's scope" },
    ]);
  });

  it("a declined line without a reason keeps the reason null (never invented)", () => {
    expect(extractGapCitations([entry("0.10", "Gap declined: `x-y-z`")])[0]!.reason).toBeNull();
  });
});

describe("buildGapRegister: status derivation, exact ids only", () => {
  it("uses the latest run of each version that lists gaps; v1 runs have none", () => {
    const old = runOf("0.9", [gap("old-gap")], "2026-10-01T10:00:00.000Z");
    const newer = runOf("0.9", [gap("new-gap")], "2026-10-02T10:00:00.000Z");
    const v1 = runOf("0.9", undefined, "2026-10-03T10:00:00.000Z");
    const latest = latestGapRunPerVersion([old, newer, v1]);
    expect(latest.get("0.9")?.id).toBe(newer.id);
    const r = buildGapRegister([old, newer, v1], [], "0.9");
    expect(r.gaps.map((g) => g.id)).toEqual(["new-gap"]);
    expect(r.versions).toEqual([{ version: "0.9", runId: newer.id, runs: 3, gaps: 1 }]);
  });

  it("open, addressed in a later version, declined with its reason", () => {
    const runs = [runOf("0.9", [gap("stays-open", "low"), gap("gets-fixed"), gap("gets-declined", "medium", "II")])];
    const r = buildGapRegister(
      runs,
      [
        entry("0.10", "- Gaps addressed: `gets-fixed`", "- Gap declined: `gets-declined`: out of scope."),
        entry("0.9", "- Gaps addressed: `stays-open`"),
      ],
      "0.10",
    );
    const by = Object.fromEntries(r.gaps.map((g) => [g.id, g]));
    expect(by["gets-fixed"]).toMatchObject({ status: "addressed", statusIn: "0.10", reason: null });
    expect(by["gets-declined"]).toMatchObject({ status: "declined", statusIn: "0.10", reason: "out of scope.", part: "II" });
    // A citation in the gap's own version (written before its run) does not count.
    expect(by["stays-open"]).toMatchObject({ status: "open", statusIn: null });
  });

  it("the newest later citation decides", () => {
    const runs = [runOf("0.9", [gap("flip-flop")])];
    const r = buildGapRegister(
      runs,
      [entry("0.10", "Gap declined: `flip-flop`: later"), entry("0.11", "Gaps addressed: `flip-flop`")],
      "0.11",
    );
    expect(r.gaps[0]).toMatchObject({ status: "addressed", statusIn: "0.11" });
  });

  it("matches only the exact id: a similar title or id stays a different gap", () => {
    const runs = [runOf("0.9", [gap("duplication-share-unsourced")])];
    const r = buildGapRegister(runs, [entry("0.10", "Gaps addressed: `duplication-share-unsourced-2`, `duplication-share`")], "0.10");
    expect(r.gaps[0]!.status).toBe("open");
    expect(r.unknownCitations.map((c) => c.id)).toEqual(["duplication-share-unsourced-2", "duplication-share"]);
  });

  it("notes the other versions that reported the same id, and sorts newest version first, then by severity", () => {
    const runs = [runOf("0.9", [gap("shared-id", "low"), gap("only-old")]), runOf("0.10", [gap("shared-id", "medium"), gap("z-high")])];
    const r = buildGapRegister(runs, [], "0.10");
    expect(r.gaps.map((g) => `${g.version}:${g.id}`)).toEqual(["0.10:z-high", "0.10:shared-id", "0.9:only-old", "0.9:shared-id"]);
    expect(r.gaps.find((g) => g.version === "0.9" && g.id === "shared-id")!.alsoReportedIn).toEqual(["0.10"]);
  });

  it("no runs: an empty register", () => {
    expect(buildGapRegister([], [], "0.9")).toEqual({
      schema: "wos-gap-register/v1",
      current: "0.9",
      versions: [],
      gaps: [],
      unknownCitations: [],
    });
  });

  it("the committed register is the one the build derives (sync-shared --check covers it; here: its shape)", () => {
    const r = JSON.parse(readFileSync(join(root, "apps/web/generated/gap-register.json"), "utf8"));
    expect(r.schema).toBe("wos-gap-register/v1");
    expect(r.current).toBe(extractVersion(readFileSync(join(root, "docs/whitepaper/WHITEPAPER.md"), "utf8")));
  });
});

describe("unmentionedHighGaps: the gate's warning", () => {
  const runs = [runOf("0.9", [gap("high-one"), gap("high-two"), gap("medium-one", "medium")])];

  it("lists the previous version's high gaps the new entry neither addresses nor declines", () => {
    const changelog = [entry("0.10", "- Gaps addressed: `high-one`"), ...extractChangelog("")];
    expect(unmentionedHighGaps(runs, changelog, "0.10")).toEqual({ version: "0.9", ids: ["high-two"] });
    expect(unmentionedHighGaps(runs, [entry("0.10", "Gaps addressed: `high-one`", "Gap declined: `high-two`: why")], "0.10")!.ids).toEqual(
      [],
    );
  });

  it("is null when the previous version has no run with gaps", () => {
    expect(unmentionedHighGaps([], [], "0.10")).toBeNull();
    expect(unmentionedHighGaps([runOf("0.9", undefined)], [], "0.10")).toBeNull();
  });
});

// ------------------------------------------------------------------ the workflow's wait for the deployed version
describe("tools/assessments/wait-for-version.ts (local fake site)", () => {
  let server: Server;
  let site = "";
  let script: (n: number) => { status: number; version: string | null } = () => ({ status: 200, version: "0.9" });
  let hits = 0;
  beforeAll(async () => {
    server = createServer((req, res) => {
      if (!req.url?.startsWith("/whitepaper.md")) {
        res.statusCode = 404;
        res.end();
        return;
      }
      const s = script(hits++);
      res.statusCode = s.status;
      res.end(s.version ? `# warOnSaaS\n\n| Field | Value |\n|---|---|\n| Version | ${s.version} |\n` : "# no table\n");
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    site = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => server.close());

  const wait = (args: string[]) =>
    run(
      process.execPath,
      ["--no-warnings", join(root, "tools/assessments/wait-for-version.ts"), "--site", site, "--interval-s", "0.05", ...args],
      {
        cwd: root,
      },
    ).then(
      (r) => ({ code: 0, out: r.stdout + r.stderr }),
      (e: { code: number; stdout: string; stderr: string }) => ({ code: e.code, out: e.stdout + e.stderr }),
    );

  it("returns at once when the site serves the version", async () => {
    hits = 0;
    script = () => ({ status: 200, version: "0.9" });
    const r = await wait(["--version", "0.9", "--timeout-min", "0.05"]);
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/serves v0\.9 \(after 1 attempt/);
  });

  it("keeps polling through an older version and HTTP errors until the new one is live", async () => {
    hits = 0;
    script = (n) => (n === 0 ? { status: 500, version: null } : n < 3 ? { status: 200, version: "0.8" } : { status: 200, version: "0.9" });
    const r = await wait(["--version", "0.9", "--timeout-min", "0.1"]);
    expect(r.code, r.out).toBe(0);
    expect(r.out).toMatch(/HTTP 500/);
    expect(r.out).toMatch(/serves v0\.8, waiting for v0\.9/);
    expect(r.out).toMatch(/after 4 attempt/);
  });

  it("fails clearly on timeout", async () => {
    hits = 0;
    script = () => ({ status: 200, version: "0.8" });
    const r = await wait(["--version", "0.9", "--timeout-min", "0.005"]);
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/timed out .*still serves v0\.8, not v0\.9/);
  });

  it("stops at once when the site is already ahead of the checkout", async () => {
    hits = 0;
    script = () => ({ status: 200, version: "0.10" });
    const r = await wait(["--version", "0.9", "--timeout-min", "0.1"]);
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/serves v0\.10, newer than this checkout's v0\.9/);
    expect(hits).toBe(1);
  });

  it("defaults to the version in the checkout's paper", async () => {
    hits = 0;
    const v = extractVersion(readFileSync(join(root, "docs/whitepaper/WHITEPAPER.md"), "utf8"))!;
    script = () => ({ status: 200, version: v });
    expect((await wait(["--timeout-min", "0.05"])).code).toBe(0);
  });
});

// ------------------------------------------------------------------ the workflow itself (static checks)
describe(".github/workflows/self-assessment.yml", () => {
  const wf = readFileSync(join(root, ".github/workflows/self-assessment.yml"), "utf8");
  const siteSync = readFileSync(join(root, ".github/workflows/site-sync.yml"), "utf8");

  it("runs after a paper change on main and by hand, one at a time, with a timeout", () => {
    expect(wf).toMatch(/push:\n\s+branches: \[main\]\n\s+paths:\n\s+- "docs\/whitepaper\/WHITEPAPER\.md"\n\s+workflow_dispatch:/);
    expect(wf).toMatch(/concurrency:\n\s+group: self-assessment\n\s+cancel-in-progress: false/);
    expect(wf).toMatch(/timeout-minutes: \d+/);
  });

  it("fails clearly without the founder's token, waits for the deployed version, runs Claude with the pinned default", () => {
    expect(wf).toMatch(/if \[ -z "\$CLAUDE_CODE_OAUTH_TOKEN" \]; then[\s\S]*?exit 1/);
    expect(wf).toMatch(/node tools\/assessments\/wait-for-version\.ts/);
    expect(wf).toMatch(/node tools\/assessments\/run-reference\.ts --cli claude --commit/);
    // No model override, no skipped live-prompt check, no accepted version mismatch.
    const steps = wf
      .split("\n")
      .filter((l) => !l.trim().startsWith("#"))
      .join("\n");
    expect(steps).not.toMatch(/--model|--no-live-check|--accept-version-mismatch|--cli codex/);
  });

  it("pushes only the run's files, as adventurini", () => {
    expect(wf).toMatch(
      /allowed='\^\(docs\/assessments\/\[\^\/\]\+\\\.\(json\|md\)\|apps\/web\/generated\/\(assessments\|gap-register\)\\\.json\)\$'/,
    );
    expect(wf).toMatch(/user\.name=adventurini -c user\.email=anthonydventurini@gmail\.com/);
  });

  it("site-sync ignores recorded runs", () => {
    expect(siteSync).toMatch(/- "!docs\/assessments\/\*\*"/);
  });
});

// ------------------------------------------------------------------ the score gauges
describe("gauge model (components/Gauge.tsx draws it)", () => {
  it("arc maths: 0, 50 and 100 of 100", () => {
    expect(gaugeFraction(0, 100)).toBe(0);
    expect(gaugeFraction(50, 100)).toBe(0.5);
    expect(gaugeFraction(100, 100)).toBe(1);
    const half = gaugeModel({ label: "IMPORTANCE", value: 50, max: 100 });
    const [drawn, rest] = half.dasharray.split(" ").map(Number);
    expect(drawn! + rest!).toBeCloseTo(GAUGE_C, 2);
    expect(drawn).toBeCloseTo(GAUGE_C / 2, 2);
    expect(gaugeModel({ label: "X", value: 0, max: 100 }).dasharray.startsWith("0 ")).toBe(true);
    expect(Number(gaugeModel({ label: "X", value: 100, max: 100 }).dasharray.split(" ")[1])).toBeCloseTo(0, 5);
  });

  it("clamps out-of-range values and never divides by a bad scale", () => {
    expect(gaugeFraction(120, 100)).toBe(1);
    expect(gaugeFraction(-5, 100)).toBe(0);
    expect(gaugeFraction(Number.NaN, 100)).toBe(0);
    expect(gaugeFraction(5, 0)).toBe(0);
  });

  it("draws a 0-10 score on its own scale, never as a percentage", () => {
    const m = gaugeModel({ label: "CONTROL IMPORTANCE", value: 6, max: 10 });
    expect(m.fraction).toBe(0.6);
    expect(m.centre).toBe("6");
    expect(m.ariaLabel).toBe("CONTROL IMPORTANCE 6 out of 10");
    expect(m.ticks).toEqual([]);
  });

  it("aria label and ticks at 50 and 90 on a 0-100 scale", () => {
    const m = gaugeModel({ label: "Importance", value: 82, max: 100 });
    expect(m.ariaLabel).toBe("Importance 82 out of 100");
    expect(m.state).toBe("value");
    expect(m.ticks).toEqual([0.5, 0.9]);
    // 12 o'clock is 0; half way round is 6 o'clock (straight down from the centre).
    const t = tickLine(0.5);
    expect(t.x1).toBeCloseTo(50, 5);
    expect(t.y1).toBeGreaterThan(50);
  });

  it("pending: empty ring, no number, PENDING", () => {
    const m = gaugeModel({ label: "Importance", value: 82, max: 100, pending: true });
    expect(m).toMatchObject({ state: "pending", value: null, fraction: 0, centre: "PENDING" });
    expect(m.ariaLabel).toBe("Importance: self-assessment pending, no score yet");
    expect(m.ariaLabel).not.toMatch(/\d/);
  });

  it("a missing field is n/a, never a filled-in value", () => {
    for (const value of [null, undefined, Number.NaN]) {
      const m = gaugeModel({ label: "Credibility", value, max: 100 });
      expect(m).toMatchObject({ state: "na", value: null, fraction: 0, centre: "n/a" });
      expect(m.ariaLabel).toBe("Credibility: not available in this run");
    }
  });
});
