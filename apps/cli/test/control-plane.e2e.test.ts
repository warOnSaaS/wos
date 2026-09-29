/**
 * WORKSTREAMS 11.1 DONE: `wos build` and `wos review` against the REAL control plane harness
 * (services/control-plane routes, a migrated scratch Postgres, the real eligibility, manifest check and
 * scope validator), through the real orchestrator, with the orchestrator's fake agent CLIs. Every step
 * a contributor takes goes through runCli: login (code typed on stdin), link-github, status, build, and
 * two reviewers' `wos review --slot`. Runs only when WOS_TEST_DATABASE_URL is set.
 * Setup mirrors packages/orchestrator/test/control-plane.e2e.test.ts.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { Changeset, Orchestrator } from "@waronsaas/contracts";
import { configureLocalGit } from "@waronsaas/github/local";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createOrchestrator } from "../../../packages/orchestrator/src/index.js";
import { ABU_SPEC, BUILD_GRAPH, git, WOS_JSON } from "../../../packages/orchestrator/test/support/fake-control-plane.js";
import { FakeProcesses, MemorySecrets, testEngines } from "../../../packages/orchestrator/test/support/harness.js";
import {
  CRON_SECRET,
  createHarness,
  HAS_DB,
  type Harness,
  seedFeature,
  webhookHeaders,
} from "../../../services/control-plane/test/support/harness.js";
import { wos } from "./support.js";

const REPO = "waronsaas/product";

describe.skipIf(!HAS_DB)("wos against the real control plane (Postgres)", () => {
  let h: Harness;
  let upstream: string;
  const roots: string[] = [];

  beforeAll(async () => {
    h = await createHarness();
    upstream = mkdtempSync(join(tmpdir(), "wos-cli-e2e-upstream-"));
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
    h.github.heads.set(REPO, base);
    for (const [p, c] of Object.entries(files)) h.github.putFile(REPO, base, p, c);
    // Candidate commits become real commits in the upstream so reviewers can fetch them.
    const original = h.github.commitChangeset.bind(h.github);
    h.github.commitChangeset = async (repo, branch, cs: Changeset, identity) => {
      const work = mkdtempSync(join(tmpdir(), "wos-cli-e2e-cand-"));
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
    for (const r of roots) rmSync(r, { recursive: true, force: true });
  });

  /** One contributor machine: its own keychain, workspace and agent CLIs; `idle` runs while it waits. */
  const machine = (who: string) => {
    const root = mkdtempSync(join(tmpdir(), `wos-cli-e2e-${who}-`));
    roots.push(root);
    const idle: Array<() => Promise<void>> = [];
    const orchestrator: Orchestrator = createOrchestrator({
      apiBaseUrl: "https://api.waronsaas.com",
      workspaceRoot: root,
      secrets: new MemorySecrets(),
      processes: new FakeProcesses(),
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
    const email = `${who}@example.com`;
    const run = (argv: string[], answer?: (q: string) => string | null) => wos(() => orchestrator, argv, { answer });
    return { root, idle, email, run, orchestrator };
  };

  /** `wos login <email>`, typing the code the control plane mailed when prompted. */
  async function signIn(m: ReturnType<typeof machine>) {
    const r = await m.run(["login", m.email], () => h.mailer.lastTo(m.email).code);
    expect(r.code, r.err).toBe(0);
    expect(r.out).toContain(`sign-in  redeemed signed in as ${m.email}`);
    return r;
  }

  it("wos login, link-github, status, build; two reviewers run wos review; the PR opens and merges", async () => {
    const seeded = await seedFeature(h.owner, { abus: [{ n: "04", write: [...ABU_SPEC.scope.write] }] });
    await h.contributor("rev-astra");
    await h.contributor("rev-fable");

    const reviewers = { astra: machine("rev-astra"), fable: machine("rev-fable") };
    for (const m of Object.values(reviewers)) {
      await signIn(m);
      expect((await m.run(["status"])).code).toBe(0);
    }

    const builder = machine("builder");
    await signIn(builder);

    // GitHub device flow: the fake GitHub grants the code once the link request exists.
    builder.idle.push(async () => {
      const rows = await h.owner<{ device_code: string }[]>`
        select r.device_code from wos.github_link_requests r join wos.accounts a on a.id = r.account_id
         join wos.account_emails e on e.account_id = a.id where e.email = ${builder.email} order by r.created_at desc limit 1`;
      if (rows[0])
        h.github.deviceGrants.set(rows[0].device_code, {
          status: "ok",
          user: { userId: 777002, login: "cli-builder", createdAt: new Date(Date.now() - 400 * 86_400_000).toISOString(), avatarUrl: null },
        });
    });
    const link = await builder.run(["link-github"]);
    expect(link.code, link.err).toBe(0);
    expect(link.out).toMatch(/^open {5}\S+\nenter {4}\S+$/m);
    expect(link.out).toContain("github   linked");
    builder.idle.length = 0;

    const status = await builder.run(["status"]);
    expect(status.code, status.err).toBe(0);
    expect(status.out).toContain("github cli-builder");
    expect(status.out).toContain("(attested)");

    // Server-side progress while `wos build` waits: CI webhook, the two `wos review` runs, PR dispatch, merge.
    const reviewOutputs: string[] = [];
    builder.idle.push(async () => {
      const [a] = await h.owner<{ state: string; head_sha: string | null }[]>`
        select state, head_sha from wos.attempts where abu_id = ${seeded.abus.get("04")!}`;
      if (!a) return;
      if (a.state === "candidate_pushed") {
        const suite = {
          action: "completed",
          repository: { full_name: REPO },
          check_suite: { id: 4242, head_sha: a.head_sha, conclusion: "success", app: { slug: "github-actions" } },
        };
        await h.call("POST", "/v1/github/webhook", { body: suite, headers: webhookHeaders("check_suite", suite) });
      } else if (a.state === "in_review") {
        for (const slot of ["astra", "fable"] as const) {
          const r = await reviewers[slot].run(["review", "--slot", slot, "--kind", "implementation_review"]);
          expect(r.code, r.err + r.out).toBe(0);
          reviewOutputs.push(r.out);
        }
      } else if (a.state === "qualified") {
        await h.call("GET", "/v1/cron/dispatch", { headers: { authorization: `Bearer ${CRON_SECRET}` } });
      } else if (a.state === "pr_open") {
        const merged = {
          action: "closed",
          repository: { full_name: REPO },
          pull_request: {
            number: h.github.prs.at(-1)!.number,
            merged: true,
            merge_commit_sha: "f".repeat(40),
            user: { login: "waronsaas-wos[bot]" },
          },
        };
        await h.call("POST", "/v1/github/webhook", { body: merged, headers: webhookHeaders("pull_request", merged) });
      }
    });

    const build = await builder.run(["build", seeded.abus.get("04")!]);
    expect(build.code, build.err + build.out).toBe(0);
    const states = [...build.out.matchAll(/^attempt +(\S+) /gm)].map((m) => m[1]);
    expect(states).toEqual(["leased", "verifying", "candidate_pushed", "in_review", "qualified", "pr_open", "merged"]);
    expect(build.out).toMatch(/^result {3}ok {7}.*attempt merged \| PR #\d+ /m);
    expect(reviewOutputs).toHaveLength(2);
    expect(reviewOutputs[0]).toContain("implementation_reviewer_astra on gpt-6-astra");
    expect(reviewOutputs[1]).toContain("implementation_reviewer_fable on claude-fable-5-1");
    for (const out of reviewOutputs) expect(out).toMatch(/^result {3}ok {7}implementation_review /m);

    const [abu] = await h.owner<{ state: string }[]>`select state from wos.abus where id = ${seeded.abus.get("04")!}`;
    expect(abu!.state).toBe("merged");
    const reviews = await h.owner<{ slot: string; provider: string }[]>`
      select r.slot, r.provider from wos.reviews r join wos.rounds o on o.id = r.round_id join wos.attempts a on a.id = o.attempt_id
       where a.abu_id = ${seeded.abus.get("04")!} order by r.slot`;
    expect(reviews).toEqual([
      { slot: "astra", provider: "codex_cli" },
      { slot: "fable", provider: "claude_cli" },
    ]);

    // Read commands against the real routes.
    const work = await builder.run(["work", "--json"]);
    expect(work.code, work.err).toBe(0);
    // My work lists what is still in flight; the merged attempt is done.
    expect(JSON.parse(work.out)).toMatchObject({ type: "result", leases: expect.any(Array), attempts: expect.any(Array) });
    const events = await builder.run(["events"]);
    expect(events.code, events.err).toBe(0);
    expect(events.out).toContain("attempt.created");

    // wos logout revokes the session: the next authenticated command exits 3.
    expect((await builder.run(["logout"])).code).toBe(0);
    expect((await builder.run(["work"])).code).toBe(3);
    expect(h.violations).toEqual([]);
  }, 180_000);
});
