/**
 * Client-side git operations used by the orchestrator (owner: github-build).
 *
 * Layout under the workspace root:
 *   <root>/repos/<owner>/<name>.git   bare mirror, created once, fetched per lease
 *   <root>/worktrees/<name>           one detached worktree per lease, at the lease's base sha
 *
 * Capture never trusts git's index or HEAD (an agent can commit, `git rm --cached` or mark files
 * assume-unchanged): it walks the worktree with lstat and compares bytes against `git ls-tree` of
 * the immutable base commit.
 */
import { execFile } from "node:child_process";
import { constants as fsc } from "node:fs";
import { lstat, mkdir, open, readdir, readFile, readlink, realpath, rm } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { type ChangesetFile, RepoPath } from "@waronsaas/contracts";
import { gitBlobOid, sha256Of } from "@waronsaas/contracts/canonical";

export interface WorktreeHandle {
  path: string;
  repo: string;
  baseSha: string;
  /** Always "HEAD": wOS worktrees are detached at the lease's base commit; no local branch exists. */
  branch: string;
}

/** Why a path was left out of a capture. Everything except `ignored` must block submission. */
export type CaptureRejectReason = "symlink" | "submodule" | "special_file" | "hardlink" | "outside_worktree" | "path_invalid" | "ignored";

/** True when a rejected entry must stop the submission (SYMLINK_OR_SPECIAL_FILE / PATH_INVALID). */
export function isBlockingRejection(r: { reason: string }): boolean {
  return r.reason !== "ignored";
}

export interface LocalGitConfig {
  gitBinary: string;
  /** Maps "owner/name" to the fetch URL. Default: https://github.com/<owner>/<name>.git */
  remoteUrl: (repo: string) => string;
}

const DEFAULT_CONFIG: LocalGitConfig = { gitBinary: "git", remoteUrl: (repo) => `https://github.com/${repo}.git` };
let config: LocalGitConfig = DEFAULT_CONFIG;

/** Tests and fake end-to-end runs point the mirror at a local upstream. */
export function configureLocalGit(overrides: Partial<LocalGitConfig>): void {
  config = { ...DEFAULT_CONFIG, ...overrides };
}

export class LocalGitError extends Error {
  constructor(
    readonly code: "INVALID_INPUT" | "GIT_FAILED" | "BASE_NOT_FOUND" | "WORKTREE_EXISTS" | "NOT_A_WORKTREE",
    message: string,
  ) {
    super(message);
    this.name = "LocalGitError";
  }
}

const REPO = /^([A-Za-z0-9-]+)\/([A-Za-z0-9._-]+)$/;
const SHA = /^[0-9a-f]{40}$/;
const NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

/** Hardening flags on every git call: no hooks, no fsmonitor, no prompts, no submodule recursion. */
const SAFE = [
  "-c",
  "core.hooksPath=/dev/null",
  "-c",
  "core.fsmonitor=false",
  "-c",
  "submodule.recurse=false",
  "-c",
  "core.quotePath=false",
];

function gitEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_OPTIONAL_LOCKS: "0" };
  for (const k of [
    "GIT_DIR",
    "GIT_WORK_TREE",
    "GIT_INDEX_FILE",
    "GIT_OBJECT_DIRECTORY",
    "GIT_ALTERNATE_OBJECT_DIRECTORIES",
    "GIT_CEILING_DIRECTORIES",
  ]) {
    delete env[k];
  }
  return env;
}

function git(cwd: string, args: string[]): Promise<Buffer> {
  return new Promise((res, rej) => {
    execFile(
      config.gitBinary,
      [...SAFE, ...args],
      { cwd, env: gitEnv(), encoding: "buffer", maxBuffer: 1 << 30, timeout: 10 * 60_000 },
      (err, stdout, stderr) => {
        if (err) rej(new LocalGitError("GIT_FAILED", `git ${args.join(" ")}: ${stderr.toString().trim() || err.message}`));
        else res(stdout);
      },
    );
  });
}

async function gitText(cwd: string, args: string[]): Promise<string> {
  return (await git(cwd, args)).toString("utf8").trim();
}

