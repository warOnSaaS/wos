/**
 * The ONE wOS Desktop's shell (D16) through its main-process code, with the real orchestrator, against the fakes:
 *   - S-40: Build's gate opens only with an entitled org AND the device switch; it closes (handlers removed, runs
 *     aborted, leases released) when either lapses;
 *   - Your Apps / Available Apps with enable/disable and org selection (WORKSTREAMS 12.4 desktop row);
 *   - Settings -> Environment: wOS Cloud tokens, a self-hosted Core's local sign-in (S-41), sessions per environment;
 *   - the module installer from the shell, the merged navigation and the host bridge's rules (S-38).
 */
import { type LeaseView, type Orchestrator, type OrgApps, WOS_CLOUD_ENVIRONMENT_ID } from "@waronsaas/contracts";
import { afterEach, describe, expect, it } from "vitest";
import { FAKE_CORE, FAKE_SELF_HOSTED, PERSONAL_ORG, SELF_HOSTED_CODE, SELF_HOSTED_ENVIRONMENT_ID, TEAM_ORG } from "../dev/fake-apps.js";
import { createEnvironmentManager } from "../src/main/environment.js";
import type { ShellState } from "../src/shared/ipc.js";
import { type Rig, rig, signIn } from "./support.js";

let r: Rig | null = null;
afterEach(() => {
  r?.dispose();
  r = null;
});

const shell = (x: Rig) => x.core.shellState();
const nav = (x: Rig) => shell(x).navigation.map((n) => n.id);

