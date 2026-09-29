/**
 * DONE (4) against the REAL control plane: services/control-plane's routes, Postgres (migrated scratch
 * database), the real eligibility, manifest check and scope validator, driven by the REAL orchestrator
 * with the real context-engine and agent-policy. Runs only when WOS_TEST_DATABASE_URL is set (like the
 * control-plane suite); GitHub is the control plane's FakeGithub, glued so candidate commits are real git
 * commits in a local upstream the orchestrator's worktrees fetch from.
 *
 * Reviews: the other contributors' review runs use control-plane's flow helper (reviewAs), not
 * orchestrator.review(), because a reviewer client cannot learn the round's submissionSha256 from any
 * contract field (blockers/B-0008-github-build.md). CI and merge arrive as signed webhooks.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { Changeset, OrchestratorEvent } from "@waronsaas/contracts";
import { configureLocalGit } from "@waronsaas/github/local";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { reviewAs } from "../../../services/control-plane/test/support/flow.js";
import {
  CRON_SECRET,
  createHarness,
  HAS_DB,
  type Harness,
  seedFeature,
  verdict,
  webhookHeaders,
} from "../../../services/control-plane/test/support/harness.js";
import { createOrchestrator } from "../src/index.js";
import { SESSION_KEY } from "../src/session.js";
import { ABU_SPEC, BUILD_GRAPH, git, WOS_JSON } from "./support/fake-control-plane.js";
import { FakeProcesses, MemorySecrets, testEngines } from "./support/harness.js";

const REPO = "waronsaas/product";

describe.skipIf(!HAS_DB)("orchestrator against the real control plane (Postgres)", () => {
  let h: Harness;
  let upstream: string;
  let root: string;

  beforeAll(async () => {
    h = await createHarness();
    upstream = mkdtempSync(join(tmpdir(), "wos-e2e-upstream-"));
    root = mkdtempSync(join(tmpdir(), "wos-e2e-ws-"));
    git(upstream, "init", "-q", "-b", "main");
    git(upstream, "config", "uploadpack.allowAnySHA1InWant", "true");
    const files: Record<string, string> = {
      "wos.json": `${JSON.stringify(WOS_JSON, null, 2)}\n`,
      "features/contacts/BUILD-GRAPH.yaml": `${JSON.stringify(BUILD_GRAPH, null, 2)}\n`,
      "features/contacts/CONTRACT.yaml": "schema: wos-feature-contract.v1\nkey: contacts\n",
      "modules/contacts/list.ts": "export const list = () => [];\n",
    };
    for (const [p, c] of Object.entries(files)) {
      mkdirSync(dirname(join(upstream, p)), { recursive: true });
      writeFileSync(join(upstream, p), c);
    }
    git(upstream, "add", "-A");
    git(upstream, "commit", "-q", "-m", "base");
    const base = git(upstream, "rev-parse", "HEAD");
    // The control plane's fake GitHub serves the same repository state the worktrees check out.
    h.github.heads.set(REPO, base);
    for (const [p, c] of Object.entries(files)) h.github.putFile(REPO, base, p, c);
    // Glue: candidate commits become real commits in the upstream, so reviewers and revisions can fetch them.
    const original = h.github.commitChangeset.bind(h.github);
    h.github.commitChangeset = async (repo, branch, cs: Changeset, identity) => {
      const work = mkdtempSync(join(tmpdir(), "wos-e2e-cand-"));
      try {
        git(work, "init", "-q");
        git(work, "fetch", "-q", upstream, cs.parentCommit);
        git(work, "checkout", "-q", "--detach", cs.parentCommit);
        for (const f of cs.files) {
          if (f.op === "delete") git(work, "rm", "-q", f.path);
          else {
            mkdirSync(dirname(join(work, f.path)), { recursive: true });
            writeFileSync(join(work, f.path), Buffer.from(f.contentBase64, "base64"));
          }
        }
        git(work, "add", "-A");
        git(work, "commit", "-q", "-m", identity.message);
        const sha = git(work, "rev-parse", "HEAD");
        execFileSync("git", ["push", "-q", "-f", upstream, `HEAD:refs/heads/${branch}`], { cwd: work });
        const res = await original(repo, branch, cs, identity);
        // Re-key the fake's bookkeeping from its synthetic sha to the real one.
        const rec = h.github.commits.at(-1)!;
        for (const [k, v] of [...h.github.files]) {
          if (k.startsWith(`${repo}@${res.commitSha}:`)) h.github.files.set(k.replace(res.commitSha, sha), v);
        }
        rec.sha = sha;
        return { commitSha: sha, treeSha: git(work, "rev-parse", "HEAD^{tree}") };
      } finally {
        rmSync(work, { recursive: true, force: true });
      }
    };
    configureLocalGit({ remoteUrl: () => upstream });
  });

  afterAll(async () => {
    configureLocalGit({});
    await h?.close();
    if (upstream) rmSync(upstream, { recursive: true, force: true });
    if (root) rmSync(root, { recursive: true, force: true });
  });

  it("local-orchestrator signs in, links GitHub, attests, builds, is reviewed, qualifies, opens the PR and merges", async () => {
    const seeded = await seedFeature(h.owner, { abus: [{ n: "04", write: [...ABU_SPEC.scope.write] }] });
    const astra = await h.contributor("rev-astra");
    const fable = await h.contributor("rev-fable");
    const secrets = new MemorySecrets();
    const processes = new FakeProcesses();
    const idle: Array<() => Promise<void>> = [];
    const orchestrator = createOrchestrator({
      apiBaseUrl: "https://api.waronsaas.com",
      workspaceRoot: root,
      secrets,
      processes,
      fetch: ((input: string | URL | Request, init?: RequestInit) => {
        const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
        const headers = new Headers(init?.headers);
        headers.set("x-forwarded-for", "10.9.9.9");
        return h.app.request(`${url.pathname}${url.search}`, { ...init, headers });
      }) as typeof fetch,
      clientKind: "cli",
      clientVersion: "0.0.0-e2e",
      engines: testEngines,
      platform: "linux",
      pollIntervalMs: 0,
      sleep: async () => {
        for (const f of idle) await f();
      },
      baseEnv: { PATH: "/usr/bin:/bin" },
    });

    // D8: email sign-in with the code from the (fake) mail, then the brokered GitHub device flow.
    const email = "builder@example.com";
    const events: OrchestratorEvent[] = [];
    const me = await orchestrator.signIn({ email, deviceName: "e2e" }, { code: async () => h.mailer.lastTo(email).code }, (e) =>
      events.push(e),
    );
    expect(me.email).toBe(email);
    expect(JSON.parse((await secrets.get(SESSION_KEY))!).deviceId).toMatch(/^[0-9a-f-]{36}$/);
    const grant = async () => {
      const rows = await h.owner<{ device_code: string }[]>`
        select r.device_code from wos.github_link_requests r join wos.accounts a on a.id = r.account_id
         join wos.account_emails e on e.account_id = a.id where e.email = ${email} order by r.created_at desc limit 1`;
      if (rows[0])
        h.github.deviceGrants.set(rows[0].device_code, {
          status: "ok",
          user: { userId: 777001, login: "e2e-builder", createdAt: new Date(Date.now() - 400 * 86_400_000).toISOString(), avatarUrl: null },
        });
    };
    idle.push(grant);
    const linked = await orchestrator.linkGithub(
      (e) => events.push(e),
      () => undefined,
    );
    idle.length = 0;
    expect(linked.github?.login).toBe("e2e-builder");

    // wos status posts the provider and toolchain attestations the claim's eligibility check reads.
    const status = await orchestrator.status();
    expect(status.signedIn).toBe(true);
    const [att] = await h.owner<{ n: number }[]>`select count(*)::int as n from wos.provider_attestations`;
    expect(att!.n).toBeGreaterThan(0);

    // Server-side progress while the builder's orchestrator waits: CI, the two reviews, PR dispatch, merge.
    let prNumber: number | null = null;
    idle.push(async () => {
      const [a] = await h.owner<{ id: string; state: string; head_sha: string | null }[]>`
        select id, state, head_sha from wos.attempts where abu_id = ${seeded.abus.get("04")!}`;
      if (!a) return;
      if (a.state === "candidate_pushed") {
        const suite = {
          action: "completed",
          repository: { full_name: REPO },
          check_suite: { id: 4242, head_sha: a.head_sha, conclusion: "success", app: { slug: "github-actions" } },
        };
        await h.call("POST", "/v1/github/webhook", { body: suite, headers: webhookHeaders("check_suite", suite) });
      } else if (a.state === "in_review") {
        await reviewAs(h, astra, "astra", "implementation_review", verdict("NO_MATERIAL_GAPS"));
        await reviewAs(h, fable, "fable", "implementation_review", verdict("NO_MATERIAL_GAPS"));
      } else if (a.state === "qualified") {
        await h.call("GET", "/v1/cron/dispatch", { headers: { authorization: `Bearer ${CRON_SECRET}` } });
      } else if (a.state === "pr_open") {
        prNumber = h.github.prs.at(-1)!.number;
        const merged = {
          action: "closed",
          repository: { full_name: REPO },
          pull_request: { number: prNumber, merged: true, merge_commit_sha: "f".repeat(40), user: { login: "waronsaas-wos[bot]" } },
        };
        await h.call("POST", "/v1/github/webhook", { body: merged, headers: webhookHeaders("pull_request", merged) });
      }
    });

    const res = await orchestrator.build({ abu: seeded.abus.get("04")! }, (e) => events.push(e));
    expect(res, JSON.stringify(res)).toMatchObject({ ok: true });
    const states: string[] = [];
    for (const e of events) if (e.type === "attempt" && states.at(-1) !== e.attempt.state) states.push(e.attempt.state);
    expect(states).toEqual(["leased", "verifying", "candidate_pushed", "in_review", "qualified", "pr_open", "merged"]);
    const [abu] = await h.owner<{ state: string }[]>`select state from wos.abus where id = ${seeded.abus.get("04")!}`;
    expect(abu!.state).toBe("merged");
    // The PR was opened by the App from the official branch at the exact candidate commit the builder produced.
    const pr = h.github.prs.at(-1)!;
    expect(pr.number).toBe(prNumber);
    const cand = h.github.commits.at(-1)!;
    expect(h.github.branches.get(`${REPO}:${pr.head}`)).toBe(cand.sha);
    expect(git(upstream, "show", `${cand.sha}:modules/contacts/list.ts`)).toContain("v1");
    // The real manifest check accepted the real context engine's manifest; the signed records verified.
    const [run] = await h.owner<{ signature_valid: boolean }[]>`
      select signature_valid from wos.agent_runs r join wos.leases l on l.id = r.lease_id join wos.tasks t on t.id = l.task_id
       where t.abu_id = ${seeded.abus.get("04")!} and t.kind = 'abu_build'`;
    expect(run!.signature_valid).toBe(true);
    expect(h.violations).toEqual([]);
  }, 60_000);
});
