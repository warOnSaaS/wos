/**
 * Server-side GitHub App operations (owner: github-build). Used only by the control plane.
 * The signatures of the Phase 0 functions are the frozen contract with the control plane; the
 * functions below them marked "additive" are proposed in blockers/B-0001-github-build.md.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { type Changeset, type ProvenanceRecord, RepoPath } from "@waronsaas/contracts";
import { gitBlobOid, sha256Of } from "@waronsaas/contracts/canonical";
import { currentTransport, GithubAppError, installationClient, messageOf, splitRepo, statusOf, wrap } from "./client.js";
import { buildCommitMessage, GITHUB_BODY_LIMIT, PROVENANCE_MARKER, renderProvenanceSection, validateAuthor } from "./message.js";

export { configureGithubApp, GithubAppError, type GithubAppErrorCode, type GithubAppTransport, resetGithubAppConfig } from "./client.js";
export {
  buildCommitMessage,
  PROVENANCE_MARKER,
  type QualificationRow,
  type ReviewRow,
  renderProvenanceSection,
  renderPullRequestBody,
} from "./message.js";

export interface AppCredentials {
  appId: string;
  privateKeyPem: string;
  webhookSecret: string;
  clientId: string;
  clientSecret: string;
}

export interface CommitIdentity {
  author: { name: string; email: string };
  trailers: Record<string, string>;
  message: string;
}

const GIT_SHA = /^[0-9a-f]{40}$/;
const BRANCH = /^(?!\/)(?!.*\/\/)(?!.*\.\.)(?!.*@\{)(?!.*\.lock(?:\/|$))[A-Za-z0-9._/#-]{1,200}(?<![/.])$/;

function assertSha(sha: string, what: string): void {
  if (!GIT_SHA.test(sha)) throw new GithubAppError("INVALID_INPUT", `${what} is not a 40-hex git sha: ${JSON.stringify(sha)}`);
}

function assertBranch(branch: string): void {
  if (!BRANCH.test(branch) || branch.startsWith("refs/")) {
    throw new GithubAppError("INVALID_INPUT", `invalid branch name ${JSON.stringify(branch)}`);
  }
}

/**
 * Re-checks what the App itself can check before any GitHub call (defence in depth behind
 * `verification.validateChangeset`, which the control plane runs first): repo paths, no duplicate
 * or case-colliding paths, no `.github/workflows/**` (S-19), hashes and byte counts match content.
 */
export function precheckChangeset(changeset: Changeset): Array<{ path: string; op: "upsert" | "delete"; mode?: string; bytes?: Buffer }> {
  if (changeset.files.length === 0) throw new GithubAppError("CHANGESET_REJECTED", "EMPTY_DIFF: no files");
  assertSha(changeset.parentCommit, "parentCommit");
  const seen = new Set<string>();
  const out: Array<{ path: string; op: "upsert" | "delete"; mode?: string; bytes?: Buffer }> = [];
  for (const f of changeset.files) {
    if (!RepoPath.safeParse(f.path).success) throw new GithubAppError("CHANGESET_REJECTED", `PATH_INVALID: ${JSON.stringify(f.path)}`);
    const lower = f.path.toLowerCase();
    if (seen.has(lower)) throw new GithubAppError("CHANGESET_REJECTED", `CASE_COLLISION: ${f.path}`);
    seen.add(lower);
    if (lower === ".github/workflows" || lower.startsWith(".github/workflows/")) {
      throw new GithubAppError("CHANGESET_REJECTED", `WORKFLOW_FILE: ${f.path}`);
    }
    if (f.op === "delete") {
      out.push({ path: f.path, op: "delete" });
      continue;
    }
    if (f.mode !== "100644" && f.mode !== "100755") {
      throw new GithubAppError("CHANGESET_REJECTED", `SYMLINK_OR_SPECIAL_FILE: ${f.path} mode ${String(f.mode)}`);
    }
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(f.contentBase64))
      throw new GithubAppError("CHANGESET_REJECTED", `HASH_MISMATCH: ${f.path} is not base64`);
    const bytes = Buffer.from(f.contentBase64, "base64");
    if (bytes.byteLength !== f.bytes || sha256Of(bytes) !== f.sha256) {
      throw new GithubAppError("CHANGESET_REJECTED", `HASH_MISMATCH: ${f.path}`);
    }
    out.push({ path: f.path, op: "upsert", mode: f.mode, bytes });
  }
  return out;
}

type Gh = Awaited<ReturnType<typeof installationClient>>;

