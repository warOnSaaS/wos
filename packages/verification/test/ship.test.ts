import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";
import { lintProductWorkflow } from "../src/index.js";
import { REPO_ROOT, TempRepo } from "./support/git-fixture.js";

const SHIP = join(REPO_ROOT, "scripts/ship.sh");
const REQUIRED = ["typecheck, lint, test", "db:test", "adversarial db suite"];
const created: TempRepo[] = [];
afterAll(() => {
  for (const r of created) r.remove();
});

/** A bare "origin", a clone with one pushed commit, and fake CI / migrate / deploy commands that log. */
function setup() {
  const origin = new TempRepo("ship-origin", { bare: true });
  const work = new TempRepo("ship-work");
  created.push(origin, work);
  work.git(["remote", "add", "origin", origin.dir]);
  work.write("README.md", "x\n").commit("init");
  work.git(["push", "-q", "-u", "origin", "main"]);
  const log = join(origin.dir, "ship.log");
  const ciFile = join(origin.dir, "ci.json");
  const green = (sha: string, over: Record<string, { status?: string; conclusion?: string | null }> = {}) =>
    writeFileSync(
      ciFile,
      JSON.stringify({
        check_runs: REQUIRED.map((name) => ({ name, head_sha: sha, status: "completed", conclusion: "success", ...over[name] })),
      }),
    );
  green(work.git(["rev-parse", "HEAD"]));
  const env = {
    DATABASE_MIGRATION_URL: "postgres://unused",
    WOS_SHIP_CI_CMD: `cat '${ciFile}'`,
    WOS_SHIP_MIGRATE_CMD: `f(){ echo migrate $1 >> '${log}'; }; f`,
    WOS_SHIP_DEPLOY_CMD: `echo deploy >> '${log}'`,
  };
  const ship = (extraEnv: Record<string, string> = {}, args: string[] = []) => {
    const res = work.run("bash", [SHIP, ...args], { ...env, ...extraEnv });
    let steps: string[] = [];
    try {
      steps = readFileSync(log, "utf8").trim().split("\n").filter(Boolean);
    } catch {}
    return { ...res, steps };
  };
  return { origin, work, ship, green, ciFile, log, env };
}

