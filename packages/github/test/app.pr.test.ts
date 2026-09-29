import type { ProvenanceRecord } from "@waronsaas/contracts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { candidateBranch, coAuthoredBy, officialBranch, QUALIFIED_STATUS_CONTEXT } from "../src/index.js";
import {
  blobOidsAt,
  closePullRequest,
  commitChangeset,
  createBranchAt,
  createIssue,
  enableAutoMerge,
  openPullRequest,
  renderProvenanceSection,
  renderPullRequestBody,
  requestTeamReview,
  resetGithubAppConfig,
  setCommitStatus,
} from "../src/app/index.js";
import { canonicalJson, provenanceSha256 } from "@waronsaas/contracts/canonical";
import type { FakeGithub } from "./support/fake-github.js";
import { changeset, cleanup, git, makeApp, makeUpstream, upsert } from "./support/setup.js";

const REPO = "waronsaas/product";
const ATTEMPT = "0192ab3c-7d1e-7000-8000-00000000abcd";

let upstream: { dir: string; base: string };
let fake: FakeGithub;
let creds: ReturnType<typeof makeApp>["creds"];
let head: string;

beforeEach(async () => {
  upstream = makeUpstream({ "README.md": "# suite\n", "modules/contacts/list.ts": "x\n", "docs/a/b/c.md": "c\n" });
  ({ creds, fake } = makeApp());
  fake.importGitRepo(upstream.dir, REPO);
  const res = await commitChangeset(
    creds,
    REPO,
    candidateBranch(ATTEMPT),
    changeset(upstream.base, [upsert("modules/contacts/list.ts", "y\n")]),
    {
      author: { name: "waronsaas-wos[bot]", email: "1+waronsaas-wos[bot]@users.noreply.github.com" },
      message: "contacts#04: list",
      trailers: { "Co-authored-by": coAuthoredBy(4242, "octo-dev").slice("Co-authored-by: ".length) },
    },
    { createBranch: true, expectedHeadSha: null },
  );
  head = res.commitSha;
  await createBranchAt(creds, REPO, officialBranch("contacts#04", ATTEMPT), head);
});

afterEach(() => {
  cleanup(upstream.dir);
  resetGithubAppConfig();
});

const provenance = (): ProvenanceRecord => ({
  schema: "wos-provenance.v1",
  contractsVersion: "1.0.0",
  subject: { kind: "implementation", attemptId: ATTEMPT, abu: "contacts#04" },
  repo: REPO,
  prNumber: 1,
  headSha: head,
  baseSha: upstream.base,
  authors: [{ accountId: "0192ab3c-0000-7000-8000-0000000000aa", githubLogin: "octo-dev", role: "builder" }],
  agentRuns: [],
  reviews: [],
  ci: [{ checkSuiteId: 77, conclusion: "success", headSha: head }],
  qualifiedAt: new Date().toISOString(),
});