async function readRef(gh: Gh, owner: string, repo: string, branch: string): Promise<string | null> {
  try {
    const res = await gh.request("GET /repos/{owner}/{repo}/git/ref/{ref}", { owner, repo, ref: `heads/${branch}` });
    return res.data.object.sha;
  } catch (e) {
    if (statusOf(e) === 404) return null;
    throw wrap(e, `read ref ${branch}`);
  }
}

/** True when `sha` is a commit equal to the one we would have created (idempotent dispatcher retries). */
async function isSameCommit(gh: Gh, owner: string, repo: string, sha: string, want: { tree: string; parent: string; message: string }) {
  const c = await gh.request("GET /repos/{owner}/{repo}/git/commits/{commit_sha}", { owner, repo, commit_sha: sha });
  return (
    c.data.tree.sha === want.tree &&
    c.data.parents.length === 1 &&
    c.data.parents[0]?.sha === want.parent &&
    c.data.message === want.message
  );
}

/**
 * Builds blobs + tree (base_tree = parent tree; deletions as null-sha entries) + commit via the
 * Git Data API and creates or moves the ref. No git binary.
 *
 * - `createBranch: true` creates `refs/heads/<branch>`; `expectedHeadSha` must be null. If the ref
 *   already exists and points at an identical commit (same tree, parent and message) that commit is
 *   returned, so dispatcher retries are idempotent; otherwise REF_CONFLICT.
 * - `createBranch: false` moves an existing ref whose head must equal `expectedHeadSha`
 *   (HEAD_MISMATCH otherwise). When `parentCommit === expectedHeadSha` the move is a fast-forward
 *   (GitHub refuses a non-fast-forward); otherwise it is a rebase and the App force-moves the ref
 *   (BUILD-PROTOCOL.md section 10).
 */
export async function commitChangeset(
  creds: AppCredentials,
  repo: string,
  branch: string,
  changeset: Changeset,
  identity: CommitIdentity,
  options: { createBranch: boolean; expectedHeadSha: string | null },
): Promise<{ commitSha: string; treeSha: string }> {
  const { owner, repo: name } = splitRepo(repo);
  assertBranch(branch);
  const files = precheckChangeset(changeset);
  const message = buildCommitMessage(identity);
  validateAuthor(identity.author);
  if (options.createBranch && options.expectedHeadSha !== null) {
    throw new GithubAppError("INVALID_INPUT", "expectedHeadSha must be null when creating a branch");
  }
  if (!options.createBranch) {
    if (options.expectedHeadSha === null) throw new GithubAppError("INVALID_INPUT", "expectedHeadSha is required to move a branch");
    assertSha(options.expectedHeadSha, "expectedHeadSha");
  }

  const gh = await installationClient(creds, repo);
  try {
    const parent = await gh.request("GET /repos/{owner}/{repo}/git/commits/{commit_sha}", {
      owner,
      repo: name,
      commit_sha: changeset.parentCommit,
    });

    // Blobs, deduplicated by content (identical files share one blob).
    const blobByHash = new Map<string, string>();
    const tree: Array<{ path: string; mode: "100644" | "100755"; type: "blob"; sha: string | null }> = [];
    for (const f of files) {
      if (f.op === "delete") {
        tree.push({ path: f.path, mode: "100644", type: "blob", sha: null });
        continue;
      }
      const bytes = f.bytes!;
      const key = gitBlobOid(bytes);
      let sha = blobByHash.get(key);
      if (!sha) {
        const blob = await gh.request("POST /repos/{owner}/{repo}/git/blobs", {
          owner,
          repo: name,
          content: bytes.toString("base64"),
          encoding: "base64",
        });
        sha = blob.data.sha;
        if (sha !== key) throw new GithubAppError("GITHUB_ERROR", `blob oid mismatch for ${f.path}: GitHub ${sha}, local ${key}`);
        blobByHash.set(key, sha);
      }
      tree.push({ path: f.path, mode: f.mode as "100644" | "100755", type: "blob", sha });
    }
    const newTree = await gh.request("POST /repos/{owner}/{repo}/git/trees", {
      owner,
      repo: name,
      base_tree: parent.data.tree.sha,
      // Octokit's type forbids null sha; GitHub's documented deletion form is exactly `sha: null`.
      tree: tree as unknown as Array<{ path: string; mode: "100644"; type: "blob"; sha: string }>,
    });
    const treeSha = newTree.data.sha;
    const want = { tree: treeSha, parent: changeset.parentCommit, message };

    if (!options.createBranch) {
      const head = await readRef(gh, owner, name, branch);
      if (head === null) throw new GithubAppError("HEAD_MISMATCH", `branch ${branch} does not exist`);
      if (head !== options.expectedHeadSha) {
        if (await isSameCommit(gh, owner, name, head, want)) return { commitSha: head, treeSha };
        throw new GithubAppError("HEAD_MISMATCH", `branch ${branch} is at ${head}, expected ${options.expectedHeadSha}`);
      }
    }

    const commit = await gh.request("POST /repos/{owner}/{repo}/git/commits", {
      owner,
      repo: name,
      message,
      tree: treeSha,
      parents: [changeset.parentCommit],
      author: identity.author,
      committer: identity.author,
    });
    const commitSha = commit.data.sha;

    if (options.createBranch) {
      try {
        await gh.request("POST /repos/{owner}/{repo}/git/refs", { owner, repo: name, ref: `refs/heads/${branch}`, sha: commitSha });
      } catch (e) {
        if (statusOf(e) !== 422) throw e;
        const head = await readRef(gh, owner, name, branch);
        if (head !== null && (head === commitSha || (await isSameCommit(gh, owner, name, head, want)))) return { commitSha: head, treeSha };
        throw new GithubAppError("REF_CONFLICT", `branch ${branch} already exists at ${head ?? "?"}`, 422);
      }
    } else {
      const force = changeset.parentCommit !== options.expectedHeadSha;
      try {
        await gh.request("PATCH /repos/{owner}/{repo}/git/refs/{ref}", {
          owner,
          repo: name,
          ref: `heads/${branch}`,
          sha: commitSha,
          force,
        });
      } catch (e) {
        if (statusOf(e) === 422) throw new GithubAppError("REF_CONFLICT", `could not move ${branch}: ${messageOf(e)}`, 422);
        throw e;
      }
    }
    return { commitSha, treeSha };
  } catch (e) {
    throw wrap(e, `commitChangeset ${repo}@${branch}`);
  }
}

