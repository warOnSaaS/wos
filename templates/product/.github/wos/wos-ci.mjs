#!/usr/bin/env node
// wOS CI runner for the product repo (template owned by the verification workstream, platform repo
// templates/product/). Lives under .github/, which no submission can change (S-17), and uses the SAME
// validator and canonical hashing as the client and the control plane (wos-ci-lib.mjs is generated
// from @waronsaas/verification and @waronsaas/contracts/canonical). No secrets, minimal environment (S-7).
//
// Trusted verification (B-0005, BUILD-PROTOCOL.md): the required job runs the BASE commit's wos.json
// install/verify steps with every toolchain path restored from the base, so a candidate cannot redefine
// what "tests pass" means.
//
//   scope                         re-validate the head commit's changes against its ABU at the base
//   restore-toolchain             put every toolchainPaths file back to its base content (delete added ones)
//   verify [--candidate-toolchain] install + verify steps (+ the ABU's acceptance checks)
//   touches-toolchain             prints touched=true|false (for $GITHUB_OUTPUT)
//   profiles                      prints matrix=<json> of every profile acceptance suite per surface at HEAD
//   acceptance <feature> <target> <surface>
//                                 runs that profile's acceptance command for one surface
//                                 (check wos-acceptance/<f>/<t>/<surface>, contracts 4.0.0, D13). The command
//                                 gets WOS_SURFACE, WOS_SUITE_DIR and WOS_REPORT; web also WOS_BROWSERS
//                                 and WOS_PLAYWRIGHT_CONFIG (the wOS-owned project matrix). Afterwards
//                                 the report must prove every browser (Playwright JSON) or the platform
//                                 flows (Maestro JUnit) ran and passed; macOS only for native iOS.
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  AbuSpec,
  BuildGraph,
  checkJUnitReport,
  checkPlaywrightReport,
  playwrightEngines,
  requiredBrowsers,
  runnerProblems,
  parseYaml,
  picomatch,
  RepoManifest,
  RequirementProfile,
  sha256Of,
  submissionSha256,
  validateChangeset,
} from "./wos-ci-lib.mjs";

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

function run(id, argv, timeoutSeconds, extraEnv = {}) {
  console.log(`::group::${id}: ${argv.join(" ")}`);
  const env = { ...minimalEnv(), ...extraEnv };
  const r = spawnSync(argv[0], argv.slice(1), { stdio: "inherit", env, shell: false, timeout: timeoutSeconds * 1000 });
  console.log("::endgroup::");
  if (r.error) fail(`${id} could not run: ${r.error.message}`);
  if (r.status !== 0) fail(`${id} failed with exit ${r.status ?? r.signal}`);
}

/** S-7: installs must not run lifecycle scripts. */
function assertInstallIsSafe(install) {
  const [bin, sub] = install;
  if (bin === "npm" && ["ci", "install", "i"].includes(sub) && !install.includes("--ignore-scripts")) {
    fail(`wos.json install must pass --ignore-scripts (S-7): ${install.join(" ")}`);
  }
}

function trailer(rev, key) {
  const v = gitText(["log", "-1", `--format=%(trailers:key=${key},valueonly)`, rev]).trim();
  return v || null;
}

function singleParent() {
  const parents = gitText(["rev-list", "--parents", "-n", "1", "HEAD"]).trim().split(" ").slice(1);
  if (parents.length !== 1) fail(`a wOS candidate commit has exactly one parent; HEAD has ${parents.length}`);
  return parents[0];
}

/**
 * The trusted base: WOS_BASE_SHA when the event names one (merge_group base_sha), the single parent of a wOS
 * candidate commit (wOS-Abu trailer; also the head of an official PR), else HEAD itself (the default branch).
 */
function baseCommit() {
  const fromEvent = (process.env.WOS_BASE_SHA ?? "").trim();
  if (fromEvent) return gitText(["rev-parse", "--verify", `${fromEvent}^{commit}`]).trim();
  if (trailer("HEAD", "wOS-Abu")) return singleParent();
  return gitText(["rev-parse", "HEAD"]).trim();
}

const manifestAt = (rev) => RepoManifest.parse(JSON.parse(gitText(["show", `${rev}:wos.json`])));
const treePaths = (rev) => gitText(["ls-tree", "-r", "-z", "--name-only", rev]).split("\0").filter(Boolean);

