/**
 * DONE (2): every route in `Routes` exists, validates its input with its zod schema, returns its response
 * schema, and rejects the wrong auth mode.
 */
import { createHmac } from "node:crypto";
import { type RouteDef, type RouteName, Routes } from "@waronsaas/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp, type Handler, type Handlers } from "../src/http/router.js";
import { createHandlers } from "../src/app.js";
import { buildAndSubmit, reviewAs } from "./support/flow.js";
import {
  type Account,
  CRON_SECRET,
  createHarness,
  HAS_DB,
  type Harness,
  seedFeature,
  verdict,
  WEBHOOK_SECRET,
  webhookHeaders,
} from "./support/harness.js";

const NAMES = Object.keys(Routes) as RouteName[];
const UUID = "0192f000-0000-7000-8000-0000000000aa";

/** A concrete, schema-valid path for a route. */
function samplePath(route: RouteDef): string {
  return route.path.replace(":id", UUID).replace(":slug", "salesforce").replace(":feature", "contacts").replace(":handle", "someone");
}

function routeOf(method: string, path: string): RouteName | null {
  const bare = path.split("?")[0]!;
  for (const name of NAMES) {
    const r = Routes[name] as RouteDef;
    if (r.method !== method) continue;
    const re = new RegExp(`^${r.path.replace(/:[a-z]+/g, "[^/]+")}$`);
    if (re.test(bare)) return name;
  }
  return null;
}

describe("the handler table covers the contract", () => {
  it("has a handler for every route and no extra ones", () => {
    expect(Object.keys(createHandlers()).sort()).toEqual([...NAMES].sort());
  });
});