/**
 * Additive (B-0001). Points `branch` at an existing commit: the official PR branch at the exact
 * reviewed candidate commit (D9). Idempotent when the branch already points at `sha`. When the
 * branch exists elsewhere it is moved only if `expectedHeadSha` names its current head (the
 * revision-after-merge_blocked case, BUILD-PROTOCOL.md section 10); the move is forced.
 */
export async function createBranchAt(
  creds: AppCredentials,
  repo: string,
  branch: string,
  sha: string,
  options: { expectedHeadSha: string | null } = { expectedHeadSha: null },
): Promise<{ created: boolean; moved: boolean }> {
  const { owner, repo: name } = splitRepo(repo);
  assertBranch(branch);
  assertSha(sha, "sha");
  const gh = await installationClient(creds, repo);
  try {
    try {
      await gh.request("POST /repos/{owner}/{repo}/git/refs", { owner, repo: name, ref: `refs/heads/${branch}`, sha });
      return { created: true, moved: false };
    } catch (e) {
      if (statusOf(e) !== 422) throw e;
    }
    const head = await readRef(gh, owner, name, branch);
    if (head === sha) return { created: false, moved: false };
    if (head === null || options.expectedHeadSha === null || head !== options.expectedHeadSha) {
      throw new GithubAppError("REF_CONFLICT", `branch ${branch} exists at ${head ?? "?"}`, 422);
    }
    await gh.request("PATCH /repos/{owner}/{repo}/git/refs/{ref}", { owner, repo: name, ref: `heads/${branch}`, sha, force: true });
    return { created: false, moved: true };
  } catch (e) {
    throw wrap(e, `createBranchAt ${repo}@${branch}`);
  }
}

/** Additive (B-0001). Deletes a branch (the candidate ref after the PR opens). Missing branch is success. */
export async function deleteBranch(creds: AppCredentials, repo: string, branch: string): Promise<{ deleted: boolean }> {
  const { owner, repo: name } = splitRepo(repo);
  assertBranch(branch);
  const gh = await installationClient(creds, repo);
  try {
    await gh.request("DELETE /repos/{owner}/{repo}/git/refs/{ref}", { owner, repo: name, ref: `heads/${branch}` });
    return { deleted: true };
  } catch (e) {
    const s = statusOf(e);
    if (s === 404 || s === 422) return { deleted: false };
    throw wrap(e, `deleteBranch ${repo}@${branch}`);
  }
}

/**
 * Opens a PR as the App. `maintainer_can_modify` is false. Labels are added after creation.
 * If `provenance` is given, its `prNumber` is set to the new PR's number (it cannot be known before)
 * and the provenance section (JCS sha256 + record) is appended to the body by a follow-up PATCH.
 * The control plane must store the record with the same `prNumber` so the hashes agree.
 * Idempotent: if an open PR from `head` already exists it is returned (and its body refreshed).
 */