describe("S-40: Build is gated", () => {
  it("signed out: Build is off, its channels refuse, and no Build navigation exists", async () => {
    r = rig();
    await r.core.refresh();
    expect(shell(r).build).toMatchObject({ open: false, entitled: false, onDevice: true });
    expect(shell(r).build.reason).toMatch(/SIGN IN/);
    await expect(r.core.invoke("wos:list-targets", undefined)).rejects.toMatchObject({ code: "NOT_ENTITLED" });
    expect(nav(r)).toEqual([]);
    expect(r.gate).toEqual([]);
  });

  it("entitled (personal org) and on for the device: the gate opens once and Build's navigation comes from its manifest", async () => {
    r = rig({ githubLinked: true });
    await signIn(r);
    expect(r.gate).toEqual([true]);
    expect(shell(r).build).toMatchObject({ open: true, entitled: true, entitledOrgs: [PERSONAL_ORG], reason: null });
    expect(nav(r)).toEqual(["build.targets", "build.work", "build.contributions"]);
    // Build is decided from listOrgApps on the control plane, never from the environment's ActiveApps.
    expect(r.backend.apps.calls).toContain(`GET https://api.waronsaas.test/v1/orgs/${PERSONAL_ORG}/apps`);
    expect(await r.core.invoke("wos:list-targets", undefined)).toBeInstanceOf(Array);
  });

  it("entitled but off on this device: closed, with the reason in words; turning it on opens it", async () => {
    r = rig({ buildOnDevice: false });
    await signIn(r);
    expect(shell(r).build).toMatchObject({ open: false, entitled: true, onDevice: false });
    expect(shell(r).build.reason).toMatch(/OFF ON THIS DEVICE/);
    await expect(r.core.invoke("wos:build", { abu: r.backend.server.abuId, model: "opus" })).rejects.toMatchObject({
      code: "NOT_ENTITLED",
    });
    expect(r.buildCalls).toEqual([]);
    const s = (await r.core.invoke("wos:set-build-on-device", { on: true })) as ShellState;
    expect(s.build.open).toBe(true);
    expect(r.gate).toEqual([true]);
    expect(r.settings.get().buildOnDevice).toBe(true);
  });

  it("not enabled for any org: closed; enabling Build from Desktop opens it (V1 proof step 2, for Build)", async () => {
    r = rig({ buildEnabled: false });
    await signIn(r);
    expect(shell(r).build.reason).toMatch(/NOT ENABLED/);
    const apps = (await r.core.invoke("wos:org-apps", { organizationId: PERSONAL_ORG })) as OrgApps;
    expect(apps.availableApps.map((a) => [a.app.id, a.entitlement.state])).toContainEqual(["build", "available"]);
    await r.core.invoke("wos:enable-app", { organizationId: PERSONAL_ORG, app: "build", expectedRowVersion: null });
    expect(r.gate).toEqual([true]);
    expect(nav(r)).toContain("build.targets");
  });

  it("a lapse (disabled, or switched off) closes the gate: handlers go, running builds abort, held leases are released", async () => {
    const released: string[] = [];
    const lease: LeaseView = {
      id: "0192ab3c-0000-7000-8000-0000000011aa",
      taskId: "0192ab3c-0000-7000-8000-0000000011bb",
      state: "active",
      issuedAt: "2026-09-30T12:00:00.000Z",
      expiresAt: "2026-09-30T12:15:00.000Z",
      hardDeadlineAt: "2026-09-30T14:00:00.000Z",
      heartbeatSeconds: 60,
    };
    let aborted = false;
    r = rig({
      githubLinked: true,
      wrap: (o) =>
        new Proxy(o, {
          get(t, p) {
            if (p === "myWork")
              return async () => ({
                leases: [lease, { ...lease, id: "0192ab3c-0000-7000-8000-0000000011cc", state: "released" }],
                tasks: [],
                attempts: [],
              });
            if (p === "release") return async (id: string) => void released.push(id);
            if (p === "build")
              return (opts: { signal?: AbortSignal }) =>
                new Promise((res) =>
                  opts.signal?.addEventListener("abort", () => {
                    aborted = true;
                    res({ ok: false, code: "ABORTED", message: "aborted", task: null });
                  }),
                );
            return Reflect.get(t, p);
          },
        }) as Orchestrator,
    });
    await signIn(r);
    await r.core.invoke("wos:build", { abu: r.backend.server.abuId, model: "opus" });
    const personal = (await r.core.invoke("wos:org-apps", { organizationId: PERSONAL_ORG })) as OrgApps;
    const build = personal.yourApps.find((a) => a.app.id === "build")!;
    await r.core.invoke("wos:disable-app", {
      organizationId: PERSONAL_ORG,
      app: "build",
      expectedRowVersion: build.entitlement.rowVersion,
    });
    await r.core.settle();
    expect(r.gate).toEqual([true, false]);
    expect(aborted).toBe(true);
    expect(released).toEqual([lease.id]);
    expect(nav(r)).toEqual([]);
    await expect(r.core.invoke("wos:runs", undefined)).rejects.toMatchObject({ code: "NOT_ENTITLED" });
  });

  it("an entitlement that cannot be read counts as none (fail closed)", async () => {
    r = rig();
    await signIn(r);
    expect(shell(r).build.open).toBe(true);
    r.backend.apps.orgs.push({ ...r.backend.apps.orgs[0]!, id: "0192f000-0000-7000-8000-0000000000ff", slug: "ghost" });
    // The fake answers 404 for listOrgApps of an org it lists but does not know: the whole check fails closed.
    const orig = r.backend.apps.handle.bind(r.backend.apps);
    r.backend.apps.handle = (url, init) =>
      url.pathname.endsWith("/0192f000-0000-7000-8000-0000000000ff/apps")
        ? new Response(JSON.stringify({ error: { code: "INTERNAL", message: "boom", requestId: "x" } }), { status: 500 })
        : orig(url, init);
    await r.core.refresh();
    expect(shell(r).build).toMatchObject({ open: false, entitled: false });
    expect(shell(r).build.reason).toMatch(/COULD NOT CHECK/);
    expect(r.gate).toEqual([true, false]);
  });

  it("sign out closes the gate before the session is dropped", async () => {
    r = rig();
    await signIn(r);
    await r.core.invoke("wos:logout", undefined);
    expect(r.gate).toEqual([true, false]);
    expect(shell(r).organizations).toEqual([]);
    expect(await r.backend.secrets.get("wos.session.v1")).toBeNull();
  });
});

