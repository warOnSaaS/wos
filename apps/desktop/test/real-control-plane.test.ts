/**
 * WORKSTREAMS 11.2 DONE: "the BUILD flow against the real control plane harness through the main
 * process". DesktopCore (the Desktop's main-process code) drives the REAL orchestrator against the REAL
 * control plane (routes, Postgres, eligibility, manifest check, scope validator) with the control plane's
 * fake GitHub and fake agent CLIs — the same harness as packages/orchestrator/test/control-plane.e2e.test.ts.
 * Runs only when WOS_TEST_DATABASE_URL is set.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { readFileSync } from "node:fs";
import { AGENT_POLICY_V1, type AbuSummary, type Changeset, type Me, type OrgApps, type TargetDetail } from "@waronsaas/contracts";
import { configureLocalGit } from "@waronsaas/github/local";
import { createApiClient, createOrchestrator, createSessionReader } from "@waronsaas/orchestrator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BUILD_GRAPH, git, WOS_JSON } from "../../../packages/orchestrator/test/support/fake-control-plane.js";
import {
  CRON_SECRET,
  createHarness,
  HAS_DB,
  type Harness,
  seedFeature,
  webhookHeaders,
} from "../../../services/control-plane/test/support/harness.js";
import { DemoProcesses } from "../dev/demo-processes.js";
import { MemorySecrets } from "../dev/fake-backend.js";
import { createDesktopCore, type DesktopCore } from "../src/main/core.js";
import { createEnvironmentManager } from "../src/main/environment.js";
import { createModuleInstaller } from "../src/main/module-installer.js";
import { createPlatformApi } from "../src/main/platform-api.js";
import { createPublicApi } from "../src/main/public-api.js";
import { defaultSettings, memorySettingsStore } from "../src/main/settings.js";
import type { BuilderModelChoice, DesktopEvent, RunSnapshot } from "../src/shared/ipc.js";
import { APP_INFO, until } from "./support.js";

const REPO = "waronsaas/product";
const API = "https://api.waronsaas.com";

describe.skipIf(!HAS_DB)("wOS Desktop main process against the real control plane (Postgres)", () => {
  let h: Harness;
  let upstream: string;
  const roots: string[] = [];

  beforeAll(async () => {
    h = await createHarness();
    upstream = mkdtempSync(join(tmpdir(), "wos-desktop-e2e-upstream-"));
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
    // Same glue as the orchestrator e2e: candidate commits become real commits in the upstream.
    const original = h.github.commitChangeset.bind(h.github);
    h.github.commitChangeset = async (repo, branch, cs: Changeset, identity) => {
      const work = mkdtempSync(join(tmpdir(), "wos-desktop-e2e-cand-"));
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

  const fetchVia = (() =>
    ((input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
      const headers = new Headers(init?.headers);
      headers.set("x-forwarded-for", "10.9.9.9");
      return h.app.request(`${url.pathname}${url.search}`, { ...init, headers });
    }) as typeof fetch)();

  function machine(idle: Array<() => Promise<void>>, secrets = new MemorySecrets()) {
    const root = mkdtempSync(join(tmpdir(), "wos-desktop-e2e-ws-"));
    roots.push(root);
    return createOrchestrator({
      apiBaseUrl: API,
      workspaceRoot: root,
      secrets,
      processes: new DemoProcesses("linux"),
      fetch: fetchVia,
      clientKind: "desktop",
      clientVersion: "0.0.0-e2e",
      platform: "linux",
      pollIntervalMs: 0,
      sleep: async () => {
        for (const f of idle) await f();
      },
      baseEnv: { PATH: "/usr/bin:/bin" },
    });
  }

  it("sign in -> link GitHub -> Salesforce -> CRM -> contacts -> claimable ABU -> OPUS -> BUILD -> reviewed, PR, merged", async () => {
    const seeded = await seedFeature(h.owner, { abus: [{ n: "04", write: ["modules/contacts/**"] }] });
    // Two reviewers on their own machines (D2).
    const reviewer = async (who: string) => {
      const o = machine([]);
      const mail = `${who}@example.com`;
      await h.contributor(who);
      await o.signIn({ email: mail, deviceName: who }, { code: async () => h.mailer.lastTo(mail).code }, () => undefined);
      await o.status();
      return o;
    };
    const astra = await reviewer("dt-rev-astra");
    const fable = await reviewer("dt-rev-fable");

    // Build's registry release (bundled in Desktop, no package), published by a maintainer as in production.
    const maint = await h.contributor("dt-maintainer", { maintainer: true });
    const buildManifest = JSON.parse(readFileSync(join(import.meta.dirname, "../src/apps/build/wos-app.json"), "utf8"));
    const published = await h.call("POST", "/v1/admin/app-releases", {
      token: maint.token,
      idem: true,
      body: {
        manifest: buildManifest,
        desktopPackage: null,
        desktopPackageUrl: null,
        source: { repo: "waronsaas/wos", tag: "build@0.1.0", commit: "a".repeat(40) },
      },
    });
    expect(published.status, JSON.stringify(published.body)).toBe(200);

    const idle: Array<() => Promise<void>> = [];
    const events: DesktopEvent[] = [];
    const settings = memorySettingsStore({ ...defaultSettings("desktop-e2e"), buildOnDevice: true });
    settings.set({ detachAfterSubmit: false });
    const secrets = new MemorySecrets();
    const refreshClient = createApiClient({
      baseUrl: API,
      fetch: fetchVia,
      clientKind: "desktop",
      clientVersion: "0.0.0-e2e",
      accessToken: async () => null,
    });
    const session = createSessionReader({
      secrets,
      refresh: (refreshToken) => refreshClient.call("refreshSession", { body: { refreshToken } }),
    });
    const platform = createPlatformApi({ baseUrl: API, fetch: fetchVia, session, clientVersion: "0.0.0-e2e" });
    const modulesDir = mkdtempSync(join(tmpdir(), "wos-desktop-e2e-modules-"));
    roots.push(modulesDir);
    const gate: boolean[] = [];
    const core: DesktopCore = createDesktopCore({
      orchestrator: machine(idle, secrets),
      publicApi: createPublicApi(fetchVia, API, "0.0.0-e2e"),
      platform,
      // No hosted Core in this harness: the environment reports itself unreachable, and Build does not need it.
      environment: createEnvironmentManager("https://core.waronsaas.com", {
        fetch: fetchVia,
        secrets,
        platform,
        cloudCoreUrl: "https://core.waronsaas.com",
        cloudIssuer: API,
        clientVersion: "0.0.0-e2e",
      }),
      cloudCoreUrl: "https://core.waronsaas.com",
      installer: createModuleInstaller({ root: modulesDir, platform: "linux", pinnedKeys: {}, registry: platform }),
      onBuildGate: (open) => gate.push(open),
      settings,
      policy: AGENT_POLICY_V1,
      appInfo: { ...APP_INFO, fakeControlPlane: false, apiBaseUrl: API },
      emit: (e) => events.push(e),
      openExternal: async () => undefined,
    });

    // D8 sign-in: the renderer submits the code from the (fake) mail.
    const email = "desktop-builder@example.com";
    const pending = core.invoke("wos:sign-in", { email });
    await until(() => events.some((e) => e.kind === "orchestrator" && e.event.type === "sign_in" && e.event.status === "waiting_for_code"));
    await core.invoke("wos:sign-in-code", { code: h.mailer.lastTo(email).code });
    expect(((await pending) as Me).email).toBe(email);

    // S-40 against the real AppRoutes. The harness enables Build on every new personal org (as for accounts from before
    // migration 0006), so the gate opened at sign-in. Disabling Build from Desktop closes it and Build is refused;
    // enabling it again from Desktop (V1 proof step 2, for Build) reopens it.
    expect(gate).toEqual([true]);
    const personal = core.shellState().organizations.find((o) => o.kind === "personal")!;
    expect(personal.role).toBe("owner");
    const before = (await core.invoke("wos:org-apps", { organizationId: personal.id })) as OrgApps;
    const buildRow = before.yourApps.find((a) => a.app.id === "build")!;
    expect(buildRow.entitlement.state).toBe("enabled");
    const off = (await core.invoke("wos:disable-app", {
      organizationId: personal.id,
      app: "build",
      expectedRowVersion: buildRow.entitlement.rowVersion,
    })) as OrgApps["yourApps"][number];
    expect(gate).toEqual([true, false]);
    await expect(core.invoke("wos:list-targets", undefined)).rejects.toMatchObject({ code: "NOT_ENTITLED" });
    expect(core.shellState().build.reason).toMatch(/NOT ENABLED/);
    await core.invoke("wos:enable-app", { organizationId: personal.id, app: "build", expectedRowVersion: off.entitlement.rowVersion });
    expect(gate).toEqual([true, false, true]);
    expect(core.shellState().navigation.map((n) => n.id)).toEqual(["build.targets", "build.work", "build.contributions"]);

    // GitHub device flow, granted by the fake GitHub while the orchestrator polls.
    idle.push(async () => {
      const rows = await h.owner<{ device_code: string }[]>`
        select r.device_code from wos.github_link_requests r join wos.accounts a on a.id = r.account_id
         join wos.account_emails e on e.account_id = a.id where e.email = ${email} order by r.created_at desc limit 1`;
      if (rows[0])
        h.github.deviceGrants.set(rows[0].device_code, {
          status: "ok",
          user: {
            userId: 778001,
            login: "desktop-builder",
            createdAt: new Date(Date.now() - 400 * 86_400_000).toISOString(),
            avatarUrl: null,
          },
        });
    });
    const linked = (await core.invoke("wos:link-github", undefined)) as Me;
    idle.length = 0;
    expect(linked.github?.login).toBe("desktop-builder");
    expect(events.some((e) => e.kind === "github_code")).toBe(true);

    // The public drilldown from the real API, then the authenticated claimable list and the model picker.
    const sf = (await core.invoke("wos:get-target", { slug: "salesforce" })) as TargetDetail;
    expect(sf.capabilities.map((c) => c.key)).toContain("crm");
    const abus = (await core.invoke("wos:list-claimable-abus", { slug: "salesforce", feature: "contacts" })) as AbuSummary[];
    const abu = abus.find((a) => a.key === "contacts#04")!;
    expect(abu.claimable).toBe(true);
    const models = (await core.invoke("wos:builder-models", undefined)) as BuilderModelChoice[];
    expect(models.find((m) => m.isDefault)?.ref).toBe("opus");

    // Server-side progress while the build waits: CI, the two reviews, PR dispatch, merge.
    idle.push(async () => {
      const [a] = await h.owner<{ state: string; head_sha: string | null }[]>`
        select state, head_sha from wos.attempts where abu_id = ${seeded.abus.get("04")!}`;
      if (!a) return;
      if (a.state === "candidate_pushed") {
        const suite = {
          action: "completed",
          repository: { full_name: REPO },
          check_suite: { id: 4343, head_sha: a.head_sha, conclusion: "success", app: { slug: "github-actions" } },
        };
        await h.call("POST", "/v1/github/webhook", { body: suite, headers: webhookHeaders("check_suite", suite) });
      } else if (a.state === "in_review") {
        await astra.review({ slot: "astra", kinds: ["implementation_review"] }, () => undefined);
        await fable.review({ slot: "fable", kinds: ["implementation_review"] }, () => undefined);
      } else if (a.state === "qualified") {
        await h.call("GET", "/v1/cron/dispatch", { headers: { authorization: `Bearer ${CRON_SECRET}` } });
      } else if (a.state === "pr_open") {
        const pr = h.github.prs.at(-1)!;
        const merged = {
          action: "closed",
          repository: { full_name: REPO },
          pull_request: { number: pr.number, merged: true, merge_commit_sha: "e".repeat(40), user: { login: "waronsaas-wos[bot]" } },
        };
        await h.call("POST", "/v1/github/webhook", { body: merged, headers: webhookHeaders("pull_request", merged) });
      }
    });

    const { runId } = (await core.invoke("wos:build", { abu: abu.id, model: "opus" })) as { runId: string };
    await core.settle();
    const run = ((await core.invoke("wos:runs", undefined)) as RunSnapshot[]).find((r) => r.id === runId)!;
    expect(run.state, run.explanation ?? "").toBe("passed");
    const states: string[] = [];
    for (const e of run.events) if (e.type === "attempt" && states.at(-1) !== e.attempt.state) states.push(e.attempt.state);
    expect(states).toEqual(["leased", "verifying", "candidate_pushed", "in_review", "qualified", "pr_open", "merged"]);
    const [row] = await h.owner<{ state: string }[]>`select state from wos.abus where id = ${seeded.abus.get("04")!}`;
    expect(row!.state).toBe("merged");
    expect(h.violations).toEqual([]);
  }, 180_000);
});