export async function openPullRequest(
  creds: AppCredentials,
  repo: string,
  input: { head: string; base: string; title: string; body: string; draft: boolean; labels: string[]; provenance: ProvenanceRecord | null },
): Promise<{ number: number; url: string }> {
  const { owner, repo: name } = splitRepo(repo);
  assertBranch(input.head);
  assertBranch(input.base);
  if (!input.title.trim() || input.title.length > 256 || /[\r\n]/.test(input.title)) {
    throw new GithubAppError("INVALID_INPUT", "PR title must be one line of 1-256 characters");
  }
  if (input.body.includes(PROVENANCE_MARKER)) throw new GithubAppError("INVALID_INPUT", "body must not contain the provenance marker");
  if (input.body.length > GITHUB_BODY_LIMIT) throw new GithubAppError("INVALID_INPUT", "PR body over GitHub's 65536 character limit");
  const gh = await installationClient(creds, repo);
  try {
    let number: number;
    let url: string;
    let created = true;
    try {
      const pr = await gh.request("POST /repos/{owner}/{repo}/pulls", {
        owner,
        repo: name,
        head: input.head,
        base: input.base,
        title: input.title,
        body: input.body,
        draft: input.draft,
        maintainer_can_modify: false,
      });
      number = pr.data.number;
      url = pr.data.html_url;
    } catch (e) {
      if (statusOf(e) !== 422) throw e;
      const existing = await gh.request("GET /repos/{owner}/{repo}/pulls", {
        owner,
        repo: name,
        head: `${owner}:${input.head}`,
        state: "open",
      });
      const pr = existing.data.find((p) => p.base.ref === input.base);
      if (!pr) throw e;
      number = pr.number;
      url = pr.html_url;
      created = false;
    }
    if (input.labels.length > 0) {
      await gh.request("POST /repos/{owner}/{repo}/issues/{issue_number}/labels", {
        owner,
        repo: name,
        issue_number: number,
        labels: input.labels,
      });
    }
    if (input.provenance !== null || !created) {
      let body = input.body;
      if (input.provenance !== null) {
        const { section } = renderProvenanceSection({ ...input.provenance, prNumber: number });
        body = `${input.body.replace(/\s+$/, "")}\n\n${section}\n`;
        if (body.length > GITHUB_BODY_LIMIT) throw new GithubAppError("INVALID_INPUT", "PR body with provenance over 65536 characters");
      }
      await gh.request("PATCH /repos/{owner}/{repo}/pulls/{pull_number}", { owner, repo: name, pull_number: number, body });
    }
    return { number, url };
  } catch (e) {
    throw wrap(e, `openPullRequest ${repo} ${input.head}`);
  }
}

/** Additive (B-0001). Closes a PR, optionally comments and locks it (S-18 fallback for non-App PRs; abandon). */
export async function closePullRequest(
  creds: AppCredentials,
  repo: string,
  prNumber: number,
  input: { comment: string | null; lock: boolean },
): Promise<void> {
  const { owner, repo: name } = splitRepo(repo);
  const gh = await installationClient(creds, repo);
  try {
    if (input.comment) {
      await gh.request("POST /repos/{owner}/{repo}/issues/{issue_number}/comments", {
        owner,
        repo: name,
        issue_number: prNumber,
        body: input.comment,
      });
    }
    await gh.request("PATCH /repos/{owner}/{repo}/pulls/{pull_number}", { owner, repo: name, pull_number: prNumber, state: "closed" });
    if (input.lock) {
      await gh.request("PUT /repos/{owner}/{repo}/issues/{issue_number}/lock", {
        owner,
        repo: name,
        issue_number: prNumber,
        lock_reason: "resolved",
      });
    }
  } catch (e) {
    throw wrap(e, `closePullRequest ${repo}#${prNumber}`);
  }
}

/**
 * Requests review from an organisation team (contracts 3.1.0, B-0005-control-plane): used when a qualified
 * diff touches a toolchain path so a maintainer must approve. `teamSlug` is the team's slug, e.g. "maintainers".
 */
export async function requestTeamReview(creds: AppCredentials, repo: string, prNumber: number, teamSlug: string): Promise<void> {
  const { owner, repo: name } = splitRepo(repo);
  const gh = await installationClient(creds, repo);
  try {
    await gh.request("POST /repos/{owner}/{repo}/pulls/{pull_number}/requested_reviewers", {
      owner,
      repo: name,
      pull_number: prNumber,
      team_reviewers: [teamSlug],
    });
  } catch (e) {
    throw wrap(e, `requestTeamReview ${repo}#${prNumber}`);
  }
}