function abuAt(base, abuKey) {
  const feature = abuKey.split("#")[0];
  const graph = BuildGraph.parse(parseYaml(gitText(["show", `${base}:features/${feature}/BUILD-GRAPH.yaml`])));
  const abu = graph.abus.find((a) => a.key === abuKey);
  if (!abu) fail(`ABU ${abuKey} is not in features/${feature}/BUILD-GRAPH.yaml at ${base}`);
  return AbuSpec.parse(abu);
}

function toolchainChanges(base) {
  const isToolchain = picomatch(manifestAt(base).toolchainPaths, { dot: true });
  const changed = gitText(["diff", "--name-only", "-z", "--no-renames", base, "HEAD"]).split("\0").filter(Boolean);
  return { isToolchain, changed: changed.filter((p) => isToolchain(p)) };
}

function restoreToolchain() {
  const base = baseCommit();
  const head = gitText(["rev-parse", "HEAD"]).trim();
  if (base === head) return console.log("HEAD is the trusted base: toolchain already the base's");
  const { isToolchain } = toolchainChanges(base);
  const inBase = new Set(treePaths(base).filter((p) => isToolchain(p)));
  const inHead = treePaths("HEAD").filter((p) => isToolchain(p));
  for (const p of inBase) git(["checkout", base, "--", p]);
  const removed = inHead.filter((p) => !inBase.has(p));
  for (const p of removed) rmSync(p, { force: true });
  console.log(`restored ${inBase.size} toolchain file(s) from ${base}; removed ${removed.length} added by the candidate`);
}

function verify(candidateToolchain) {
  const base = baseCommit();
  // The required job never reads the candidate's wos.json: install and verify steps come from the base.
  const manifest = candidateToolchain ? RepoManifest.parse(JSON.parse(readFileSync("wos.json", "utf8"))) : manifestAt(base);
  assertInstallIsSafe(manifest.install);
  run("install", manifest.install, 1800);
  for (const step of manifest.verify) run(step.id, step.run, step.timeoutSeconds);
  const abuKey = trailer("HEAD", "wOS-Abu");
  if (!abuKey) return console.log("no wOS-Abu trailer on HEAD: repository verify steps only");
  // The ABU's acceptance checks come from the build graph at the BASE, never from the candidate.
  for (const check of abuAt(singleParent(), abuKey).acceptance.checks) run(`acceptance:${check.id}`, check.run, 1800);
}

function scope() {
  const abuKey = trailer("HEAD", "wOS-Abu");
  if (!abuKey) {
    if ((process.env.GITHUB_REF ?? "").startsWith("refs/heads/wos/candidate/")) fail("candidate commit without a wOS-Abu trailer");
    return console.log("no wOS-Abu trailer on HEAD: nothing to scope-check");
  }
  const base = singleParent();
  const repoManifest = manifestAt(base);
  const abu = abuAt(base, abuKey);
  const existingPaths = new Set(treePaths(base));

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
      sha256: sha256Of(content),
      bytes: content.length,
    });
  }
  const changeset = { parentCommit: base, files, submissionSha256: submissionSha256(base, files) };
  const result = validateChangeset(changeset, { kind: "abu", abu, documentPaths: [], repoManifest, existingPaths });
  for (const e of result.errors) console.error(`::error file=${e.path ?? "wos.json"}::${e.code} ${e.message}`);
  if (!result.ok) fail(`scope check failed for ${abuKey} (${result.errors.length} error(s))`);
  console.log(`scope check passed for ${abuKey}: ${files.length} file(s) against ${base}`);
}

function readProfiles() {
  if (!existsSync("features")) return [];
  const out = [];
  for (const feature of readdirSync("features").sort()) {
    const path = `features/${feature}/CONTRACT.yaml`;
    if (!existsSync(path)) continue;
    const doc = parseYaml(readFileSync(path, "utf8"));
    if (doc?.feature !== feature) fail(`${path}: feature key ${JSON.stringify(doc?.feature)} does not match its directory`);
    for (const p of doc.profiles ?? []) out.push({ feature, ...RequirementProfile.parse(p) });
  }
  return out;
}

