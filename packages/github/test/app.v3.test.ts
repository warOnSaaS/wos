import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  compareDiff,
  getBranchHead,
  listTreePaths,
  moveBranch,
  readFileAt,
  resetGithubAppConfig,
  webAuthorizeUrl,
} from "../src/app/index.js";
import type { FakeGithub } from "./support/fake-github.js";
import { cleanup, git, makeApp, makeUpstream, OAUTH, writeFiles } from "./support/setup.js";

// Not the platform or product constant: the repo always comes from the ABU/document.
const REPO = "waronsaas/some-app-repo";

let upstream: { dir: string; base: string };
let second: string;
let fake: FakeGithub;
let creds: ReturnType<typeof makeApp>["creds"];

beforeEach(() => {
  upstream = makeUpstream({ "README.md": "# app\n", "src/a.ts": "a\n", "src/deep/b.ts": "b\n", "bin/run.sh": "#!/bin/sh\n\u0000x" });
  writeFiles(upstream.dir, { "src/a.ts": "a2\n", "src/new.ts": "new\n" });
  git(upstream.dir, "rm", "-q", "src/deep/b.ts");
  git(upstream.dir, "add", "-A");
  git(upstream.dir, "commit", "-q", "-m", "second");
  second = git(upstream.dir, "rev-parse", "HEAD");
  git(upstream.dir, "branch", "feature", upstream.base);
  ({ creds, fake } = makeApp());
  fake.importGitRepo(upstream.dir, REPO);
});

afterEach(() => {
  cleanup(upstream.dir);
  resetGithubAppConfig();
});

describe("contracts 3.0.0 App operations (content-addressed fake)", () => {
  it("getBranchHead returns the head or null", async () => {
    expect(await getBranchHead(creds, REPO, "main")).toBe(second);
    expect(await getBranchHead(creds, REPO, "feature")).toBe(upstream.base);
    expect(await getBranchHead(creds, REPO, "nope")).toBeNull();
  });

  it("readFileAt returns exact bytes at a commit, null for missing paths and directories", async () => {
    expect(Buffer.from((await readFileAt(creds, REPO, upstream.base, "src/a.ts"))!).toString()).toBe("a\n");
    expect(Buffer.from((await readFileAt(creds, REPO, second, "src/a.ts"))!).toString()).toBe("a2\n");
    expect(await readFileAt(creds, REPO, second, "src/deep/b.ts")).toBeNull();
    expect(await readFileAt(creds, REPO, second, "src")).toBeNull();
  });

  it("listTreePaths lists blob paths sorted, also via the truncated walk", async () => {
    const expected = git(upstream.dir, "ls-tree", "-r", "--name-only", second).split("\n").sort();
    expect(await listTreePaths(creds, REPO, second)).toEqual(expected);
    fake.truncateTrees = true;
    expect(await listTreePaths(creds, REPO, second)).toEqual(expected);
  });

  it("moveBranch is compare-and-swap with expectedHeadSha, unconditional with force, idempotent at the target", async () => {
    await expect(moveBranch(creds, REPO, "feature", second, { expectedHeadSha: second })).rejects.toMatchObject({ code: "HEAD_MISMATCH" });
    expect(await moveBranch(creds, REPO, "feature", second, { expectedHeadSha: upstream.base })).toEqual({ previousSha: upstream.base });
    expect(fake.refsOf(REPO).get("refs/heads/feature")).toBe(second);
    // Non-fast-forward back to base with force.
    expect(await moveBranch(creds, REPO, "feature", upstream.base, { force: true })).toEqual({ previousSha: second });
    expect(await moveBranch(creds, REPO, "feature", upstream.base, { force: true })).toEqual({ previousSha: upstream.base });
    await expect(moveBranch(creds, REPO, "missing", second, { force: true })).rejects.toMatchObject({ code: "HEAD_MISMATCH" });
  });

  it("compareDiff returns unified diff text for base...head", async () => {
    const diff = await compareDiff(creds, REPO, upstream.base, second);
    expect(diff).toContain("diff --git a/src/a.ts b/src/a.ts");
    expect(diff).toContain("-a\n+a2\n");
    expect(diff).toContain("+++ /dev/null");
    expect(diff).toContain("--- /dev/null\n+++ b/src/new.ts");
    expect(diff).not.toContain("README.md");
    const req = fake.requests.at(-1)!;
    expect(req.path).toBe(`/repos/${REPO}/compare/${upstream.base}...${second}`);
  });

  it("webAuthorizeUrl builds the web-flow URL with the client id, redirect and state", () => {
    const url = new URL(
      webAuthorizeUrl(creds, { state: "s".repeat(32), redirectUri: "https://api.waronsaas.com/v1/github/oauth/callback" }),
    );
    expect(url.origin + url.pathname).toBe(`${OAUTH}/login/oauth/authorize`);
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: creds.clientId,
      redirect_uri: "https://api.waronsaas.com/v1/github/oauth/callback",
      state: "s".repeat(32),
      allow_signup: "false",
    });
    expect(() => webAuthorizeUrl(creds, { state: "short", redirectUri: "https://x" })).toThrow();
  });
});
