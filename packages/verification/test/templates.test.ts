import { execFileSync } from "node:child_process";
import { cpSync, existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_TOOLCHAIN_PATHS, profileAcceptanceCheckName, RepoManifest } from "@waronsaas/contracts";
import { VERIFY_CHECK_NAME } from "@waronsaas/github";
import { afterAll, describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";
import { lintProductWorkflow, validateChangeset } from "../src/index.js";
import { REPO_ROOT, TempRepo } from "./support/git-fixture.js";

const SUITE = join(REPO_ROOT, "templates/product");
const read = (p: string) => readFileSync(join(REPO_ROOT, p), "utf8");
type Wf = {
  on: Record<string, unknown>;
  permissions: unknown;
  jobs: Record<string, { name?: string; if?: string; needs?: string; steps: { run?: string; uses?: string; if?: string }[] }>;
};

describe("templates/product: wos.json", () => {
  const manifest = RepoManifest.parse(JSON.parse(read("templates/product/wos.json")));

  it("parses as RepoManifest and never runs lifecycle scripts on install (S-7)", () => {
    expect(manifest.install).toEqual(["npm", "ci", "--ignore-scripts"]);
  });
  it("protects .github/**, wos.json and the document directories (S-17)", () => {
    for (const p of [".github/**", "wos.json", "catalog/**", "roadmaps/**", "features/**"]) expect(manifest.protectedPaths).toContain(p);
  });
  it("lists every DEFAULT_TOOLCHAIN_PATHS entry in toolchainPaths (B-0005)", () => {
    for (const p of DEFAULT_TOOLCHAIN_PATHS) expect(manifest.toolchainPaths).toContain(p);
  });

  const pkgEdit = (resources: { key: string; mode: "exclusive" | "shared" }[]) => {
    const scripts = Buffer.from(JSON.stringify({ scripts: { test: "true" } }));
    return validateChangeset(
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
        abu: { scope: { write: ["package.json", "modules/x/**"], read: [] }, resources } as never,
        documentPaths: [],
        repoManifest: manifest,
        existingPaths: new Set(["package.json"]),
      },
    ).errors.map((e) => e.code);
  };
  it("a package.json edit without toolchain:package.json is TOOLCHAIN_WITHOUT_RESOURCE", () => {
    expect(pkgEdit([])).toContain("TOOLCHAIN_WITHOUT_RESOURCE");
  });
  it("a package.json edit with exclusive toolchain:package.json passes the toolchain rule", () => {
    expect(pkgEdit([{ key: "toolchain:package.json", mode: "exclusive" }])).not.toContain("TOOLCHAIN_WITHOUT_RESOURCE");
  });
});

describe("templates/product: workflows (S-20)", () => {
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

  const wf = parseYaml(readFileSync(join(dir, "wos-verify.yml"), "utf8")) as Wf;
  it("the required job restores the toolchain from the base BEFORE running the base verify steps (B-0005)", () => {
    const required = Object.values(wf.jobs).find((j) => j.name === VERIFY_CHECK_NAME)!;
    const runs = required.steps.map((s) => s.run ?? "");
    const restore = runs.indexOf("node .github/wos/wos-ci.mjs restore-toolchain");
    expect(restore).toBeGreaterThanOrEqual(0);
    expect(restore).toBeLessThan(runs.indexOf("node .github/wos/wos-ci.mjs verify"));
    expect(runs.some((r) => r.includes("--candidate-toolchain"))).toBe(false);
  });
  it("a separate, non-required job runs the candidate toolchain only when toolchain paths changed", () => {
    const job = wf.jobs["wos-verify-candidate-toolchain"]!;
    expect(job.name).toBe("wos-verify-candidate-toolchain");
    expect(job.name).not.toBe(VERIFY_CHECK_NAME);
    const step = job.steps.find((s) => s.run?.includes("--candidate-toolchain"))!;
    expect(step.if).toBe("steps.toolchain.outputs.touched == 'true'");
  });
  it("per-profile acceptance check runs are named by profileAcceptanceCheckName and run only on the default branch", () => {
    const job = wf.jobs.acceptance!;
    // biome-ignore lint/suspicious/noTemplateCurlyInString: GitHub expression, not a JS template
    expect(job.name).toBe(
      profileAcceptanceCheckName("${{ matrix.profile.feature }}", "${{ matrix.profile.target }}", "${{ matrix.profile.surface }}"),
    );
    expect(job.needs).toBe("profiles");
    expect(wf.jobs.profiles!.if).toContain("github.event.repository.default_branch");
  });

  it("the vendored validator bundle is current with packages/verification", () => {
    execFileSync(process.execPath, [join(REPO_ROOT, "packages/verification/ci/bundle.mjs"), "--check"], { stdio: "pipe" });
  }, 60_000);
});