describe("ship-gate-and-migrations: scripts/ship.sh (D7)", () => {
  it("ships a clean, pushed, green HEAD by the right author: migrations checked, applied, then deploy", () => {
    const { ship } = setup();
    const r = ship();
    expect(r.status, r.out).toBe(0);
    expect(r.steps).toEqual(["migrate check", "migrate apply", "deploy"]);
    expect(r.out).toContain("shipped");
  });

  it("--dry-run checks migrations but neither applies nor deploys", () => {
    const { ship } = setup();
    const r = ship({}, ["--dry-run"]);
    expect(r.status, r.out).toBe(0);
    expect(r.steps).toEqual(["migrate check"]);
  });

  const refusals: Array<[string, (s: ReturnType<typeof setup>) => Record<string, string> | undefined, RegExp]> = [
    ["a modified tracked file", (s) => void s.work.write("README.md", "changed\n"), /dirty/],
    ["an untracked file", (s) => void s.work.write("new.txt", "x"), /dirty/],
    ["a staged change", (s) => void (s.work.write("README.md", "y"), s.work.git(["add", "README.md"])), /dirty/],
    [
      "an unpushed commit",
      (s) => {
        const sha = s.work.write("b.txt", "b").commit("local only");
        s.green(sha);
      },
      /not pushed/,
    ],
    [
      "HEAD behind the remote",
      (s) => {
        const other = new TempRepo("ship-other", { dir: undefined });
        created.push(other);
        other.git(["remote", "add", "origin", s.origin.dir]);
        other.git(["pull", "-q", "origin", "main"]);
        other.write("c.txt", "c").commit("newer");
        other.git(["push", "-q", "origin", "main"]);
      },
      /behind/,
    ],
    ["a detached HEAD", (s) => void s.work.git(["checkout", "-q", "--detach"]), /not main|detached/],
    [
      "a HEAD commit by another author (pushed and green)",
      (s) => {
        const sha = s.work.write("d.txt", "d").commit("by someone else", { GIT_AUTHOR_NAME: "mallory", GIT_AUTHOR_EMAIL: "m@example.com" });
        s.work.git(["push", "-q", "origin", "main"]);
        s.green(sha);
      },
      /author/,
    ],
    [
      "a failing required check",
      (s) => void s.green(s.work.git(["rev-parse", "HEAD"]), { "db:test": { conclusion: "failure" } }),
      /db:test is completed\/failure/,
    ],
    [
      "a check still running",
      (s) => void s.green(s.work.git(["rev-parse", "HEAD"]), { "typecheck, lint, test": { status: "in_progress", conclusion: null } }),
      /in_progress/,
    ],
    [
      "a missing required check",
      (s) => {
        const sha = s.work.git(["rev-parse", "HEAD"]);
        writeFileSync(
          s.ciFile,
          JSON.stringify({ check_runs: [{ name: "db:test", head_sha: sha, status: "completed", conclusion: "success" }] }),
        );
      },
      /missing typecheck, lint, test/,
    ],
    [
      "an extra red check that is not required",
      (s) => {
        const sha = s.work.git(["rev-parse", "HEAD"]);
        s.green(sha);
        const j = JSON.parse(readFileSync(s.ciFile, "utf8"));
        j.check_runs.push({ name: "other", head_sha: sha, status: "completed", conclusion: "failure" });
        writeFileSync(s.ciFile, JSON.stringify(j));
      },
      /other is failure/,
    ],
    ["green checks for a different sha", (s) => void s.green("f".repeat(40)), /missing/],
    ["an unreadable CI status", (s) => void writeFileSync(s.ciFile, "<html>rate limited</html>"), /unreadable/],
    ["a failing CI status command", () => ({ WOS_SHIP_CI_CMD: "exit 3" }), /CI status command failed/],
    ["no DATABASE_MIGRATION_URL", () => ({ DATABASE_MIGRATION_URL: "" }), /DATABASE_MIGRATION_URL/],
  ];

  for (const [name, arrange, message] of refusals) {
    it(`refuses ${name}, before any migration or deploy`, () => {
      const s = setup();
      const extra = arrange(s) ?? {};
      const r = s.ship(extra);
      expect(r.status, r.out).toBe(1);
      expect(r.out).toMatch(/REFUSED/);
      expect(r.out).toMatch(message);
      expect(r.steps).toEqual([]);
    });
  }

  it("stops before deploy when the migration check fails (edited migration)", () => {
    const s = setup();
    const r = s.ship({ WOS_SHIP_MIGRATE_CMD: `f(){ echo migrate $1 >> '${s.log}'; [ "$1" != check ]; }; f` });
    expect(r.status).toBe(1);
    expect(r.steps).toEqual(["migrate check"]);
  });

  it("does not deploy when applying migrations fails", () => {
    const s = setup();
    const r = s.ship({ WOS_SHIP_MIGRATE_CMD: `f(){ echo migrate $1 >> '${s.log}'; [ "$1" != apply ]; }; f` });
    expect(r.status).toBe(1);
    expect(r.steps).toEqual(["migrate check", "migrate apply"]);
    expect(r.out).toMatch(/nothing deployed/);
  });

  it("warns loudly when a test seam is set", () => {
    const r = setup().ship();
    expect(r.out).toMatch(/WARNING: WOS_SHIP_CI_CMD is overridden/);
  });

  it("requires exactly the job names of the platform CI workflow", () => {
    const wf = parseYaml(readFileSync(join(REPO_ROOT, ".github/workflows/ci.yml"), "utf8")) as { jobs: Record<string, { name: string }> };
    expect(
      Object.values(wf.jobs)
        .map((j) => j.name)
        .sort(),
    ).toEqual([...REQUIRED].sort());
    expect(readFileSync(SHIP, "utf8")).toContain(`WOS_SHIP_REQUIRED_CHECKS:-${REQUIRED.join("|")}`);
  });
});

describe("platform CI (.github/workflows/ci.yml)", () => {
  const raw = readFileSync(join(REPO_ROOT, ".github/workflows/ci.yml"), "utf8");
  const wf = parseYaml(raw) as { on: Record<string, unknown>; permissions: unknown; jobs: Record<string, { steps: { run?: string }[] }> };
  const runs = Object.values(wf.jobs).flatMap((j) => j.steps.map((s) => s.run ?? ""));

  it("runs on every pull request and in the merge queue, read-only, with no secrets", () => {
    expect(Object.keys(wf.on)).toEqual(expect.arrayContaining(["pull_request", "merge_group"]));
    expect(wf.permissions).toEqual({ contents: "read" });
    expect(lintProductWorkflow(raw, wf).filter((i) => i.rule !== "triggers")).toEqual([]);
  });
  it.each(["npm run typecheck", "npm run lint", "npm test", "npm run db:test", "node packages/verification/bin/scan-secrets.mjs ."])(
    "runs %s",
    (cmd) => {
      expect(runs).toContain(cmd);
    },
  );
  it("installs without lifecycle scripts", () => {
    expect(runs.filter((r) => r.startsWith("npm ci"))).toEqual(runs.filter((r) => r === "npm ci --ignore-scripts"));
  });
});
