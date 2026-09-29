import { execFileSync } from "node:child_process";
import { cpSync, existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { RepoManifest } from "@waronsaas/contracts";
import { VERIFY_CHECK_NAME } from "@waronsaas/github";
import { afterAll, describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";
import { lintProductWorkflow, validateChangeset } from "../src/index.js";
import { REPO_ROOT, TempRepo } from "./support/git-fixture.js";

const SUITE = join(REPO_ROOT, "templates/suite");
const read = (p: string) => readFileSync(join(REPO_ROOT, p), "utf8");
type Wf = {
  on: Record<string, unknown>;
  permissions: unknown;
  jobs: Record<string, { name?: string; steps: { run?: string; uses?: string }[] }>;
};

describe("templates/suite: wos.json", () => {
  const manifest = RepoManifest.parse(JSON.parse(read("templates/suite/wos.json")));

  it("parses as RepoManifest and never runs lifecycle scripts on install (S-7)", () => {
    expect(manifest.install).toEqual(["npm", "ci", "--ignore-scripts"]);
  });
  it("protects .github/**, wos.json, the document directories and the toolchain configs (S-17)", () => {
    for (const p of [".github/**", "wos.json", "catalog/**", "roadmaps/**", "features/**", ".npmrc", "vitest.config.ts"])
      expect(manifest.protectedPaths).toContain(p);
  });
  it("treats package.json as a lockfile so CI's own commands cannot be redefined in scope (B-0005)", () => {
    expect(manifest.lockfiles).toEqual(expect.arrayContaining(["package-lock.json", "package.json"]));
    const scripts = Buffer.from(JSON.stringify({ scripts: { test: "true" } }));
    const r = validateChangeset(
      {
        parentCommit: "a".repeat(40),
        submissionSha256: "",
        files: [
          {
            op: "upsert",
            path: "package.json",
            mode: "100644",
            contentBase64: scripts.toString("base64"),
            sha256: "",
            bytes: scripts.length,
          },
        ],
      } as never,
      {
        kind: "abu",
        abu: { scope: { write: ["package.json", "modules/x/**"], read: [] }, resources: [] } as never,
        documentPaths: [],
        repoManifest: manifest,
        existingPaths: new Set(["package.json"]),
      },
    );
    expect(r.errors.map((e) => e.code)).toContain("LOCKFILE_WITHOUT_RESOURCE");
  });
});

describe("templates/suite: workflows (S-20)", () => {
  const dir = join(SUITE, ".github/workflows");
  const files = readdirSync(dir).filter((f) => /\.ya?ml$/.test(f));

  it("has wos-verify.yml", () => expect(files).toContain("wos-verify.yml"));

  for (const f of files) {
    it(`${f}: no secrets, contents: read, no privileged triggers or environments`, () => {
      const raw = readFileSync(join(dir, f), "utf8");
      expect(lintProductWorkflow(raw, parseYaml(raw), { requireVerifyTriggers: f === "wos-verify.yml" })).toEqual([]);
    });
  }

  it("wos-verify triggers on push to wos/candidate/**, pull_request and merge_group, and its check is named wos-verify", () => {
    const wf = parseYaml(readFileSync(join(dir, "wos-verify.yml"), "utf8")) as Wf;
    expect((wf.on.push as { branches: string[] }).branches).toContain("wos/candidate/**");
    expect(Object.keys(wf.on)).toEqual(expect.arrayContaining(["push", "pull_request", "merge_group"]));
    expect(wf.permissions).toEqual({ contents: "read" });
    expect(Object.values(wf.jobs).map((j) => j.name)).toContain(VERIFY_CHECK_NAME);
    const runs = Object.values(wf.jobs).flatMap((j) => j.steps.map((s) => s.run ?? ""));
    expect(runs).toContain("node .github/wos/wos-ci.mjs scope");
    expect(runs).toContain("node .github/wos/wos-ci.mjs verify");
  });

  it("the vendored validator bundle is current with packages/verification", () => {
    execFileSync(process.execPath, [join(REPO_ROOT, "packages/verification/ci/bundle.mjs"), "--check"], { stdio: "pipe" });
  }, 60_000);
});

describe("templates/suite: CODEOWNERS and rulesets", () => {
  it("CODEOWNERS owns the gate's files", () => {
    const owners = read("templates/suite/.github/CODEOWNERS");
    for (const p of ["/.github/", "/wos.json", "/package.json", "/db/migrations/"])
      expect(owners).toMatch(new RegExp(`^${p.replace(/[.*/]/g, "\\$&")}\\s+@`, "m"));
  });

  it("the main ruleset has no bypass actors and requires wos-verify (Actions) and wos/qualified (App)", () => {
    const blocks = [...read("templates/suite/RULESETS.md").matchAll(/```json\n([\s\S]*?)```/g)].map((m) => JSON.parse(m[1] ?? ""));
    const main = blocks.find((b) => b.name === "main");
    expect(main.bypass_actors).toEqual([]);
    const checks = main.rules.find((r: { type: string }) => r.type === "required_status_checks").parameters.required_status_checks;
    expect(checks.map((c: { context: string }) => c.context).sort()).toEqual(["wos-verify", "wos/qualified"]);
    expect(main.rules.map((r: { type: string }) => r.type)).toEqual(
      expect.arrayContaining(["deletion", "non_fast_forward", "merge_queue", "pull_request"]),
    );
    const wos = blocks.find((b) => b.name === "wos-branches");
    expect(wos.bypass_actors).toHaveLength(1);
    expect(wos.bypass_actors[0].actor_type).toBe("Integration");
  });
});

describe("templates/suite: wos-ci.mjs in a real git repo", () => {
  const repos: TempRepo[] = [];
  afterAll(() => {
    for (const r of repos) r.remove();
  });

  const graph = `schema: wos-build-graph.v1
feature: contacts
contractVersion: 1
abus:
  - key: "contacts#04"
    title: List endpoint
    objective: Add the paginated contacts list endpoint with tests.
    requirements: [R-001]
    sizePoints: 2
    scope: { write: ["modules/contacts/**"] }
    acceptance:
      checks: [{ id: unit, run: ["node", "-e", "process.exit(0)"] }]
`;
  const lock = { name: "fx", version: "1.0.0", lockfileVersion: 3, requires: true, packages: { "": { name: "fx", version: "1.0.0" } } };

  function suiteRepo(manifestOver: Record<string, unknown> = {}) {
    const r = new TempRepo("suite");
    repos.push(r);
    cpSync(join(SUITE, ".github"), join(r.dir, ".github"), { recursive: true });
    const manifest = {
      ...JSON.parse(read("templates/suite/wos.json")),
      verify: [{ id: "env", run: ["node", "-e", "process.exit(process.env.FAKE_SECRET ? 7 : 0)"], timeoutSeconds: 60 }],
      ...manifestOver,
    };
    r.write("wos.json", JSON.stringify(manifest))
      .write("features/contacts/BUILD-GRAPH.yaml", graph)
      .write("modules/contacts/list.ts", "export {};\n")
      .write(
        "package.json",
        JSON.stringify({ name: "fx", version: "1.0.0", scripts: { postinstall: "node -e \"require('fs').writeFileSync('PWNED','')\"" } }),
      )
      .write("package-lock.json", JSON.stringify(lock));
    r.commit("base");
    return r;
  }
  const candidate = (r: TempRepo, change: (r: TempRepo) => void) => {
    change(r);
    r.commit("contacts#04: List endpoint\n\nwOS-Abu: contacts#04\nwOS-Attempt: 0192ab3c-0000-7000-8000-000000000009");
    return r.run(process.execPath, [".github/wos/wos-ci.mjs", "scope"]);
  };

  it("scope passes for an in-scope change", () => {
    const r = suiteRepo();
    const res = candidate(r, (x) => x.write("modules/contacts/list.ts", "export const list = 1;\n"));
    expect(res.out).toContain("scope check passed");
    expect(res.status).toBe(0);
  });

  it.each([
    ["SYMLINK_OR_SPECIAL_FILE", (x: TempRepo) => x.symlink("modules/contacts/escape", "../../../../etc/passwd")],
    ["WORKFLOW_FILE", (x: TempRepo) => x.write(".github/workflows/evil.yml", "on: push\n")],
    ["LOCKFILE_WITHOUT_RESOURCE", (x: TempRepo) => x.write("package.json", JSON.stringify({ name: "fx", scripts: { test: "true" } }))],
    ["OUT_OF_SCOPE", (x: TempRepo) => x.write("modules/billing/x.ts", "x")],
    ["PROTECTED_PATH", (x: TempRepo) => x.write("features/contacts/BUILD-GRAPH.yaml", graph.replace("modules/contacts/**", "**"))],
  ])("scope rejects %s", (code, change) => {
    const res = candidate(suiteRepo(), change);
    expect(res.status).toBe(1);
    expect(res.out).toContain(code);
  });

  it("scope refuses a candidate branch commit without a wOS-Abu trailer", () => {
    const r = suiteRepo();
    r.write("modules/contacts/list.ts", "x").commit("no trailer");
    const res = r.run(process.execPath, [".github/wos/wos-ci.mjs", "scope"], { GITHUB_REF: "refs/heads/wos/candidate/abc" });
    expect(res.status).toBe(1);
  });

  it("verify: install runs without lifecycle scripts and steps see no inherited secrets (S-7)", () => {
    const r = suiteRepo();
    const res = r.run(process.execPath, [".github/wos/wos-ci.mjs", "verify"], { FAKE_SECRET: "leak-me" });
    expect(res.out).not.toContain("exit 7");
    expect(res.status, res.out).toBe(0);
    expect(existsSync(join(r.dir, "PWNED"))).toBe(false);
  }, 60_000);

  it("verify refuses a wos.json whose install would run lifecycle scripts (S-7)", () => {
    const r = suiteRepo({ install: ["npm", "ci"] });
    const res = r.run(process.execPath, [".github/wos/wos-ci.mjs", "verify"]);
    expect(res.status).toBe(1);
    expect(res.out).toContain("--ignore-scripts");
    expect(existsSync(join(r.dir, "PWNED"))).toBe(false);
  });
});