/** Sets a commit status (e.g. `wos/qualified`). GitHub limits the description to 140 characters; longer ones are truncated. */
export async function setCommitStatus(
  creds: AppCredentials,
  repo: string,
  sha: string,
  input: { context: string; state: "pending" | "success" | "failure" | "error"; description: string; targetUrl: string | null },
): Promise<void> {
  const { owner, repo: name } = splitRepo(repo);
  assertSha(sha, "sha");
  if (!input.context.trim()) throw new GithubAppError("INVALID_INPUT", "status context is empty");
  const description = input.description.length > 140 ? `${input.description.slice(0, 139)}…` : input.description;
  const gh = await installationClient(creds, repo);
  try {
    await gh.request("POST /repos/{owner}/{repo}/statuses/{sha}", {
      owner,
      repo: name,
      sha,
      state: input.state,
      context: input.context,
      description,
      ...(input.targetUrl ? { target_url: input.targetUrl } : {}),
    });
  } catch (e) {
    throw wrap(e, `setCommitStatus ${repo}@${sha}`);
  }
}

/**
 * Turns on auto-merge (GraphQL `enablePullRequestAutoMerge`); with a required merge queue GitHub
 * enqueues the PR once its checks pass. If the PR is already mergeable ("clean status") GitHub
 * refuses auto-merge, so the PR is added to the merge queue directly (`enqueuePullRequest`).
 * "Already enabled" is success. UNVERIFIED against live GitHub (G-09 day-one list).
 */
export async function enableAutoMerge(creds: AppCredentials, repo: string, prNumber: number): Promise<void> {
  const { owner, repo: name } = splitRepo(repo);
  const gh = await installationClient(creds, repo);
  try {
    const pr = await gh.request("GET /repos/{owner}/{repo}/pulls/{pull_number}", { owner, repo: name, pull_number: prNumber });
    if (pr.data.auto_merge) return;
    const pullRequestId = pr.data.node_id;
    try {
      await gh.graphql(
        "mutation($pullRequestId: ID!) { enablePullRequestAutoMerge(input: {pullRequestId: $pullRequestId}) { clientMutationId } }",
        { pullRequestId },
      );
    } catch (e) {
      const msg = messageOf(e);
      if (/already enabled/i.test(msg)) return;
      if (!/clean status/i.test(msg)) throw e;
      await gh.graphql(
        "mutation($pullRequestId: ID!) { enqueuePullRequest(input: {pullRequestId: $pullRequestId}) { clientMutationId } }",
        {
          pullRequestId,
        },
      );
    }
  } catch (e) {
    throw wrap(e, `enableAutoMerge ${repo}#${prNumber}`);
  }
}

/**
 * git blob oids of the given paths at a commit (Trees API, recursive), for manifest verification.
 * Missing paths, directories, symlinks and submodules map to null. A truncated recursive listing
 * falls back to walking only the directories on the requested paths.
 */
export async function blobOidsAt(
  creds: AppCredentials,
  repo: string,
  commit: string,
  paths: string[],
): Promise<Map<string, string | null>> {
  const { owner, repo: name } = splitRepo(repo);
  assertSha(commit, "commit");
  for (const p of paths) if (!RepoPath.safeParse(p).success) throw new GithubAppError("INVALID_INPUT", `invalid path ${JSON.stringify(p)}`);
  const result = new Map<string, string | null>(paths.map((p) => [p, null]));
  if (paths.length === 0) return result;
  const gh = await installationClient(creds, repo);
  type Entry = { path?: string; mode?: string; type?: string; sha?: string };
  const record = (prefix: string, entries: Entry[]) => {
    for (const e of entries) {
      const full = prefix ? `${prefix}/${e.path}` : e.path;
      if (full !== undefined && result.has(full) && e.type === "blob" && e.mode !== "120000" && e.sha) result.set(full, e.sha);
    }
  };
  try {
    const all = await gh.request("GET /repos/{owner}/{repo}/git/trees/{tree_sha}", { owner, repo: name, tree_sha: commit, recursive: "1" });
    if (!all.data.truncated) {
      record("", all.data.tree as Entry[]);
      return result;
    }
    // Truncated: walk directory by directory, only along requested paths.
    const listings = new Map<string, Promise<Entry[] | null>>();
    const list = (dir: string, sha: string) => {
      let p = listings.get(dir);
      if (!p) {
        p = gh
          .request("GET /repos/{owner}/{repo}/git/trees/{tree_sha}", { owner, repo: name, tree_sha: sha })
          .then((r) => r.data.tree as Entry[]);
        listings.set(dir, p);
      }
      return p;
    };
    const root = await gh.request("GET /repos/{owner}/{repo}/git/commits/{commit_sha}", { owner, repo: name, commit_sha: commit });
    for (const path of paths) {
      const segs = path.split("/");
      let entries = await list("", root.data.tree.sha);
      let dir = "";
      for (let i = 0; i < segs.length && entries; i++) {
        const e = entries.find((x) => x.path === segs[i]);
        if (!e) break;
        if (i === segs.length - 1) {
          if (e.type === "blob" && e.mode !== "120000" && e.sha) result.set(path, e.sha);
        } else if (e.type === "tree" && e.sha) {
          dir = dir ? `${dir}/${segs[i]}` : segs[i]!;
          entries = await list(dir, e.sha);
        } else break;
      }
    }
    return result;
  } catch (e) {
    if (statusOf(e) === 404 || statusOf(e) === 422)
      throw new GithubAppError("INVALID_INPUT", `commit ${commit} not found in ${repo}`, statusOf(e));
    throw wrap(e, `blobOidsAt ${repo}@${commit}`);
  }
}