async function exists(p: string): Promise<boolean> {
  try {
    await lstat(p);
    return true;
  } catch {
    return false;
  }
}

function layout(workspaceRoot: string, repo: string, name: string) {
  const m = REPO.exec(repo);
  if (!m) throw new LocalGitError("INVALID_INPUT", `not a repo full name: ${JSON.stringify(repo)}`);
  if (!NAME.test(name)) throw new LocalGitError("INVALID_INPUT", `invalid worktree name ${JSON.stringify(name)}`);
  return { mirror: join(workspaceRoot, "repos", m[1]!, `${m[2]!}.git`), worktree: join(workspaceRoot, "worktrees", name) };
}

/** Ensures a bare mirror under <workspaceRoot>/repos/<owner>/<name>.git, fetches `sha`, adds a detached worktree at it. */
export async function createWorktree(workspaceRoot: string, repo: string, sha: string, name: string): Promise<WorktreeHandle> {
  if (!SHA.test(sha)) throw new LocalGitError("INVALID_INPUT", `not a 40-hex sha: ${JSON.stringify(sha)}`);
  await mkdir(workspaceRoot, { recursive: true });
  const root = await realpath(workspaceRoot);
  const { mirror, worktree } = layout(root, repo, name);

  if (!(await exists(join(mirror, "HEAD")))) {
    await mkdir(mirror, { recursive: true });
    await git(mirror, ["init", "--bare", "-q"]);
  }
  await git(mirror, ["config", "remote.origin.url", config.remoteUrl(repo)]);
  // Repo symlinks check out as plain files holding the link text: nothing in a worktree can point outside it.
  await git(mirror, ["config", "core.symlinks", "false"]);
  await git(mirror, ["config", "core.autocrlf", "false"]);
  await git(mirror, ["config", "gc.auto", "0"]);

  const have = await git(mirror, ["cat-file", "-e", `${sha}^{commit}`]).then(
    () => true,
    () => false,
  );
  if (!have) {
    await git(mirror, ["fetch", "--no-tags", "--quiet", "origin", sha]).catch((e: Error) => {
      throw new LocalGitError("BASE_NOT_FOUND", `could not fetch ${sha} from ${repo}: ${e.message}`);
    });
    await git(mirror, ["cat-file", "-e", `${sha}^{commit}`]).catch(() => {
      throw new LocalGitError("BASE_NOT_FOUND", `${sha} is not a commit in ${repo}`);
    });
  }
  // Pin the base so a future gc never prunes it while a lease uses it.
  await git(mirror, ["update-ref", `refs/wos/bases/${sha}`, sha]);

  if (await exists(worktree)) {
    // Resume after a restart: reuse the worktree if it is ours and at the same base.
    const handle = { path: worktree, repo, baseSha: sha, branch: "HEAD" };
    const common = await gitText(worktree, ["rev-parse", "--path-format=absolute", "--git-common-dir"]).catch(() => null);
    if (common !== null && (await realpath(common)) === (await realpath(mirror))) {
      const atBase = await git(worktree, ["merge-base", "--is-ancestor", sha, "HEAD"]).then(
        () => true,
        () => false,
      );
      if (atBase) return handle;
    }
    throw new LocalGitError("WORKTREE_EXISTS", `${worktree} exists and is not a worktree of ${repo} at ${sha}`);
  }
  await mkdir(dirname(worktree), { recursive: true });
  await git(mirror, ["worktree", "add", "--detach", "--quiet", worktree, sha]);
  return { path: worktree, repo, baseSha: sha, branch: "HEAD" };
}

type BaseEntry = { mode: string; oid: string };

async function baseTree(root: string, sha: string): Promise<Map<string, BaseEntry>> {
  const out = await git(root, ["ls-tree", "-r", "-z", "--full-tree", sha]);
  const map = new Map<string, BaseEntry>();
  for (const rec of out.toString("utf8").split("\0")) {
    if (!rec) continue;
    const tab = rec.indexOf("\t");
    const [mode, , oid] = rec.slice(0, tab).split(" ") as [string, string, string];
    map.set(rec.slice(tab + 1), { mode, oid });
  }
  return map;
}