function surfaceSuites() {
  return readProfiles().flatMap(({ feature, target, acceptance }) =>
    acceptance.map((a) => ({ feature, target, surface: a.surface, runner: a.runner, browsers: a.browsers, dir: a.dir, run: a.run })),
  );
}

/** Every suite's runner placement is checked before any job is scheduled (macOS only for native iOS). */
function profiles() {
  const suites = surfaceSuites();
  const bad = suites.flatMap((x) => runnerProblems(x).map((p) => `${x.feature}/${x.target}/${x.surface}: ${p}`));
  if (bad.length) fail(bad.join("; "));
  console.log(`matrix=${JSON.stringify(suites.map(({ feature, target, surface, runner }) => ({ feature, target, surface, runner })))}`);
}

function acceptance(feature, target, surface) {
  const suite = surfaceSuites().find((p) => p.feature === feature && p.target === target && p.surface === surface);
  if (!suite) fail(`no ${surface} acceptance for profile ${feature}/${target} at HEAD`);
  const placement = runnerProblems(suite);
  if (placement.length) fail(placement.join("; "));
  const manifest = RepoManifest.parse(JSON.parse(readFileSync("wos.json", "utf8")));
  assertInstallIsSafe(manifest.install);
  run("install", manifest.install, 1800);

  const web = surface === "web";
  const mobile = surface === "ios" || surface === "android";
  const report = join(tmpdir(), `wos-report-${process.pid}-${surface}.${web ? "json" : "xml"}`);
  rmSync(report, { force: true });
  const env = { WOS_SURFACE: surface, WOS_SUITE_DIR: resolve(suite.dir), WOS_REPORT: report };
  // Toolchain locations (never credentials) that native builds need beyond the minimal environment.
  if (mobile) {
    for (const k of ["JAVA_HOME", "ANDROID_HOME", "ANDROID_SDK_ROOT", "DEVELOPER_DIR"]) if (process.env[k]) env[k] = process.env[k];
  }
  const browsers = web ? requiredBrowsers(suite, manifest) : [];
  if (web) {
    env.WOS_BROWSERS = browsers.join(",");
    env.WOS_PLAYWRIGHT_CONFIG = resolve(".github/wos/playwright.wos.config.mjs");
    // Test seam for the fixture repos in the platform repo's tests; never set in the workflow.
    if (process.env.WOS_SKIP_BROWSER_INSTALL !== "1") {
      run("playwright browsers", ["npx", "--no-install", "playwright", "install", "--with-deps", ...playwrightEngines(browsers)], 1800);
    }
  }
  run(`wos-acceptance/${feature}/${target}/${surface}`, suite.run, 3600, env);

  if (!web && !mobile) return console.log(`${surface} acceptance passed (exit code only)`);
  if (!existsSync(report))
    fail(
      `${surface} acceptance wrote no report at WOS_REPORT: ${web ? "run Playwright with --config $WOS_PLAYWRIGHT_CONFIG" : "run the flows with .github/wos/maestro.mjs"}`,
    );
  const text = readFileSync(report, "utf8");
  let check;
  try {
    check = web ? checkPlaywrightReport(JSON.parse(text), browsers) : checkJUnitReport(text);
  } catch (e) {
    fail(`unreadable ${surface} report: ${e.message}`);
  }
  for (const p of check.problems) console.error(`::error::${surface}: ${p}`);
  if (!check.ok) fail(`${surface} acceptance did not cover its matrix: ${check.problems.join("; ")}`);
  console.log(`${surface} acceptance passed${web ? ` on ${browsers.join(", ")}` : ""}`);
}

const [command, ...args] = process.argv.slice(2);
if (command === "scope") scope();
else if (command === "restore-toolchain") restoreToolchain();
else if (command === "verify") verify(args.includes("--candidate-toolchain"));
else if (command === "touches-toolchain") console.log(`touched=${toolchainChanges(baseCommit()).changed.length > 0}`);
else if (command === "profiles") profiles();
else if (command === "acceptance") acceptance(args[0], args[1], args[2]);
else
  fail(
    "usage: wos-ci.mjs scope|restore-toolchain|verify [--candidate-toolchain]|touches-toolchain|profiles|acceptance <feature> <target> <surface>",
  );