export async function createIssue(
  creds: AppCredentials,
  repo: string,
  input: { title: string; body: string; labels: string[] },
): Promise<{ number: number; url: string }> {
  const { owner, repo: name } = splitRepo(repo);
  if (!input.title.trim() || input.title.length > 256 || /[\r\n]/.test(input.title)) {
    throw new GithubAppError("INVALID_INPUT", "issue title must be one line of 1-256 characters");
  }
  if (input.body.length > GITHUB_BODY_LIMIT) throw new GithubAppError("INVALID_INPUT", "issue body over 65536 characters");
  const gh = await installationClient(creds, repo);
  try {
    const res = await gh.request("POST /repos/{owner}/{repo}/issues", {
      owner,
      repo: name,
      title: input.title,
      body: input.body,
      labels: input.labels,
    });
    return { number: res.data.number, url: res.data.html_url };
  } catch (e) {
    throw wrap(e, `createIssue ${repo}`);
  }
}

/**
 * Constant-time HMAC-SHA256 check of X-Hub-Signature-256 (`sha256=<64 hex>`). The HMAC is over the
 * raw body's UTF-8 bytes. A malformed header is still compared (against a zero buffer) so the
 * timing does not reveal whether the header parsed.
 */
export async function verifyWebhookSignature(secret: string, rawBody: string, signatureHeader: string): Promise<boolean> {
  if (secret.length === 0) return false;
  const expected = createHmac("sha256", secret).update(rawBody, "utf8").digest();
  const m = /^sha256=([0-9a-f]{64})$/.exec(signatureHeader.trim().toLowerCase());
  const given = m ? Buffer.from(m[1]!, "hex") : Buffer.alloc(expected.length);
  const equal = timingSafeEqual(expected, given);
  return equal && m !== null;
}

export type GithubUserIdentity = { userId: number; login: string; createdAt: string; avatarUrl: string | null };

async function oauthPost(path: string, params: Record<string, string>): Promise<Record<string, unknown>> {
  const t = currentTransport();
  const res = await t.fetch(`${t.oauthBaseUrl}${path}`, {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/x-www-form-urlencoded", "user-agent": "wOS" },
    body: new URLSearchParams(params).toString(),
  });
  const text = await res.text();
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new GithubAppError("OAUTH_ERROR", `GitHub ${path} returned ${res.status} non-JSON`, res.status);
  }
  if (!res.ok && !(json && typeof json === "object" && "error" in json)) {
    throw new GithubAppError("OAUTH_ERROR", `GitHub ${path} returned ${res.status}`, res.status);
  }
  return json as Record<string, unknown>;
}

/**
 * Additive (B-0001). Starts the device flow for linking a GitHub identity (D8); the control plane
 * stores `deviceCode` server side and shows `userCode` and `verificationUri` to the client.
 */
export async function startDeviceAuthorization(
  creds: AppCredentials,
): Promise<{ deviceCode: string; userCode: string; verificationUri: string; expiresInSeconds: number; intervalSeconds: number }> {
  const r = await oauthPost("/login/device/code", { client_id: creds.clientId });
  if (typeof r.error === "string") throw new GithubAppError("OAUTH_ERROR", `device flow: ${r.error}`);
  const { device_code, user_code, verification_uri, expires_in, interval } = r;
  if (typeof device_code !== "string" || typeof user_code !== "string" || typeof verification_uri !== "string") {
    throw new GithubAppError("OAUTH_ERROR", "device flow: malformed response");
  }
  return {
    deviceCode: device_code,
    userCode: user_code,
    verificationUri: verification_uri,
    expiresInSeconds: typeof expires_in === "number" ? expires_in : 900,
    intervalSeconds: typeof interval === "number" ? interval : 5,
  };
}

