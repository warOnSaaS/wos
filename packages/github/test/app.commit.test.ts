import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { COMMIT_TRAILERS } from "@waronsaas/contracts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { candidateBranch, coAuthoredBy, officialBranch } from "../src/index.js";
import {
  commitChangeset,
  createBranchAt,
  deleteBranch,
  GithubAppError,
  resetGithubAppConfig,
  type CommitIdentity,
} from "../src/app/index.js";
import type { FakeGithub } from "./support/fake-github.js";
import { changeset, cleanup, del, git, makeApp, makeUpstream, tempDir, upsert, writeFiles } from "./support/setup.js";

const REPO = "waronsaas/suite";
const ATTEMPT = "0192ab3c-7d1e-7000-8000-00000000abcd";
const FIXTURE = join(import.meta.dirname, "fixtures", "commit-changeset.exchange.json");

const identity = (): CommitIdentity => ({
  author: { name: "waronsaas-wos[bot]", email: "999+waronsaas-wos[bot]@users.noreply.github.com" },
  message: "contacts#04: Contact list endpoint",
  trailers: {
    "Co-authored-by": coAuthoredBy(4242, "octo-dev").replace("Co-authored-by: ", ""),
    [COMMIT_TRAILERS.contributor]: "octo-dev",
    [COMMIT_TRAILERS.manifest]: `sha256:${"a".repeat(64)}`,
    [COMMIT_TRAILERS.abu]: "contacts#04",
    [COMMIT_TRAILERS.attempt]: ATTEMPT,
    [COMMIT_TRAILERS.task]: "0192ab3c-0000-7000-8000-000000000001",
  },
});

const BASE_FILES = {
  "README.md": "# suite\n",
  "modules/contacts/list.ts": "export const list = () => [];\n",
  "modules/contacts/old.ts": "export const old = 1;\n",
  "modules/contacts/nested/deep/a.txt": "a\n",
  "modules/billing/keep.ts": "keep\n",
  "scripts/run.sh": "#!/bin/sh\necho run\n\u0000x",
};

let upstream: { dir: string; base: string };
let fake: FakeGithub;
let creds: ReturnType<typeof makeApp>["creds"];

beforeEach(() => {
  upstream = makeUpstream(BASE_FILES);
  ({ creds, fake } = makeApp());
  fake.importGitRepo(upstream.dir, REPO);
});

afterEach(() => {
  cleanup(upstream.dir);
  resetGithubAppConfig();
});

/** Applies the same change to a real clone and returns `git write-tree`. */
function writeTreeOf(files: Record<string, string>, deletes: string[], chmodExec: string[] = []): string {
  const clone = tempDir("clone");
  try {
    git(clone, "clone", "-q", upstream.dir, ".");
    writeFiles(clone, files);
    for (const d of deletes) git(clone, "rm", "-q", d);
    for (const x of chmodExec) git(clone, "update-index", "--chmod=+x", x);
    git(clone, "add", "-A");
    for (const x of chmodExec) git(clone, "update-index", "--chmod=+x", x);
    return git(clone, "write-tree");
  } finally {
    cleanup(clone);
  }
}