async function ignoredPaths(root: string): Promise<Set<string>> {
  const out = await git(root, ["ls-files", "-z", "--others", "--ignored", "--exclude-standard", "--directory", "--no-empty-directory"]);
  return new Set(
    out
      .toString("utf8")
      .split("\0")
      .filter((p) => p !== ""),
  );
}

/**
 * Captures the worktree's changes vs base as changeset files, reading bytes from disk with lstat:
 * symlinks, submodules, files outside the worktree and paths git ignores-but-exist are reported, never followed.
 */
export async function captureChanges(
  worktree: WorktreeHandle,
): Promise<{ files: ChangesetFile[]; rejected: Array<{ path: string; reason: string }> }> {
  if (!SHA.test(worktree.baseSha)) throw new LocalGitError("INVALID_INPUT", "baseSha is not a 40-hex sha");
  const root = await realpath(worktree.path);
  const top = await gitText(root, ["rev-parse", "--show-toplevel"]).catch(() => null);
  if (top === null || (await realpath(top)) !== root)
    throw new LocalGitError("NOT_A_WORKTREE", `${worktree.path} is not a git worktree root`);
  const rootGit = await lstat(join(root, ".git"));
  if (!rootGit.isFile()) throw new LocalGitError("NOT_A_WORKTREE", `${worktree.path} is a repository, not a linked worktree`);

  const base = await baseTree(root, worktree.baseSha);
  const ignored = await ignoredPaths(root);
  const baseDirs = new Set<string>();
  for (const p of base.keys()) {
    const segs = p.split("/");
    for (let i = 1; i < segs.length; i++) baseDirs.add(segs.slice(0, i).join("/"));
  }

  const files: ChangesetFile[] = [];
  const rejected: Array<{ path: string; reason: CaptureRejectReason }> = [];
  const seen = new Set<string>();
  const walked = new Set<string>([""]);
  const skipped: string[] = [];
  const reject = (path: string, reason: CaptureRejectReason) => {
    rejected.push({ path, reason });
    skipped.push(path);
  };

  const walk = async (dirRel: string): Promise<void> => {
    const dirAbs = dirRel ? join(root, dirRel) : root;
    const entries = await readdir(dirAbs);
    for (const name of entries.sort()) {
      const rel = dirRel ? `${dirRel}/${name}` : name;
      if (rel === ".git") continue;
      const abs = join(dirAbs, name);
      const inBase = base.get(rel);
      let st: Awaited<ReturnType<typeof lstat>>;
      try {
        st = await lstat(abs);
      } catch {
        reject(rel, "path_invalid");
        continue;
      }
      if (st.isDirectory()) {
        if (ignored.has(`${rel}/`) && !baseDirs.has(rel) && !inBase) {
          reject(`${rel}/`, "ignored");
          continue;
        }
        if (inBase?.mode === "160000") {
          if ((await readdir(abs)).length > 0) reject(rel, "submodule");
          else seen.add(rel);
          continue;
        }
        if (await exists(join(abs, ".git"))) {
          reject(rel, "submodule");
          continue;
        }
        walked.add(rel);
        await walk(rel);
        continue;
      }
      if (st.isSymbolicLink()) {
        const target = Buffer.from(await readlink(abs, { encoding: "buffer" }));
        if (inBase?.mode === "120000" && gitBlobOid(target) === inBase.oid) seen.add(rel);
        else reject(rel, "symlink");
        continue;
      }
      if (!st.isFile()) {
        reject(rel, "special_file");
        continue;
      }
      if (!inBase && ignored.has(rel)) {
        reject(rel, "ignored");
        continue;
      }
      if (!RepoPath.safeParse(rel).success) {
        reject(rel, "path_invalid");
        continue;
      }
      if (st.nlink > 1) {
        reject(rel, "hardlink");
        continue;
      }
      const bytes = await readRegularFile(abs, st);
      if (bytes === null) {
        reject(rel, "outside_worktree");
        continue;
      }
      seen.add(rel);
      const oid = gitBlobOid(bytes);
      const mode = st.mode & fsc.S_IXUSR ? "100755" : "100644";
      if (inBase?.mode === "120000") {
        // core.symlinks=false: a base symlink is checked out as a file holding its target.
        if (oid !== inBase.oid) reject(rel, "symlink");
        continue;
      }
      if (inBase?.mode === "160000") {
        reject(rel, "submodule");
        continue;
      }
      if (inBase && inBase.oid === oid && inBase.mode === mode) continue;
      files.push({
        op: "upsert",
        path: rel,
        mode,
        contentBase64: bytes.toString("base64"),
        sha256: sha256Of(bytes),
        bytes: bytes.byteLength,
      });
    }
  };
  await walk("");

  const underSkipped = (p: string) => skipped.some((s) => p === s.replace(/\/$/, "") || p.startsWith(s.endsWith("/") ? s : `${s}/`));
  for (const [p, entry] of base) {
    if (seen.has(p) || underSkipped(p)) continue;
    const parent = p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "";
    // Parent listed with exact names (case-exact even on case-insensitive filesystems) and the name is gone,
    // or the parent directory itself is gone or no longer a directory.
    const gone = walked.has(parent) || !(await isDirectory(join(root, parent)));
    if (!gone) continue;
    if (entry.mode === "160000") {
      reject(p, "submodule");
      continue;
    }
    files.push({ op: "delete", path: p });
  }

  files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  rejected.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return { files, rejected };
}