describe("Your Apps / Available Apps", () => {
  it("lists per org; the personal org is selected by default; a member cannot enable (FORBIDDEN)", async () => {
    r = rig();
    await signIn(r);
    expect(shell(r).organizations.map((o) => o.kind)).toEqual(["personal", "team"]);
    expect(shell(r).organizationId).toBe(PERSONAL_ORG);
    const personal = (await r.core.invoke("wos:org-apps", { organizationId: PERSONAL_ORG })) as OrgApps;
    expect(personal.yourApps.map((a) => a.app.id)).toEqual(["build"]);
    expect(personal.availableApps.map((a) => a.app.id)).toEqual(["sample"]);
    await expect(
      r.core.invoke("wos:enable-app", { organizationId: TEAM_ORG, app: "sample", expectedRowVersion: null }),
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    const s = (await r.core.invoke("wos:select-organization", { organizationId: TEAM_ORG })) as ShellState;
    expect(s.organizationId).toBe(TEAM_ORG);
    await expect(
      r.core.invoke("wos:select-organization", { organizationId: "0192f000-0000-7000-8000-0000000000ee" }),
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("a stale row version is a CONFLICT and changes nothing", async () => {
    r = rig();
    await signIn(r);
    await expect(
      r.core.invoke("wos:disable-app", { organizationId: PERSONAL_ORG, app: "build", expectedRowVersion: 7 }),
    ).rejects.toMatchObject({
      code: "CONFLICT",
    });
    expect(shell(r).build.open).toBe(true);
  });

  it("enabling an app installs its verified module, adds its navigation; disabling removes it and hides its page", async () => {
    r = rig();
    await signIn(r);
    expect(shell(r).activeApps?.map((a) => a.id)).toEqual(["core", "build"]);
    await r.core.invoke("wos:enable-app", { organizationId: PERSONAL_ORG, app: "sample", expectedRowVersion: null });
    const s = shell(r);
    expect(s.activeApps?.map((a) => [a.id, a.source])).toContainEqual(["sample", "entitlement"]);
    expect(s.modules).toEqual([
      expect.objectContaining({ app: "sample", wanted: "0.1.0", active: "0.1.0", state: "active", reason: null }),
    ]);
    expect(s.navigation.map((n) => n.id)).toEqual(["build.targets", "build.work", "build.contributions", "sample.home"]);
    // The environment token went to wOS Cloud's Core only, for the selected org.
    expect(r.backend.apps.calls).toContain(`POST https://api.waronsaas.test/v1/environments/${WOS_CLOUD_ENVIRONMENT_ID}/token`);

    await r.core.invoke("wos:show-module", { app: "sample", route: "/sample", bounds: { x: 0, y: 80, width: 800, height: 600 } });
    expect(r.shown.at(-1)).toEqual({ app: "sample", version: "0.1.0", route: "/sample" });
    await expect(
      r.core.invoke("wos:show-module", { app: "sample", route: "/crm", bounds: { x: 0, y: 0, width: 1, height: 1 } }),
    ).rejects.toThrow(/under \/sample/);

    const rows = (await r.core.invoke("wos:org-apps", { organizationId: PERSONAL_ORG })) as OrgApps;
    const sample = rows.yourApps.find((a) => a.app.id === "sample")!;
    await r.core.invoke("wos:disable-app", {
      organizationId: PERSONAL_ORG,
      app: "sample",
      expectedRowVersion: sample.entitlement.rowVersion,
    });
    expect(nav(r)).not.toContain("sample.home");
    expect(shell(r).modules).toEqual([]);
    await expect(
      r.core.invoke("wos:show-module", { app: "sample", route: "/sample", bounds: { x: 0, y: 0, width: 1, height: 1 } }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("the module host bridge (S-38)", () => {
  async function shownSample() {
    const x = rig();
    await signIn(x);
    await x.core.invoke("wos:enable-app", { organizationId: PERSONAL_ORG, app: "sample", expectedRowVersion: null });
    await x.core.invoke("wos:show-module", { app: "sample", route: "/sample", bounds: { x: 0, y: 0, width: 10, height: 10 } });
    return x;
  }

  it("the shown module calls its own API through the environment session", async () => {
    r = await shownSample();
    expect(await r.core.moduleRequest("sample", "sample", "GET", "/apps/sample/ping", null)).toEqual({
      status: 200,
      body: { ok: true, environment: "FAKE wOS CLOUD" },
    });
    expect(r.core.moduleManifest("sample", "sample").routes.api).toBe("/apps/sample");
  });

  it("refuses another app, a path outside its routes.api, traversal, and a module that is not shown", async () => {
    r = await shownSample();
    await expect(r.core.moduleRequest("sample", "build", "GET", "/apps/build/x", null)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(r.core.moduleRequest("sample", "sample", "GET", "/v1/core/apps", null)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(r.core.moduleRequest("sample", "sample", "GET", "/apps/samplex/ping", null)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(r.core.moduleRequest("sample", "sample", "GET", "/apps/sample/../../v1/core/apps", null)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(r.core.moduleRequest("sample", "sample", "GET", "/apps/sample/ping?x=1", null)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(r.core.moduleRequest("sample", "sample", "PUT", "/apps/sample/ping", null)).rejects.toThrow(/method/);
    await r.core.invoke("wos:hide-module", undefined);
    await expect(r.core.moduleRequest("sample", "sample", "GET", "/apps/sample/ping", null)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("Settings -> Environment", () => {
  it("a self-hosted Core: its own sign-in, WOS_APPS decides, no wOS Cloud token is asked for (S-41), session kept per environment", async () => {
    r = rig();
    let s = (await r.core.invoke("wos:set-environment", { url: FAKE_SELF_HOSTED })) as ShellState;
    expect(s.environment).toMatchObject({ url: FAKE_SELF_HOSTED, isDefault: false, problem: null });
    expect(s.environment.descriptor).toMatchObject({ kind: "self_hosted", auth: { kind: "local" } });
    expect(s.activeAppsProblem).toMatch(/SIGN IN TO Self-hosted wOS/);
    expect(r.settings.get().environmentUrl).toBe(FAKE_SELF_HOSTED);

    s = (await r.core.invoke("wos:environment-sign-in", { email: "ops@example.com" })) as ShellState;
    expect(s.environment.session).toMatchObject({ waitingForCode: true, email: "ops@example.com", signedIn: false });
    await expect(r.core.invoke("wos:environment-sign-in-code", { code: "ABCD-EFGH" })).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    s = (await r.core.invoke("wos:environment-sign-in-code", { code: SELF_HOSTED_CODE.toLowerCase() })) as ShellState;
    expect(s.environment.session).toMatchObject({ signedIn: true, role: "owner", email: "ops@example.com" });
    expect(s.activeApps?.map((a) => [a.id, a.source])).toEqual([
      ["core", "core"],
      ["sample", "self_host_config"],
    ]);
    expect(s.modules[0]).toMatchObject({ app: "sample", state: "active" });
    expect(s.navigation.map((n) => n.id)).toEqual(["sample.home"]);
    // The local session is in the keychain under this environment only.
    expect(await r.backend.secrets.get(`wos.env.${SELF_HOSTED_ENVIRONMENT_ID}`)).toContain("self-hosted-session-1");
    expect(r.backend.apps.calls.some((c) => c.includes("/v1/environments/"))).toBe(false);

    s = (await r.core.invoke("wos:environment-sign-out", undefined)) as ShellState;
    expect(s.environment.session.signedIn).toBe(false);
    expect(await r.backend.secrets.get(`wos.env.${SELF_HOSTED_ENVIRONMENT_ID}`)).toBeNull();

    s = (await r.core.invoke("wos:set-environment", { url: null })) as ShellState;
    expect(s.environment).toMatchObject({ url: FAKE_CORE, isDefault: true });
  });

  it("Build does not depend on the environment: a self-hosted environment keeps Build on", async () => {
    r = rig();
    await signIn(r);
    const s = (await r.core.invoke("wos:set-environment", { url: FAKE_SELF_HOSTED })) as ShellState;
    expect(s.build.open).toBe(true);
    expect(s.navigation.map((n) => n.id)).toEqual(["build.targets", "build.work", "build.contributions"]);
  });

  const descriptor = (over: Record<string, unknown>) => ({
    schema: "wos-environment.v1",
    environmentId: WOS_CLOUD_ENVIRONMENT_ID,
    name: "Look-alike",
    kind: "cloud",
    protocol: "wos-app/v1",
    coreVersion: "0.1.0",
    apiBase: "https://evil.example",
    auth: { kind: "wos_cloud", issuer: "https://api.waronsaas.test" },
    ...over,
  });
  const manager = (url: string, body: unknown) => {
    const issued: string[] = [];
    const env = createEnvironmentManager(url, {
      fetch: (async () => new Response(JSON.stringify(body), { status: 200 })) as typeof fetch,
      secrets: { get: async () => null, set: async () => undefined, delete: async () => undefined },
      platform: {
        issueEnvironmentToken: async (id: string) => {
          issued.push(id);
          throw new Error("must not be called");
        },
      },
      cloudCoreUrl: FAKE_CORE,
      cloudIssuer: "https://api.waronsaas.test",
      clientVersion: "test",
    });
    return { env, issued };
  };

  it("refuses a server elsewhere that claims to be wOS Cloud: a wOS Cloud token is never sent to it", async () => {
    const { env, issued } = manager("https://evil.example", descriptor({}));
    await env.discover();
    expect(env.descriptor()).toBeNull();
    expect(env.view().problem).toMatch(/says it is wOS Cloud/);
    await expect(env.activeApps(PERSONAL_ORG)).rejects.toBeDefined();
    expect(issued).toEqual([]);
  });

  it("refuses a descriptor whose API is on another origin, and one that is not a descriptor", async () => {
    const a = manager("https://wos.example-company.com", descriptor({ kind: "self_hosted", auth: { kind: "local" } }));
    await a.env.discover();
    expect(a.env.view().problem).toMatch(/another origin/);
    const b = manager("https://wos.example-company.com", { hello: "world" });
    await b.env.discover();
    expect(b.env.view().problem).toMatch(/NOT A wOS ENVIRONMENT/);
  });

  it("an OIDC environment is said to be unsupported, not faked", async () => {
    const { env } = manager(
      "https://wos.example-company.com",
      descriptor({
        kind: "self_hosted",
        apiBase: "https://wos.example-company.com",
        auth: { kind: "oidc", issuer: "https://idp.example", clientId: "wos" },
      }),
    );
    await env.discover();
    expect(env.view().problem).toMatch(/OIDC SIGN-IN IS NOT SUPPORTED/);
    await expect(env.activeApps(null)).rejects.toMatchObject({ code: "NOT_IMPLEMENTED" });
  });
});