/**
 * Device flow / web flow for LINKING a GitHub identity to an account (D8). Returns the identity;
 * the user token lives only in this function: it reads `GET /user` once and then revokes the
 * token (best effort). Nothing token-shaped is returned or logged (S-6).
 */
export async function exchangeUserAuthorization(
  creds: AppCredentials,
  input: { deviceCode: string } | { code: string; redirectUri: string },
): Promise<{ status: "pending" | "denied" | "expired" } | { status: "ok"; user: GithubUserIdentity }> {
  const params: Record<string, string> =
    "deviceCode" in input
      ? { client_id: creds.clientId, device_code: input.deviceCode, grant_type: "urn:ietf:params:oauth:grant-type:device_code" }
      : { client_id: creds.clientId, client_secret: creds.clientSecret, code: input.code, redirect_uri: input.redirectUri };
  const r = await oauthPost("/login/oauth/access_token", params);
  if (typeof r.error === "string") {
    switch (r.error) {
      case "authorization_pending":
      case "slow_down":
        return { status: "pending" };
      case "access_denied":
        return { status: "denied" };
      case "expired_token":
      case "bad_verification_code":
      case "incorrect_device_code":
        return { status: "expired" };
      default:
        throw new GithubAppError("OAUTH_ERROR", `token exchange: ${r.error}`);
    }
  }
  const token = r.access_token;
  if (typeof token !== "string" || token === "") throw new GithubAppError("OAUTH_ERROR", "token exchange: no access_token");
  const t = currentTransport();
  try {
    const res = await t.fetch(`${t.apiBaseUrl}/user`, {
      headers: { accept: "application/vnd.github+json", authorization: `Bearer ${token}`, "user-agent": "wOS" },
    });
    if (!res.ok) throw new GithubAppError("OAUTH_ERROR", `GET /user returned ${res.status}`, res.status);
    const u = (await res.json()) as { id?: unknown; login?: unknown; created_at?: unknown; avatar_url?: unknown };
    if (typeof u.id !== "number" || typeof u.login !== "string" || typeof u.created_at !== "string") {
      throw new GithubAppError("OAUTH_ERROR", "GET /user: malformed response");
    }
    return {
      status: "ok",
      user: { userId: u.id, login: u.login, createdAt: u.created_at, avatarUrl: typeof u.avatar_url === "string" ? u.avatar_url : null },
    };
  } finally {
    await t
      .fetch(`${t.apiBaseUrl}/applications/${encodeURIComponent(creds.clientId)}/token`, {
        method: "DELETE",
        headers: {
          accept: "application/vnd.github+json",
          authorization: `Basic ${Buffer.from(`${creds.clientId}:${creds.clientSecret}`).toString("base64")}`,
          "content-type": "application/json",
          "user-agent": "wOS",
        },
        body: JSON.stringify({ access_token: token }),
      })
      .catch(() => undefined);
  }
}

// ---------------------------------------------------------------------------------------------
// Contracts 3.0.0 additions (B-0001-control-plane). The repo is always the caller's ABU/document
// repo (`AbuSummary.repo`, `TaskView.repo`), never a constant.
// ---------------------------------------------------------------------------------------------

/** Current head sha of a branch, or null when the branch does not exist. */
export async function getBranchHead(creds: AppCredentials, repo: string, branch: string): Promise<string | null> {
  const { owner, repo: name } = splitRepo(repo);
  assertBranch(branch);
  const gh = await installationClient(creds, repo);
  return readRef(gh, owner, name, branch);
}

/** Bytes of a regular file at a commit, or null when the path is missing, a directory, a symlink or a submodule. */
export async function readFileAt(creds: AppCredentials, repo: string, commit: string, path: string): Promise<Uint8Array | null> {
  const { owner, repo: name } = splitRepo(repo);
  const oid = (await blobOidsAt(creds, repo, commit, [path])).get(path) ?? null;
  if (oid === null) return null;
  const gh = await installationClient(creds, repo);
  try {
    const blob = await gh.request("GET /repos/{owner}/{repo}/git/blobs/{file_sha}", { owner, repo: name, file_sha: oid });
    const bytes = Buffer.from(blob.data.content, blob.data.encoding === "base64" ? "base64" : "utf8");
    if (gitBlobOid(bytes) !== oid) throw new GithubAppError("GITHUB_ERROR", `blob ${oid} content does not hash to its id`);
    return new Uint8Array(bytes);
  } catch (e) {
    throw wrap(e, `readFileAt ${repo}@${commit}:${path}`);
  }
}