async function isDirectory(p: string): Promise<boolean> {
  try {
    return (await lstat(p)).isDirectory();
  } catch {
    return false;
  }
}

/** Opens without following links and checks the opened inode is the one lstat saw (no swap race). */
async function readRegularFile(abs: string, st: { dev: number; ino: number }): Promise<Buffer | null> {
  let fh: Awaited<ReturnType<typeof open>> | undefined;
  try {
    fh = await open(abs, fsc.O_RDONLY | fsc.O_NOFOLLOW | (fsc.O_NONBLOCK ?? 0));
    const fst = await fh.stat();
    if (!fst.isFile() || fst.dev !== st.dev || fst.ino !== st.ino || fst.nlink > 1) return null;
    return await fh.readFile();
  } catch {
    return null;
  } finally {
    await fh?.close();
  }
}

export async function removeWorktree(worktree: WorktreeHandle): Promise<void> {
  const m = REPO.exec(worktree.repo);
  if (!m) throw new LocalGitError("INVALID_INPUT", `not a repo full name: ${JSON.stringify(worktree.repo)}`);
  const wtAbs = resolve(worktree.path);
  const worktreesDir = dirname(wtAbs);
  if (!worktreesDir.endsWith(`${sep}worktrees`))
    throw new LocalGitError("INVALID_INPUT", `${worktree.path} is not under a wOS worktrees directory`);
  const root = dirname(worktreesDir);
  const mirror = join(root, "repos", m[1]!, `${m[2]!}.git`);
  if (!(await exists(mirror))) {
    if (await exists(wtAbs)) throw new LocalGitError("NOT_A_WORKTREE", `no mirror for ${worktree.repo} at ${mirror}`);
    return;
  }
  if (await exists(wtAbs)) {
    try {
      await git(mirror, ["worktree", "remove", "--force", "--force", wtAbs]);
    } catch {
      // e.g. a nested repository inside the worktree. Delete only if the directory really is our worktree.
      const pointer = await readFile(join(wtAbs, ".git"), "utf8").catch(() => "");
      const gitdir = /^gitdir: (.+)$/m.exec(pointer)?.[1]?.trim();
      const ours = gitdir !== undefined && (await realpath(dirname(dirname(gitdir))).catch(() => "")) === (await realpath(mirror));
      if (!ours) throw new LocalGitError("NOT_A_WORKTREE", `${worktree.path} is not a worktree of ${mirror}; refusing to delete it`);
      await rm(wtAbs, { recursive: true, force: true });
    }
  }
  await git(mirror, ["worktree", "prune"]);
  // Unpin the base when no other worktree uses it.
  const others = await gitText(mirror, ["worktree", "list", "--porcelain"]);
  if (!others.includes(`HEAD ${worktree.baseSha}`) && SHA.test(worktree.baseSha)) {
    await git(mirror, ["update-ref", "-d", `refs/wos/bases/${worktree.baseSha}`]).catch(() => undefined);
  }
}
