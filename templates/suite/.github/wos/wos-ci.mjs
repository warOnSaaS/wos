#!/usr/bin/env node
// wOS CI runner for the product repo (template owned by the verification workstream, platform repo
// templates/suite/). Lives under .github/, which no submission can change (S-17), and runs with the
// SAME validator as the client and the control plane (wos-ci-lib.mjs is generated from
// @waronsaas/verification). No secrets, no network beyond `npm ci`, minimal environment (S-7).
//
//   node .github/wos/wos-ci.mjs verify   install + wos.json verify steps + the ABU's acceptance checks
//   node .github/wos/wos-ci.mjs scope    re-validate the head commit's changes against its ABU at the base
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { AbuSpec, BuildGraph, computeSubmissionSha256, parseYaml, RepoManifest, sha256Hex, validateChangeset } from "./wos-ci-lib.mjs";

const git = (args, opts = {}) => execFileSync("git", args, { maxBuffer: 1 << 30, ...opts });
const gitText = (args) => git(args, { encoding: "utf8" });
const fail = (msg) => {
  console.error(`wos-ci: ${msg}`);
  process.exit(1);
};

/** S-7: every step sees only these variables, never the runner's full environment. */
const minimalEnv = () => ({
  PATH: process.env.PATH ?? "/usr/bin:/bin",
  HOME: process.env.HOME ?? "/tmp",
  LANG: process.env.LANG ?? "C.UTF-8",
  CI: "true",
});

function run(id, argv, timeoutSeconds) {
  console.log(`::group::${id}: ${argv.join(" ")}`);
  const r = spawnSync(argv[0], argv.slice(1), { stdio: "inherit", env: minimalEnv(), shell: false, timeout: timeoutSeconds * 1000 });
  console.log("::endgroup::");
  if (r.error) fail(`${id} could not run: ${r.error.message}`);
  if (r.status !== 0) fail(`${id} failed with exit ${r.status ?? r.signal}`);
}

/** S-7: installs must not run lifecycle scripts. */
export function assertInstallIsSafe(install) {
  const [bin, sub] = install;
  if (bin === "npm" && ["ci", "install", "i"].includes(sub) && !install.includes("--ignore-scripts")) {
    fail(`wos.json install must pass --ignore-scripts (S-7): ${install.join(" ")}`);
  }
}

function trailer(rev, key) {
  const v = gitText(["log", "-1", `--format=%(trailers:key=${key},valueonly)`, rev]).trim();
  return v || null;
}

function abuAt(base, abuKey) {
  const feature = abuKey.split("#")[0];
  const text = gitText(["show", `${base}:features/${feature}/BUILD-GRAPH.yaml`]);
  const graph = BuildGraph.parse(parseYaml(text));
  const abu = graph.abus.find((a) => a.key === abuKey);
  if (!abu) fail(`ABU ${abuKey} is not in features/${feature}/BUILD-GRAPH.yaml at ${base}`);
  return AbuSpec.parse(abu);
}

function candidateBase() {
  const parents = gitText(["rev-list", "--parents", "-n", "1", "HEAD"]).trim().split(" ").slice(1);
  if (parents.length !== 1) fail(`a wOS candidate commit has exactly one parent; HEAD has ${parents.length}`);
  return parents[0];
}

function verify() {
  const manifest = RepoManifest.parse(JSON.parse(readFileSync("wos.json", "utf8")));
  assertInstallIsSafe(manifest.install);
  run("install", manifest.install, 1800);
  for (const step of manifest.verify) run(step.id, step.run, step.timeoutSeconds);
  const abuKey = trailer("HEAD", "wOS-Abu");
  if (!abuKey) return console.log("no wOS-Abu trailer on HEAD: repository verify steps only");
  // The ABU's acceptance checks come from the build graph at the BASE, never from the candidate.
  const abu = abuAt(candidateBase(), abuKey);
  for (const check of abu.acceptance.checks) run(`acceptance:${check.id}`, check.run, 1800);
}

function scope() {
  const abuKey = trailer("HEAD", "wOS-Abu");
  if (!abuKey) {
    if ((process.env.GITHUB_REF ?? "").startsWith("refs/heads/wos/candidate/")) fail("candidate commit without a wOS-Abu trailer");
    return console.log("no wOS-Abu trailer on HEAD: nothing to scope-check");
  }
  const base = candidateBase();
  const repoManifest = RepoManifest.parse(JSON.parse(gitText(["show", `${base}:wos.json`])));
  const abu = abuAt(base, abuKey);
  const existingPaths = new Set(gitText(["ls-tree", "-r", "-z", "--name-only", base]).split("\0").filter(Boolean));

  // --raw keeps modes, so symlinks (120000) and submodules (160000) reach the validator and are rejected.
  const raw = gitText(["diff", "--raw", "-z", "--no-renames", "--no-abbrev", base, "HEAD"]).split("\0");
  const files = [];
  for (let i = 0; i + 1 < raw.length; i += 2) {
    const [, , newMode, , newSha, status] = raw[i].split(/[: ]/);
    const path = raw[i + 1];
    if (status === "D") {
      files.push({ op: "delete", path });
      continue;
    }
    const content = newMode === "160000" ? Buffer.alloc(0) : git(["cat-file", "blob", newSha]);
    files.push({
      op: "upsert",
      path,
      mode: newMode,
      contentBase64: content.toString("base64"),
      sha256: sha256Hex(content),
      bytes: content.length,
    });
  }
  const changeset = { parentCommit: base, files, submissionSha256: computeSubmissionSha256(base, files) };
  const result = validateChangeset(changeset, { kind: "abu", abu, documentPaths: [], repoManifest, existingPaths });
  for (const e of result.errors) console.error(`::error file=${e.path ?? "wos.json"}::${e.code} ${e.message}`);
  if (!result.ok) fail(`scope check failed for ${abuKey} (${result.errors.length} error(s))`);
  console.log(`scope check passed for ${abuKey}: ${files.length} file(s) against ${base}`);
}

const command = process.argv[2];
if (command === "verify") verify();
else if (command === "scope") scope();
else fail("usage: wos-ci.mjs verify|scope");
