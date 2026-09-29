import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, linkSync, mkdirSync, readFileSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { commitChangeset, resetGithubAppConfig } from "../src/app/index.js";
import { candidateBranch } from "../src/index.js";
import {
  captureChanges,
  configureLocalGit,
  createWorktree,
  isBlockingRejection,
  removeWorktree,
  type WorktreeHandle,
} from "../src/local/index.js";
import { changeset, cleanup, git, makeApp, makeUpstream, tempDir } from "./support/setup.js";

const REPO = "waronsaas/suite";

let upstream: { dir: string; base: string };
let root: string;
let outside: string;

beforeEach(() => {
  upstream = makeUpstream({
    "README.md": "# suite\n",
    ".gitignore": "node_modules/\ndist/\n*.log\n",
    "modules/contacts/list.ts": "export const list = () => [];\n",
    "modules/contacts/old.ts": "old\n",
    "modules/contacts/sub/deep.ts": "deep\n",
    "scripts/run.sh": "#!/bin/sh\n\u0000x",
  });
  // A symlink and a submodule gitlink in the base commit.
  symlinkSync("README.md", join(upstream.dir, "readme-link"));
  git(upstream.dir, "add", "readme-link");
  mkdirSync(join(upstream.dir, "dist"));
  writeFileSync(join(upstream.dir, "dist/tracked.txt"), "tracked in an ignored dir\n");
  git(upstream.dir, "add", "-f", "dist/tracked.txt");
  git(upstream.dir, "update-index", "--add", "--cacheinfo", `160000,${upstream.base},vendor/lib`);
  git(upstream.dir, "commit", "-q", "-m", "link and submodule");
  upstream.base = git(upstream.dir, "rev-parse", "HEAD");
  root = tempDir("ws");
  outside = tempDir("outside");
  writeFileSync(join(outside, "secret.txt"), "TOP SECRET\n");
  configureLocalGit({ remoteUrl: () => upstream.dir });
});

afterEach(() => {
  configureLocalGit({});
  resetGithubAppConfig();
  cleanup(upstream.dir, root, outside);
});

const paths = (r: { files: Array<{ path: string; op: string }> }) => r.files.map((f) => `${f.op} ${f.path}`);

describe("createWorktree / removeWorktree", () => {
  it("creates a bare mirror and a detached worktree at the immutable base sha, and resumes it", async () => {
    const wt = await createWorktree(root, REPO, upstream.base, "lease-1");
    expect(wt).toMatchObject({ repo: REPO, baseSha: upstream.base, branch: "HEAD" });
    expect(wt.path.endsWith("/worktrees/lease-1")).toBe(true);
    expect(git(wt.path, "rev-parse", "HEAD")).toBe(upstream.base);
    expect(git(wt.path, "rev-parse", "--abbrev-ref", "HEAD")).toBe("HEAD");
    expect(existsSync(join(root, "repos", "waronsaas", "suite.git", "HEAD"))).toBe(true);
    // Repo symlinks are checked out as plain files (core.symlinks=false).
    expect(readFileSync(join(wt.path, "readme-link"), "utf8")).toBe("README.md");
    // Upstream moving on does not move the lease's base.
    writeFileSync(join(upstream.dir, "README.md"), "moved\n");
    git(upstream.dir, "commit", "-qam", "moved");
    const again = await createWorktree(root, REPO, upstream.base, "lease-1");
    expect(again.path).toBe(wt.path);
    expect(git(wt.path, "rev-parse", "HEAD")).toBe(upstream.base);
    // A second lease on a newer base shares the mirror.
    const newer = git(upstream.dir, "rev-parse", "HEAD");
    const wt2 = await createWorktree(root, REPO, newer, "lease-2");
    expect(git(wt2.path, "rev-parse", "HEAD")).toBe(newer);
    await expect(createWorktree(root, REPO, newer, "lease-1")).rejects.toMatchObject({ code: "WORKTREE_EXISTS" });

    await removeWorktree(wt);
    expect(existsSync(wt.path)).toBe(false);
    expect(git(join(root, "repos", "waronsaas", "suite.git"), "worktree", "list")).not.toContain("lease-1");
    await removeWorktree(wt); // idempotent
    expect(existsSync(wt2.path)).toBe(true);
  });

  it("refuses unknown commits, bad names and removing directories that are not wOS worktrees", async () => {
    await expect(createWorktree(root, REPO, "f".repeat(40), "x")).rejects.toMatchObject({ code: "BASE_NOT_FOUND" });
    await expect(createWorktree(root, REPO, upstream.base, "../escape")).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(createWorktree(root, "not a repo", upstream.base, "x")).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(removeWorktree({ path: outside, repo: REPO, baseSha: upstream.base, branch: "HEAD" })).rejects.toMatchObject({
      code: "INVALID_INPUT",
    });
    const fakeWt = join(root, "worktrees", "not-ours");
    mkdirSync(fakeWt, { recursive: true });
    await createWorktree(root, REPO, upstream.base, "real");
    await expect(removeWorktree({ path: fakeWt, repo: REPO, baseSha: upstream.base, branch: "HEAD" })).rejects.toMatchObject({
      code: "NOT_A_WORKTREE",
    });
    expect(existsSync(fakeWt)).toBe(true);
  });
});