describe.skipIf(!HAS_DB)("every route: existence, auth mode, input validation, response schema", () => {
  let h: Harness;
  let plain: Account; // signed in, no GitHub
  let contributor: Account; // GitHub linked, not maintainer
  const seen = new Map<RouteName, number>();

  beforeAll(async () => {
    h = await createHarness();
    plain = await h.signIn("plain@example.com");
    contributor = await h.contributor("contract-contrib");
  });
  afterAll(async () => {
    await h?.close();
  });

  const send = (route: RouteDef, opts: { token?: string; body?: unknown; headers?: Record<string, string>; query?: string } = {}) =>
    h.call(route.method, `${samplePath(route)}${opts.query ?? ""}`, {
      token: opts.token,
      body: route.method === "GET" ? undefined : (opts.body ?? {}),
      headers: opts.headers,
      idem: route.idempotent,
    });

  it.each(NAMES)("%s exists and rejects the wrong auth mode", async (name) => {
    const route = Routes[name] as RouteDef;
    const anon = await send(route);
    expect(anon.body?.error?.message).not.toBe("no such route");
    switch (route.auth) {
      case "public":
        expect(anon.status).not.toBe(401);
        break;
      case "account":
        expect(anon.status).toBe(401);
        expect(anon.body.error.code).toBe("UNAUTHENTICATED");
        expect((await send(route, { token: "wos_at_forged" })).status).toBe(401);
        break;
      case "contributor": {
        expect(anon.body.error.code).toBe("UNAUTHENTICATED");
        const noGithub = await send(route, { token: plain.token });
        expect(noGithub.status).toBe(403);
        expect(noGithub.body.error.code).toBe("GITHUB_REQUIRED");
        break;
      }
      case "maintainer": {
        expect(anon.body.error.code).toBe("UNAUTHENTICATED");
        const notMaintainer = await send(route, { token: contributor.token });
        expect(notMaintainer.status).toBe(403);
        expect(notMaintainer.body.error.code).toBe("FORBIDDEN");
        break;
      }
      case "github_webhook": {
        expect(anon.status).toBe(403);
        const forged = await send(route, {
          headers: { "x-hub-signature-256": `sha256=${"0".repeat(64)}`, "x-github-event": "ping", "x-github-delivery": UUID },
        });
        expect(forged.body.error.code).toBe("FORBIDDEN");
        const oneByte = await h.app.request(route.path, {
          method: "POST",
          headers: {
            "x-hub-signature-256": `sha256=${createHmac("sha256", WEBHOOK_SECRET).update('{"zen":"a"}').digest("hex")}`,
            "x-github-event": "ping",
            "x-github-delivery": UUID,
          },
          body: '{"zen":"b"}',
        });
        expect(oneByte.status).toBe(403);
        break;
      }
      case "cron":
        expect(anon.status).toBe(403);
        expect((await send(route, { headers: { authorization: "Bearer wrong" } })).status).toBe(403);
        break;
    }
  });

  const credentialsFor = (route: RouteDef): { token?: string; headers?: Record<string, string> } =>
    route.auth === "cron"
      ? { headers: { authorization: `Bearer ${CRON_SECRET}` } }
      : route.auth === "public"
        ? {}
        : { token: route.auth === "maintainer" ? maintainerToken : route.auth === "account" ? plain.token : contributor.token };
  let maintainerToken = "";

  it.each(NAMES)("%s validates its input with its zod schema", async (name) => {
    if (!maintainerToken) maintainerToken = (await h.contributor("contract-maint", { maintainer: true })).token;
    const route = Routes[name] as RouteDef;
    let res: Awaited<ReturnType<typeof send>>;
    if (route.auth === "github_webhook") {
      const body = { zen: "x" };
      res = await h.call("POST", `${route.path}?unexpected=1`, { body, headers: webhookHeaders("ping", body) });
    } else if (Object.keys((route.params as unknown as { shape: object }).shape ?? {}).length > 0) {
      res = await h.call(route.method, route.path.replace(/:[a-z]+/g, "NOT_VALID!"), {
        ...credentialsFor(route),
        body: route.method === "GET" ? undefined : {},
        idem: route.idempotent,
      });
    } else if (route.method !== "GET") {
      res = await send(route, { ...credentialsFor(route), body: ["not", "an", "object"] });
    } else {
      res = await send(route, { ...credentialsFor(route), query: `?cursor=${"x".repeat(300)}&after=-1&kind=bogus&target=X&unexpected=1` });
    }
    expect(res.status, JSON.stringify(res.body)).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_FAILED");
    expect(typeof res.body.error.requestId).toBe("string");
  });

  it("a response that breaks its schema is never sent (500 INTERNAL, violation reported)", async () => {
    const broken = {
      ...createHandlers(),
      getPlatformStatus: (async () => ({ bootstrapMode: "yes" })) as unknown as Handler<"getPlatformStatus">,
    } as Handlers;
    const reported: string[] = [];
    const app = createApp({ ...h.deps, onContractViolation: (r, d) => reported.push(`${r}: ${d}`) }, broken);
    const res = await app.request("/v1/public/status");
    expect(res.status).toBe(500);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("INTERNAL");
    expect(reported[0]).toMatch(/^getPlatformStatus: response does not match/);
  });

  it("every route answers 2xx with a body that parses as its response schema in one scenario", async () => {
    const call = async (method: string, path: string, opts: Parameters<Harness["call"]>[2] = {}) => {
      const res = await h.call(method, path, opts);
      const name = routeOf(method, path);
      if (res.status >= 400 && process.env.WOS_TEST_LOG) console.error(method, path, res.status, JSON.stringify(res.body));
      if (name && res.status >= 200 && res.status < 400) {
        const parsed = (Routes[name] as RouteDef).response.safeParse(res.body);
        expect(parsed.success, `${name}: ${JSON.stringify(parsed.error?.issues?.slice(0, 3))}`).toBe(true);
        seen.set(name, res.status);
      }
      return res;
    };
    const cron = { authorization: `Bearer ${CRON_SECRET}` };
    // public
    for (const p of [
      "/v1/public/status",
      "/v1/public/targets",
      "/v1/public/targets/salesforce",
      "/v1/public/targets/salesforce/progress",
      "/v1/public/catalog",
      "/v1/public/activity",
      "/v1/public/leaderboard",
    ]) {
      await call("GET", p);
    }
    // auth
    const start = await call("POST", "/v1/auth/email/start", {
      body: { email: "scenario@example.com", clientKind: "cli", deviceName: "x", devicePublicKey: Buffer.alloc(32, 7).toString("base64") },
    });
    const { code } = h.mailer.lastTo("scenario@example.com");
    const redeemed = await call("POST", "/v1/auth/email/redeem", {
      body: { requestId: start.body.requestId, pollSecret: start.body.pollSecret, linkToken: null, code },
    });
    const refreshed = await call("POST", "/v1/auth/refresh", { body: { refreshToken: redeemed.body.refreshToken } });
    await call("GET", "/v1/me", { token: refreshed.body.accessToken });
    await call("PATCH", "/v1/me", {
      token: refreshed.body.accessToken,
      body: { displayName: "Scenario", followedTargets: ["slack"], progressEmails: true },
    });
    await call("GET", "/v1/me/events", { token: refreshed.body.accessToken });
    // GitHub link (device and web), unlink
    const linkStart = await call("POST", "/v1/me/github/link", { token: refreshed.body.accessToken, body: { flow: "device" } });
    const [req] = await h.owner<
      { device_code: string }[]
    >`select device_code from wos.github_link_requests where id = ${linkStart.body.linkId}`;
    h.github.deviceGrants.set(req!.device_code, {
      status: "ok",
      user: { userId: 77_001, login: "scenario", createdAt: "2018-01-01T00:00:00Z", avatarUrl: null },
    });
    await call("POST", "/v1/me/github/link/poll", { token: refreshed.body.accessToken, body: { linkId: linkStart.body.linkId } });
    await call("POST", "/v1/me/github/unlink", { token: refreshed.body.accessToken, idem: true, body: { confirm: true } });
    const web = await h.signIn("scenario-web@example.com");
    const webStart = await call("POST", "/v1/me/github/link", { token: web.token, body: { flow: "web" } });
    const state = new URL(webStart.body.authorizeUrl).searchParams.get("state")!;
    h.github.deviceGrants.set("scenario-code", {
      status: "ok",
      user: { userId: 77_002, login: "scenario-web", createdAt: "2018-01-01T00:00:00Z", avatarUrl: null },
    });
    await call("GET", `/v1/github/oauth/callback?code=scenario-code&state=${encodeURIComponent(state)}`);
    await call("POST", "/v1/auth/logout", { token: web.token });

    // contributor work
    const maint = await h.contributor("scenario-maint", { maintainer: true });
    const builder = await h.contributor("scenario-builder");
    await call("POST", "/v1/me/attestations", {
      token: builder.token,
      idem: true,
      body: {
        deviceId: builder.deviceId,
        providers: [
          {
            provider: "claude_cli",
            installed: true,
            cliVersion: "2.1.284",
            signedIn: true,
            authMethod: "claude.ai",
            models: ["opus", "fable"],
            checkedAt: new Date().toISOString(),
          },
        ],
      },
    });
    const seeded = await seedFeature(h.owner, {
      abus: [
        { n: "01", write: ["modules/contacts/a/**"] },
        { n: "02", write: ["modules/contacts/b/**"] },
      ],
    });
    await call("GET", "/v1/public/targets/salesforce/features/contacts");
    await call("GET", "/v1/public/catalog/contacts");
    await call("GET", `/v1/public/abus/${seeded.abus.get("01")}`);
    await call("GET", "/v1/targets/salesforce/features/contacts/abus", { token: builder.token });
    const spare = await call("POST", `/v1/abus/${seeded.abus.get("02")}/claim`, {
      token: builder.token,
      idem: true,
      body: { deviceId: builder.deviceId },
    });
    await call("POST", `/v1/leases/${spare.body.lease.id}/heartbeat`, {
      token: builder.token,
      body: { deviceId: builder.deviceId, phase: "building" },
    });
    await call("POST", `/v1/leases/${spare.body.lease.id}/release`, { token: builder.token, idem: true, body: { reason: "not now" } });
    await call("GET", "/v1/me/work", { token: builder.token });

    // build -> review -> PR -> merge (the flow helpers go through h.call; re-issue the key requests through `call`)
    const b = await buildAndSubmit(h, builder, seeded.abus.get("01")!, [{ path: "modules/contacts/a/x.ts", content: "a\n" }]);
    for (const n of ["claimBuild", "postManifest", "postAgentRun", "setAttemptPhase", "submitChangeset"] as const) seen.set(n, 200);
    expect(b.submit.status).toBe(200);
    for (const [n, body] of [
      ["claimBuild", b.claim.body],
      ["submitChangeset", b.submit.body],
    ] as const) {
      expect(Routes[n].response.safeParse(body).success).toBe(true);
    }
    await call("GET", `/v1/attempts/${b.attemptId}`, { token: builder.token });
    const head = h.github.commits.at(-1)!.sha;
    const suite = {
      action: "completed",
      repository: { full_name: "waronsaas/suite" },
      check_suite: { id: 9, head_sha: head, conclusion: "success" },
    };
    await call("POST", "/v1/github/webhook", { body: suite, headers: webhookHeaders("check_suite", suite) });
    const astra = await h.contributor("scenario-astra");
    const fable = await h.contributor("scenario-fable");
    const ra = await reviewAs(h, astra, "astra", "implementation_review", verdict("NO_MATERIAL_GAPS"));
    const rf = await reviewAs(h, fable, "fable", "implementation_review", verdict("NO_MATERIAL_GAPS"));
    for (const r of [ra, rf]) {
      expect(Routes.claimReview.response.safeParse(r.claim.body).success).toBe(true);
      expect(Routes.submitVerdict.response.safeParse(r.res.body).success).toBe(true);
    }
    seen.set("claimReview", 200);
    seen.set("submitVerdict", 200);
    await call("GET", "/v1/cron/dispatch", { headers: cron });
    const pr = h.github.prs.at(-1)!;
    const merged = {
      action: "closed",
      repository: { full_name: "waronsaas/suite" },
      pull_request: { number: pr.number, merged: true, merge_commit_sha: "8".repeat(40) },
    };
    await call("POST", "/v1/github/webhook", { body: merged, headers: webhookHeaders("pull_request", merged) });
    await call("PATCH", "/v1/me", { token: builder.token, body: { leaderboardOptIn: true } });
    await call("GET", "/v1/public/contributors/scenario-builder");
    await call("GET", "/v1/public/contributors/scenario-builder/ledger");

    // proposals, blockers, resolver, rulings, maintainer
    await call("POST", "/v1/proposals", {
      token: builder.token,
      idem: true,
      body: {
        target: "salesforce",
        feature: "contacts",
        title: "Merge duplicates",
        body: "Contacts need a merge-duplicates flow for imports.",
      },
    });
    const blocker = await call("POST", "/v1/blockers", {
      token: builder.token,
      idem: true,
      body: {
        target: "salesforce",
        affectedContract: "features/contacts/CONTRACT.yaml",
        reason: "The contract has no export requirement.",
        evidence: "R-001 covers only listing contacts.",
        requestedCapability: "An export requirement",
        affectedWorkstream: "planning",
        suggestedResolution: null,
        abu: "contacts#01",
      },
    });
    await call("GET", "/v1/tasks", { token: maint.token });
    const resolve = await call("POST", `/v1/tasks/${blocker.body.taskId}/claim`, {
      token: maint.token,
      idem: true,
      body: { deviceId: maint.deviceId },
    });
    const ruling = await call("POST", `/v1/leases/${resolve.body.lease.id}/ruling`, {
      token: maint.token,
      idem: true,
      body: { schema: "ruling.v1", rulings: [], proposedChange: "Add R-002: export contacts as CSV." },
    });
    await call("POST", `/v1/admin/rulings/${ruling.body.rulingId}/confirm`, {
      token: maint.token,
      idem: true,
      body: { accept: true, note: "Agreed, add it." },
    });
    await call("POST", "/v1/admin/targets/slack/roadmaps", { token: maint.token, idem: true, body: { reason: "Start the Slack roadmap" } });
    await call("POST", "/v1/admin/actions", {
      token: maint.token,
      idem: true,
      body: { action: "set_hosting", target: "slack", hostedUrl: null, selfHostable: false },
    });
    await call("GET", "/v1/cron/sweep", { headers: cron });

    const missing = NAMES.filter((n) => !seen.has(n));
    expect(missing).toEqual([]);
    expect(h.violations).toEqual([]);
  });
});