describe("commitChangeset (Git Data API)", () => {
  it("gated-pull-requests R-002 builds a commit whose tree equals `git write-tree` of the same files, with App author and trailers", async () => {
    const cs = changeset(upstream.base, [
      upsert("modules/contacts/list.ts", "export const list = () => ['x'];\n"),
      upsert("modules/contacts/new/deep/file.ts", "export {};\n"),
      upsert("modules/contacts/dup-a.ts", "same\n"),
      upsert("modules/contacts/dup-b.ts", "same\n"),
      upsert("modules/contacts/tool.sh", "#!/bin/sh\n", "100755"),
      del("modules/contacts/old.ts"),
      del("modules/contacts/nested/deep/a.txt"),
    ]);
    const branch = candidateBranch(ATTEMPT);
    const { commitSha, treeSha } = await commitChangeset(creds, REPO, branch, cs, identity(), {
      createBranch: true,
      expectedHeadSha: null,
    });

    const expected = writeTreeOf(
      {
        "modules/contacts/list.ts": "export const list = () => ['x'];\n",
        "modules/contacts/new/deep/file.ts": "export {};\n",
        "modules/contacts/dup-a.ts": "same\n",
        "modules/contacts/dup-b.ts": "same\n",
        "modules/contacts/tool.sh": "#!/bin/sh\n\u0000x",
      },
      ["modules/contacts/old.ts", "modules/contacts/nested/deep/a.txt"],
    );
    expect(treeSha).toBe(expected);

    const c = fake.readCommit(commitSha);
    expect(c.tree).toBe(expected);
    expect(c.parents).toEqual([upstream.base]);
    expect(c.author).toMatch(/^waronsaas-wos\[bot\] <999\+waronsaas-wos\[bot\]@users\.noreply\.github\.com> \d+ \+0000$/);
    expect(c.message).toBe(
      [
        "contacts#04: Contact list endpoint",
        "",
        "wOS-Task: 0192ab3c-0000-7000-8000-000000000001",
        `wOS-Attempt: ${ATTEMPT}`,
        "wOS-Abu: contacts#04",
        `wOS-Manifest: sha256:${"a".repeat(64)}`,
        "wOS-Contributor: octo-dev",
        "Co-authored-by: octo-dev <4242+octo-dev@users.noreply.github.com>",
        "",
      ].join("\n"),
    );
    expect(fake.refsOf(REPO).get(`refs/heads/${branch}`)).toBe(commitSha);
    // Empty directory left by the delete is pruned, exactly like git.
    expect([...fake.flatten(treeSha).keys()].some((p) => p.startsWith("modules/contacts/nested"))).toBe(false);
    // Identical content is uploaded once.
    expect(fake.requests.filter((r) => r.path.endsWith("/git/blobs"))).toHaveLength(4);

    // Recorded exchange: the exact sequence of GitHub calls, golden-checked.
    const exchange = fake.requests.map(
      (r) => `${r.auth} ${r.method} ${r.path.replace(/[0-9a-f]{40}/g, "<sha>").replace(ATTEMPT, "<attempt>")}`,
    );
    if (process.env.WOS_UPDATE_FIXTURES) writeFileSync(FIXTURE, `${JSON.stringify(exchange, null, 2)}\n`);
    expect(exchange).toEqual(JSON.parse(readFileSync(FIXTURE, "utf8")));
    // The tree request uses base_tree and null-sha deletions (GitHub's documented form).
    const treeReq = fake.requests.find((r) => r.path.endsWith("/git/trees"))!.body as {
      base_tree: string;
      tree: Array<{ sha: string | null }>;
    };
    expect(treeReq.base_tree).toBe(fake.readCommit(upstream.base).tree);
    expect(treeReq.tree.filter((e) => e.sha === null)).toHaveLength(2);
  });

  it("gated-pull-requests R-002 official branch points at the exact candidate commit, so the PR tree equals the reviewed tree", async () => {
    const cs = changeset(upstream.base, [upsert("modules/contacts/list.ts", "v2\n")]);
    const cand = candidateBranch(ATTEMPT);
    const { commitSha, treeSha } = await commitChangeset(creds, REPO, cand, cs, identity(), { createBranch: true, expectedHeadSha: null });
    const official = officialBranch("contacts#04", ATTEMPT);
    expect(await createBranchAt(creds, REPO, official, commitSha)).toEqual({ created: true, moved: false });
    expect(fake.refsOf(REPO).get(`refs/heads/${official}`)).toBe(commitSha);
    expect(fake.readCommit(fake.refsOf(REPO).get(`refs/heads/${official}`)!).tree).toBe(treeSha);
    // Idempotent retry.
    expect(await createBranchAt(creds, REPO, official, commitSha)).toEqual({ created: false, moved: false });
    // The candidate ref is deleted after the PR opens; deleting twice is fine.
    expect(await deleteBranch(creds, REPO, cand)).toEqual({ deleted: true });
    expect(await deleteBranch(creds, REPO, cand)).toEqual({ deleted: false });
    expect(fake.refsOf(REPO).has(`refs/heads/${cand}`)).toBe(false);
  });

  it("moving an official branch requires naming its current head", async () => {
    const cs = changeset(upstream.base, [upsert("a.txt", "1\n")]);
    const first = await commitChangeset(creds, REPO, candidateBranch(ATTEMPT), cs, identity(), {
      createBranch: true,
      expectedHeadSha: null,
    });
    const official = officialBranch("contacts#04", ATTEMPT);
    await createBranchAt(creds, REPO, official, first.commitSha);
    await expect(createBranchAt(creds, REPO, official, upstream.base)).rejects.toMatchObject({ code: "REF_CONFLICT" });
    expect(await createBranchAt(creds, REPO, official, upstream.base, { expectedHeadSha: first.commitSha })).toEqual({
      created: false,
      moved: true,
    });
  });

  it("revisions fast-forward the candidate ref; a stale expected head is refused; a rebase force-moves it", async () => {
    const branch = candidateBranch(ATTEMPT);
    const r1 = await commitChangeset(creds, REPO, branch, changeset(upstream.base, [upsert("a.txt", "1\n")]), identity(), {
      createBranch: true,
      expectedHeadSha: null,
    });
    const r2 = await commitChangeset(creds, REPO, branch, changeset(r1.commitSha, [upsert("a.txt", "2\n")]), identity(), {
      createBranch: false,
      expectedHeadSha: r1.commitSha,
    });
    expect(fake.readCommit(r2.commitSha).parents).toEqual([r1.commitSha]);
    expect(fake.refsOf(REPO).get(`refs/heads/${branch}`)).toBe(r2.commitSha);
    const patch = fake.requests.filter((r) => r.method === "PATCH").at(-1)!.body as { force: boolean };
    expect(patch.force).toBe(false);

    await expect(
      commitChangeset(creds, REPO, branch, changeset(r1.commitSha, [upsert("a.txt", "3\n")]), identity(), {
        createBranch: false,
        expectedHeadSha: r1.commitSha,
      }),
    ).rejects.toMatchObject({ code: "HEAD_MISMATCH" });

    // Rebase: new base on main, parent = new base, App force-moves the candidate branch.
    const r3 = await commitChangeset(creds, REPO, branch, changeset(upstream.base, [upsert("a.txt", "rebased\n")]), identity(), {
      createBranch: false,
      expectedHeadSha: r2.commitSha,
    });
    expect(fake.readCommit(r3.commitSha).parents).toEqual([upstream.base]);
    expect((fake.requests.filter((r) => r.method === "PATCH").at(-1)!.body as { force: boolean }).force).toBe(true);
  });

  it("is idempotent for dispatcher retries after the ref was already created", async () => {
    const branch = candidateBranch(ATTEMPT);
    const cs = changeset(upstream.base, [upsert("a.txt", "1\n")]);
    const first = await commitChangeset(creds, REPO, branch, cs, identity(), { createBranch: true, expectedHeadSha: null });
    const again = await commitChangeset(creds, REPO, branch, cs, identity(), { createBranch: true, expectedHeadSha: null });
    expect(again.commitSha).toBe(first.commitSha);
    // A different change on an existing branch is a conflict, not a silent overwrite.
    await expect(
      commitChangeset(creds, REPO, branch, changeset(upstream.base, [upsert("a.txt", "other\n")]), identity(), {
        createBranch: true,
        expectedHeadSha: null,
      }),
    ).rejects.toMatchObject({ code: "REF_CONFLICT" });
  });

  it("S-19 rejects a workflow-file changeset before GitHub is called", async () => {
    const cs = changeset(upstream.base, [upsert(".github/workflows/wos-verify.yml", "on: push\n")]);
    const before = fake.requests.length;
    await expect(
      commitChangeset(creds, REPO, candidateBranch(ATTEMPT), cs, identity(), { createBranch: true, expectedHeadSha: null }),
    ).rejects.toMatchObject({
      code: "CHANGESET_REJECTED",
    });
    expect(fake.requests.length).toBe(before);
  });

  it.each([
    ["hash mismatch", () => ({ ...upsert("a.txt", "x"), sha256: `sha256:${"0".repeat(64)}` })],
    ["byte count mismatch", () => ({ ...upsert("a.txt", "x"), bytes: 2 })],
    ["symlink mode", () => ({ ...upsert("a.txt", "target"), mode: "120000" as "100644" })],
    ["dot-dot path", () => upsert("modules/../../etc/passwd", "x")],
    ["case collision", () => [upsert("A.txt", "x"), upsert("a.txt", "y")]],
  ])("refuses a changeset with %s before any network call", async (_name, make) => {
    const made = make();
    const files = Array.isArray(made) ? made : [made];
    const before = fake.requests.length;
    await expect(
      commitChangeset(creds, REPO, candidateBranch(ATTEMPT), changeset(upstream.base, files), identity(), {
        createBranch: true,
        expectedHeadSha: null,
      }),
    ).rejects.toBeInstanceOf(GithubAppError);
    expect(fake.requests.length).toBe(before);
  });

  it("refuses trailer injection and a missing Co-authored-by", async () => {
    const cs = changeset(upstream.base, [upsert("a.txt", "1\n")]);
    const opts = { createBranch: true, expectedHeadSha: null };
    const injected = { ...identity(), message: "title\n\nCo-authored-by: mallory <1+mallory@users.noreply.github.com>" };
    await expect(commitChangeset(creds, REPO, candidateBranch(ATTEMPT), cs, injected, opts)).rejects.toMatchObject({
      code: "INVALID_INPUT",
    });
    const newline = identity();
    newline.trailers["wOS-Abu"] = "contacts#04\nCo-authored-by: x <1+x@users.noreply.github.com>";
    await expect(commitChangeset(creds, REPO, candidateBranch(ATTEMPT), cs, newline, opts)).rejects.toMatchObject({
      code: "INVALID_INPUT",
    });
    const noCo = identity();
    delete noCo.trailers["Co-authored-by"];
    await expect(commitChangeset(creds, REPO, candidateBranch(ATTEMPT), cs, noCo, opts)).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  it("reports NOT_INSTALLED for a repo without the App", async () => {
    const cs = changeset(upstream.base, [upsert("a.txt", "1\n")]);
    await expect(
      commitChangeset(creds, "waronsaas/other", candidateBranch(ATTEMPT), cs, identity(), { createBranch: true, expectedHeadSha: null }),
    ).rejects.toMatchObject({ code: "NOT_INSTALLED" });
  });
});