/**
 * Every regular-file and symlink path at a commit (blobs only; directories and submodules are
 * left out), sorted by UTF-16 code units. Walks subtrees when the recursive listing is truncated.
 */
export async function listTreePaths(creds: AppCredentials, repo: string, commit: string): Promise<string[]> {
  const { owner, repo: name } = splitRepo(repo);
  assertSha(commit, "commit");
  const gh = await installationClient(creds, repo);
  type Entry = { path?: string; type?: string; sha?: string };
  const out: string[] = [];
  try {
    const all = await gh.request("GET /repos/{owner}/{repo}/git/trees/{tree_sha}", { owner, repo: name, tree_sha: commit, recursive: "1" });
    if (!all.data.truncated) {
      for (const e of all.data.tree as Entry[]) if (e.type === "blob" && e.path) out.push(e.path);
    } else {
      const root = await gh.request("GET /repos/{owner}/{repo}/git/commits/{commit_sha}", { owner, repo: name, commit_sha: commit });
      const walk = async (sha: string, prefix: string): Promise<void> => {
        const t = await gh.request("GET /repos/{owner}/{repo}/git/trees/{tree_sha}", { owner, repo: name, tree_sha: sha });
        for (const e of t.data.tree as Entry[]) {
          const p = prefix ? `${prefix}/${e.path}` : e.path!;
          if (e.type === "blob") out.push(p);
          else if (e.type === "tree" && e.sha) await walk(e.sha, p);
        }
      };
      await walk(root.data.tree.sha, "");
    }
  } catch (e) {
    if (statusOf(e) === 404 || statusOf(e) === 422)
      throw new GithubAppError("INVALID_INPUT", `commit ${commit} not found in ${repo}`, statusOf(e));
    throw wrap(e, `listTreePaths ${repo}@${commit}`);
  }
  return out.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

/**
 * Moves an EXISTING branch to `sha`. With `{expectedHeadSha}` the move happens only if the branch is
 * currently there (compare-and-swap; the move itself may be non-fast-forward, e.g. a rebase). With
 * `{force: true}` it moves unconditionally. Idempotent when the branch already points at `sha`.
 */
export async function moveBranch(
  creds: AppCredentials,
  repo: string,
  branch: string,
  sha: string,
  options: { expectedHeadSha: string } | { force: true },
): Promise<{ previousSha: string }> {
  const { owner, repo: name } = splitRepo(repo);
  assertBranch(branch);
  assertSha(sha, "sha");
  if ("expectedHeadSha" in options) assertSha(options.expectedHeadSha, "expectedHeadSha");
  const gh = await installationClient(creds, repo);
  try {
    const head = await readRef(gh, owner, name, branch);
    if (head === null) throw new GithubAppError("HEAD_MISMATCH", `branch ${branch} does not exist`);
    if (head === sha) return { previousSha: head };
    if ("expectedHeadSha" in options && head !== options.expectedHeadSha) {
      throw new GithubAppError("HEAD_MISMATCH", `branch ${branch} is at ${head}, expected ${options.expectedHeadSha}`);
    }
    await gh.request("PATCH /repos/{owner}/{repo}/git/refs/{ref}", { owner, repo: name, ref: `heads/${branch}`, sha, force: true });
    return { previousSha: head };
  } catch (e) {
    throw wrap(e, `moveBranch ${repo}@${branch}`);
  }
}

/** Unified diff text between two commits (compare API, `application/vnd.github.diff`). */
export async function compareDiff(creds: AppCredentials, repo: string, base: string, head: string): Promise<string> {
  const { owner, repo: name } = splitRepo(repo);
  assertSha(base, "base");
  assertSha(head, "head");
  const gh = await installationClient(creds, repo);
  try {
    const res = await gh.request("GET /repos/{owner}/{repo}/compare/{basehead}", {
      owner,
      repo: name,
      basehead: `${base}...${head}`,
      mediaType: { format: "diff" },
    });
    return String(res.data as unknown);
  } catch (e) {
    throw wrap(e, `compareDiff ${repo} ${base}...${head}`);
  }
}

/**
 * The GitHub web-flow authorisation URL for linking an identity from the website (D8, S-6). Pure:
 * the control plane stores only a hash of `state` and binds the callback to it.
 */
export function webAuthorizeUrl(creds: AppCredentials, input: { state: string; redirectUri: string }): string {
  if (input.state.length < 16) throw new GithubAppError("INVALID_INPUT", "state must be at least 16 characters of randomness");
  const url = new URL("/login/oauth/authorize", currentTransport().oauthBaseUrl);
  url.searchParams.set("client_id", creds.clientId);
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("state", input.state);
  url.searchParams.set("allow_signup", "false");
  return url.toString();
}