describe("templates/product: CODEOWNERS and rulesets", () => {
  it("CODEOWNERS owns the gate's files", () => {
    const owners = read("templates/product/.github/CODEOWNERS");
    for (const p of ["/.github/", "/wos.json", "package.json", "tsconfig*.json", "/db/migrations/"])
      expect(owners).toMatch(new RegExp(`^${p.replace(/[.*/]/g, "\\$&")}\\s+@`, "m"));
  });

  it("the main ruleset has no bypass actors and requires wos-verify (Actions) and wos/qualified (App)", () => {
    const blocks = [...read("templates/product/RULESETS.md").matchAll(/```json\n([\s\S]*?)```/g)].map((m) => JSON.parse(m[1] ?? ""));
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

describe("templates/product: wos-ci.mjs in a real git repo", () => {
  const repos: TempRepo[] = [];
  afterAll(() => {
    for (const r of repos) r.remove();
  });

  const graph = `schema: wos-build-graph.v1
feature: contacts
contractVersion: 1
abus:
  - repo: waronsaas/product
    key: "contacts#04"
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
      ...JSON.parse(read("templates/product/wos.json")),
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
    ["TOOLCHAIN_WITHOUT_RESOURCE", (x: TempRepo) => x.write("package.json", JSON.stringify({ name: "fx", scripts: { test: "true" } }))],
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
  it("restore-toolchain + verify run the BASE package.json scripts and drop configs the candidate added (B-0005)", () => {
    const r = suiteRepo({ verify: [{ id: "test", run: ["npm", "test"], timeoutSeconds: 120 }] });
    const pkg = (marker: string) =>
      JSON.stringify({ name: "fx", version: "1.0.0", scripts: { test: `node -e "require('fs').writeFileSync('${marker}','')"` } });
    r.write("package.json", pkg("BASE_RAN")).commit("base scripts");
    r.write("package.json", pkg("CANDIDATE_RAN")).write("modules/contacts/vitest.config.ts", "export default {};\n");
    r.commit("contacts#04: List endpoint\n\nwOS-Abu: contacts#04");
    expect(r.run(process.execPath, [".github/wos/wos-ci.mjs", "touches-toolchain"]).out).toContain("touched=true");
    const restore = r.run(process.execPath, [".github/wos/wos-ci.mjs", "restore-toolchain"]);
    expect(restore.status, restore.out).toBe(0);
    expect(existsSync(join(r.dir, "modules/contacts/vitest.config.ts"))).toBe(false);
    const res = r.run(process.execPath, [".github/wos/wos-ci.mjs", "verify"]);
    expect(res.status, res.out).toBe(0);
    expect(existsSync(join(r.dir, "BASE_RAN"))).toBe(true);
    expect(existsSync(join(r.dir, "CANDIDATE_RAN"))).toBe(false);
  }, 60_000);

  it("the required verify reads the base wos.json even if the candidate's differs", () => {
    const r = suiteRepo();
    const evil = {
      ...JSON.parse(readFileSync(join(r.dir, "wos.json"), "utf8")),
      verify: [{ id: "x", run: ["node", "-e", "process.exit(0)"], timeoutSeconds: 5 }],
    };
    evil.verify = [{ id: "evil", run: ["node", "-e", "require('fs').writeFileSync('EVIL','')"], timeoutSeconds: 5 }];
    r.write("wos.json", JSON.stringify(evil)).commit("contacts#04: x\n\nwOS-Abu: contacts#04");
    const res = r.run(process.execPath, [".github/wos/wos-ci.mjs", "verify"]);
    expect(res.status, res.out).toBe(0);
    expect(existsSync(join(r.dir, "EVIL"))).toBe(false);
  }, 60_000);

  it("touches-toolchain is false for an ordinary module change", () => {
    const r = suiteRepo();
    r.write("modules/contacts/list.ts", "export const x = 2;\n").commit("contacts#04: x\n\nwOS-Abu: contacts#04");
    expect(r.run(process.execPath, [".github/wos/wos-ci.mjs", "touches-toolchain"]).out).toContain("touched=false");
  });

  it("profiles lists one matrix entry per profile; acceptance runs exactly that profile's command", () => {
    const r = suiteRepo();
    const profile = (target: string) => `  - target: ${target}
    requirements: [R-001]
    acceptance:
      - surface: web
        dir: features/contacts/acceptance/${target}
        run: ["node", "-e", "require('fs').writeFileSync('ACC_${target}','')"]
        browsers: [chromium, edge, webkit, firefox, mobile_safari, mobile_chrome]
        runner: linux
`;
    r.write(
      "features/contacts/CONTRACT.yaml",
      `schema: wos-feature-contract.v1\nfeature: contacts\nprofiles:\n${profile("salesforce")}${profile("hubspot")}`,
    ).commit("contract");
    const list = r.run(process.execPath, [".github/wos/wos-ci.mjs", "profiles"]);
    expect(list.status, list.out).toBe(0);
    const matrix = JSON.parse(list.out.trim().replace(/^matrix=/, ""));
    expect(matrix).toEqual([
      { feature: "contacts", target: "salesforce", surface: "web", runner: "linux" },
      { feature: "contacts", target: "hubspot", surface: "web", runner: "linux" },
    ]);
    expect(
      matrix.map((m: { feature: string; target: string; surface: string }) => profileAcceptanceCheckName(m.feature, m.target, m.surface)),
    ).toEqual(["wos-acceptance/contacts/salesforce/web", "wos-acceptance/contacts/hubspot/web"]);
    const acc = r.run(process.execPath, [".github/wos/wos-ci.mjs", "acceptance", "contacts", "hubspot", "web"]);
    expect(acc.status, acc.out).toBe(0);
    expect(existsSync(join(r.dir, "ACC_hubspot"))).toBe(true);
    expect(existsSync(join(r.dir, "ACC_salesforce"))).toBe(false);
    expect(r.run(process.execPath, [".github/wos/wos-ci.mjs", "acceptance", "contacts", "zoom", "web"]).status).toBe(1);
  }, 60_000);
});