describe("captureChanges", () => {
  let wt: WorktreeHandle;
  beforeEach(async () => {
    wt = await createWorktree(root, REPO, upstream.base, "lease-cap");
  });

  it("captures upserts, deletes and mode changes against the base, reading bytes from disk", async () => {
    writeFileSync(join(wt.path, "modules/contacts/list.ts"), "export const list = () => ['a'];\n");
    writeFileSync(join(wt.path, "README.md"), "# suite\n"); // rewritten identically: no change
    mkdirSync(join(wt.path, "modules/contacts/new/deep"), { recursive: true });
    writeFileSync(join(wt.path, "modules/contacts/new/deep/a.ts"), "a\n");
    rmSync(join(wt.path, "modules/contacts/sub"), { recursive: true });
    unlinkSync(join(wt.path, "modules/contacts/old.ts"));
    chmodSync(join(wt.path, "scripts/run.sh"), 0o644);
    writeFileSync(join(wt.path, "dist/tracked.txt"), "changed\n");
    const res = await captureChanges(wt);
    expect(paths(res)).toEqual([
      "upsert dist/tracked.txt",
      "upsert modules/contacts/list.ts",
      "upsert modules/contacts/new/deep/a.ts",
      "delete modules/contacts/old.ts",
      "delete modules/contacts/sub/deep.ts",
      "upsert scripts/run.sh",
    ]);
    const list = res.files.find((f) => f.path === "modules/contacts/list.ts");
    expect(list).toMatchObject({ mode: "100644", bytes: 33 });
    expect(Buffer.from((list as { contentBase64: string }).contentBase64, "base64").toString()).toBe("export const list = () => ['a'];\n");
    expect(res.files.find((f) => f.path === "scripts/run.sh")).toMatchObject({ mode: "100644" });
    expect(res.rejected).toEqual([]);
  });

  it("does not trust the index or HEAD: agent commits and assume-unchanged are still captured", async () => {
    writeFileSync(join(wt.path, "README.md"), "committed by the agent\n");
    git(wt.path, "commit", "-qam", "agent commit");
    writeFileSync(join(wt.path, "modules/contacts/list.ts"), "hidden\n");
    git(wt.path, "update-index", "--assume-unchanged", "modules/contacts/list.ts");
    git(wt.path, "rm", "-q", "--cached", "modules/contacts/old.ts");
    expect(paths(await captureChanges(wt))).toEqual(["upsert README.md", "upsert modules/contacts/list.ts"]);
  });

  it("reports ignored paths without walking them (node_modules) and captures nothing from them", async () => {
    mkdirSync(join(wt.path, "node_modules/pkg"), { recursive: true });
    writeFileSync(join(wt.path, "node_modules/pkg/index.js"), "x");
    writeFileSync(join(wt.path, "debug.log"), "log");
    writeFileSync(join(wt.path, "dist/untracked.js"), "built");
    const res = await captureChanges(wt);
    expect(res.files).toEqual([]);
    expect(res.rejected).toEqual([
      { path: "debug.log", reason: "ignored" },
      { path: "dist/untracked.js", reason: "ignored" },
      { path: "node_modules/", reason: "ignored" },
    ]);
    expect(res.rejected.some(isBlockingRejection)).toBe(false);
  });

  it("scope-verification S-15 rejects a new symlink, even one escaping the worktree, and never follows it", async () => {
    symlinkSync(join(outside, "secret.txt"), join(wt.path, "modules/contacts/leak.ts"));
    symlinkSync("list.ts", join(wt.path, "modules/contacts/inner-link.ts"));
    const res = await captureChanges(wt);
    expect(res.files).toEqual([]);
    expect(res.rejected).toEqual([
      { path: "modules/contacts/inner-link.ts", reason: "symlink" },
      { path: "modules/contacts/leak.ts", reason: "symlink" },
    ]);
    expect(JSON.stringify(res)).not.toContain(Buffer.from("TOP SECRET\n").toString("base64"));
  });

  it("rejects files outside the worktree reached through a symlinked directory or a hard link", async () => {
    rmSync(join(wt.path, "modules/contacts"), { recursive: true });
    symlinkSync(outside, join(wt.path, "modules/contacts"));
    linkSync(join(outside, "secret.txt"), join(wt.path, "stolen.txt"));
    const res = await captureChanges(wt);
    expect(res.rejected).toEqual([
      { path: "modules/contacts", reason: "symlink" },
      { path: "stolen.txt", reason: "hardlink" },
    ]);
    // Base files "under" the symlinked directory are not reported as deleted either.
    expect(res.files).toEqual([]);
    expect(JSON.stringify(res)).not.toContain(Buffer.from("TOP SECRET\n").toString("base64"));
  });

  it("rejects submodules: a nested repository, and edits inside a base gitlink", async () => {
    const nested = join(wt.path, "modules/contacts/vendored");
    mkdirSync(nested, { recursive: true });
    execFileSync("git", ["init", "-q", nested]);
    writeFileSync(join(nested, "x.ts"), "x");
    mkdirSync(join(wt.path, "vendor/lib"), { recursive: true });
    writeFileSync(join(wt.path, "vendor/lib/injected.ts"), "x");
    const res = await captureChanges(wt);
    expect(res.files).toEqual([]);
    expect(res.rejected).toEqual([
      { path: "modules/contacts/vendored", reason: "submodule" },
      { path: "vendor/lib", reason: "submodule" },
    ]);
  });

  it("rejects special files, edits to a base symlink and invalid path names", async () => {
    execFileSync("mkfifo", [join(wt.path, "pipe")]);
    writeFileSync(join(wt.path, "readme-link"), "/etc/passwd");
    writeFileSync(join(wt.path, "bad\\name.ts"), "x");
    const res = await captureChanges(wt);
    expect(res.files).toEqual([]);
    expect(res.rejected).toEqual([
      { path: "bad\\name.ts", reason: "path_invalid" },
      { path: "pipe", reason: "special_file" },
      { path: "readme-link", reason: "symlink" },
    ]);
    expect(res.rejected.every(isBlockingRejection)).toBe(true);
  });

  it("gated-pull-requests R-002 a captured changeset committed by the App yields the tree git itself would write", async () => {
    writeFileSync(join(wt.path, "modules/contacts/list.ts"), "v2\n");
    writeFileSync(join(wt.path, "modules/contacts/tool.sh"), "#!/bin/sh\n");
    chmodSync(join(wt.path, "modules/contacts/tool.sh"), 0o755);
    unlinkSync(join(wt.path, "modules/contacts/old.ts"));
    const { files, rejected } = await captureChanges(wt);
    expect(rejected).toEqual([]);
    const { creds, fake } = makeApp();
    fake.importGitRepo(upstream.dir, REPO);
    const { treeSha } = await commitChangeset(
      creds,
      REPO,
      candidateBranch("0192ab3c-7d1e-7000-8000-00000000abcd"),
      changeset(upstream.base, files),
      {
        author: { name: "waronsaas-wos[bot]", email: "1+waronsaas-wos[bot]@users.noreply.github.com" },
        message: "contacts#04: list",
        trailers: { "Co-authored-by": "octo-dev <4242+octo-dev@users.noreply.github.com>" },
      },
      { createBranch: true, expectedHeadSha: null },
    );
    git(wt.path, "add", "-A");
    expect(treeSha).toBe(git(wt.path, "write-tree"));
  });
});