describe("openPullRequest", () => {
  it("provenance-and-merge R-001 opens the PR as the App with labels and the provenance record hash in the body", async () => {
    const body = renderPullRequestBody({
      objective: "List contacts.",
      qualification: [{ check: 1, title: "Lease valid | held", passed: true, evidence: "lease 0192" }],
      reviews: [
        {
          slot: "astra",
          reviewerLogin: "rev-a",
          model: "gpt-6-astra",
          reasoning: "xhigh",
          verdict: "NO_MATERIAL_GAPS",
          independence: "independent",
        },
      ],
    });
    const pr = await openPullRequest(creds, REPO, {
      head: officialBranch("contacts#04", ATTEMPT),
      base: "main",
      title: "contacts#04: Contact list endpoint",
      body,
      draft: false,
      labels: ["wos:implementation", "feature:contacts"],
      provenance: provenance(),
    });
    const stored = fake.pullsOf(REPO).find((p) => p.number === pr.number)!;
    expect(pr.url).toBe(`https://github.com/${REPO}/pull/${pr.number}`);
    expect(stored.labels).toEqual(["wos:implementation", "feature:contacts"]);
    expect(stored.maintainer_can_modify).toBe(false);
    expect(stored.body.startsWith("Opened by the warOnSaaS wOS GitHub App")).toBe(true);
    expect(stored.body).toContain("Lease valid \\| held");
    // The record in the body carries the real PR number and its JCS hash is printed.
    const expected = { ...provenance(), prNumber: pr.number, qualifiedAt: "" };
    const m = /```json\n(.*)\n```/.exec(stored.body)!;
    const inBody = JSON.parse(m[1]!) as ProvenanceRecord;
    expect(inBody.prNumber).toBe(pr.number);
    expect(canonicalJson(inBody)).toBe(m[1]);
    expect(stored.body).toContain(`Provenance record \`${provenanceSha256(inBody)}\``);
    expect({ ...inBody, qualifiedAt: "" }).toEqual(expected);
  });

  it("is idempotent: a retry returns the already open PR", async () => {
    const input = {
      head: officialBranch("contacts#04", ATTEMPT),
      base: "main",
      title: "t",
      body: "b",
      draft: false,
      labels: [],
      provenance: null,
    };
    const a = await openPullRequest(creds, REPO, input);
    const b = await openPullRequest(creds, REPO, input);
    expect(b.number).toBe(a.number);
    expect(fake.pullsOf(REPO)).toHaveLength(1);
  });

  it("refuses a caller body that fakes the provenance marker and multi-line titles", async () => {
    const base = { head: officialBranch("contacts#04", ATTEMPT), base: "main", draft: false, labels: [], provenance: null };
    await expect(openPullRequest(creds, REPO, { ...base, title: "t", body: "<!-- wos-provenance -->" })).rejects.toMatchObject({
      code: "INVALID_INPUT",
    });
    await expect(openPullRequest(creds, REPO, { ...base, title: "a\nb", body: "" })).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  it("renders the provenance hash deterministically regardless of key order", () => {
    const p = provenance();
    const reordered = Object.fromEntries(Object.entries(p).reverse()) as ProvenanceRecord;
    expect(renderProvenanceSection(p).sha256).toBe(renderProvenanceSection(reordered).sha256);
  });
});

describe("statuses, auto-merge, issues, close", () => {
  it("sets wos/qualified on the head sha, truncating long descriptions to GitHub's 140 characters", async () => {
    await setCommitStatus(creds, REPO, head, {
      context: QUALIFIED_STATUS_CONTEXT,
      state: "success",
      description: "q".repeat(200),
      targetUrl: "https://waronsaas.com/a",
    });
    expect(fake.statuses).toHaveLength(1);
    expect(fake.statuses[0]).toMatchObject({
      sha: head,
      state: "success",
      context: "wos/qualified",
      target_url: "https://waronsaas.com/a",
    });
    expect(fake.statuses[0]!.description).toHaveLength(140);
  });

  it("enables auto-merge; falls back to the merge queue when GitHub says the PR is already clean; already-enabled is a no-op", async () => {
    const input = {
      head: officialBranch("contacts#04", ATTEMPT),
      base: "main",
      title: "t",
      body: "b",
      draft: false,
      labels: [],
      provenance: null,
    };
    const pr = await openPullRequest(creds, REPO, input);
    await enableAutoMerge(creds, REPO, pr.number);
    const stored = fake.pullsOf(REPO)[0]!;
    expect(stored.auto_merge).toBe(true);
    const calls = fake.graphqlCalls.length;
    await enableAutoMerge(creds, REPO, pr.number);
    expect(fake.graphqlCalls.length).toBe(calls);

    stored.auto_merge = false;
    fake.autoMergeError = "Pull request Pull request is in clean status";
    await enableAutoMerge(creds, REPO, pr.number);
    expect(stored.enqueued).toBe(true);

    fake.autoMergeError = "Something else";
    stored.auto_merge = false;
    await expect(enableAutoMerge(creds, REPO, pr.number)).rejects.toMatchObject({ code: "GITHUB_ERROR" });
  });

  it("gated-pull-requests R-001 closes, comments on and locks a PR (the S-18 fallback for non-App PRs)", async () => {
    const input = {
      head: officialBranch("contacts#04", ATTEMPT),
      base: "main",
      title: "t",
      body: "b",
      draft: false,
      labels: [],
      provenance: null,
    };
    const pr = await openPullRequest(creds, REPO, input);
    await closePullRequest(creds, REPO, pr.number, {
      comment: "Only the warOnSaaS wOS App opens PRs here. Contribute through wOS.",
      lock: true,
    });
    const stored = fake.pullsOf(REPO)[0]!;
    expect(stored.state).toBe("closed");
    expect(stored.locked).toBe(true);
    expect(stored.comments[0]).toContain("warOnSaaS wOS");
  });

  it("requests a team review on a toolchain PR (contracts 3.1.0, added by the integrator)", async () => {
    const input = {
      head: officialBranch("contacts#04", ATTEMPT),
      base: "main",
      title: "t",
      body: "b",
      draft: false,
      labels: [],
      provenance: null,
    };
    const pr = await openPullRequest(creds, REPO, input);
    await requestTeamReview(creds, REPO, pr.number, "maintainers");
    expect(fake.teamReviewRequests).toEqual([{ repo: REPO, number: pr.number, teams: ["maintainers"] }]);
    await expect(requestTeamReview(creds, REPO, 999, "maintainers")).rejects.toMatchObject({ code: "GITHUB_ERROR", status: 404 });
  });

  it("creates an issue with labels", async () => {
    const issue = await createIssue(creds, REPO, { title: "Blocker: contacts#04", body: "details", labels: ["wos:blocker"] });
    expect(issue.url).toBe(`https://github.com/${REPO}/issues/${issue.number}`);
    expect(fake.issues[0]).toMatchObject({ title: "Blocker: contacts#04", labels: ["wos:blocker"] });
  });
});

describe("blobOidsAt", () => {
  const expectOids = async () => {
    const got = await blobOidsAt(creds, REPO, upstream.base, ["README.md", "docs/a/b/c.md", "docs/a", "missing.txt"]);
    expect(got.get("README.md")).toBe(git(upstream.dir, "rev-parse", `${upstream.base}:README.md`));
    expect(got.get("docs/a/b/c.md")).toBe(git(upstream.dir, "rev-parse", `${upstream.base}:docs/a/b/c.md`));
    expect(got.get("docs/a")).toBeNull();
    expect(got.get("missing.txt")).toBeNull();
  };

  it("returns git blob oids at a commit, null for missing paths and directories", expectOids);

  it("walks directories when the recursive listing is truncated", async () => {
    fake.truncateTrees = true;
    await expectOids();
  });
});
