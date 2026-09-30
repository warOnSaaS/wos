/**
 * `wos orgs`, `wos apps`, `wos apps enable|disable` (WORKSTREAMS 12.1 cli, 12.4) against a fake of the AppRoutes
 * the CLI calls, and the NOT_ENTITLED explanation on the three claims against the orchestrator's fake control plane.
 * Human output is compared with files in test/golden.
 */
import { afterEach, describe, expect, it } from "vitest";
import { MemorySecrets } from "../../../packages/orchestrator/test/support/harness.js";
import { FIXED_DATE } from "../../../packages/orchestrator/test/support/fake-control-plane.js";
import { SESSION_KEY as ORCHESTRATOR_SESSION_KEY } from "../../../packages/orchestrator/src/session.js";
import { createAppsApi, SESSION_KEY } from "../src/apps.js";
import { buildEntry, entry, FakeAppsServer, PERSONAL, TEAM } from "./fake-apps-server.js";
import { ABU_KEY, type Harness, harness, type Run, TARGET, wos } from "./support.js";

const golden = (name: string) => `./golden/${name}`;

function session(over: Partial<Record<string, string>> = {}) {
  return JSON.stringify({
    accessToken: "test-access",
    accessExpiresAt: "2026-09-29T13:00:00Z",
    refreshToken: "test-refresh",
    refreshExpiresAt: "2026-10-29T12:00:00Z",
    deviceId: "0192ab3c-0000-7000-8000-0000000000dd",
    ...over,
  });
}

function setup() {
  const server = new FakeAppsServer();
  const secrets = new MemorySecrets();
  secrets.map.set(SESSION_KEY, session());
  const noOrchestrator = () => {
    throw new Error("apps commands must not build the orchestrator");
  };
  const run = (argv: string[]) =>
    wos(noOrchestrator, argv, {
      apps: () =>
        createAppsApi({
          baseUrl: "https://api.waronsaas.test",
          fetch: server.fetch,
          secrets,
          clientVersion: "0.0.0-test",
          now: () => new Date(FIXED_DATE),
        }),
    });
  return { server, secrets, run };
}

/** One transcript: the command, then stdout and stderr as a terminal shows them, then the exit code. */
const transcript = (argv: string[], r: Run) => `$ wos ${argv.join(" ")}\n${r.out}${r.err}(exit ${r.code})\n`;

async function session_(s: ReturnType<typeof setup>, cmds: string[][]): Promise<{ text: string; runs: Run[] }> {
  const parts: string[] = [];
  const runs: Run[] = [];
  for (const argv of cmds) {
    const r = await s.run(argv);
    runs.push(r);
    parts.push(transcript(argv, r));
  }
  return { text: parts.join("\n"), runs };
}

describe("wos orgs", () => {
  it("lists your organizations, the personal one first (golden) and as JSON", async () => {
    const s = setup();
    const { text, runs } = await session_(s, [["orgs"]]);
    expect(runs[0]!.code).toBe(0);
    await expect(text).toMatchFileSnapshot(golden("orgs.txt"));
    const j = await s.run(["orgs", "--json"]);
    expect(j.code).toBe(0);
    expect(JSON.parse(j.out)).toEqual({ type: "result", organizations: [PERSONAL, TEAM] });
  });

  it("not signed in: exit 3 and the sign-in hint", async () => {
    const s = setup();
    await s.secrets.delete(SESSION_KEY);
    const r = await s.run(["orgs"]);
    expect(r.code).toBe(3);
    expect(r.err).toBe(
      "error    UNAUTHENTICATED: listMyOrganizations: UNAUTHENTICATED: not signed in (wos login)\nhint     sign in: wos login\n",
    );
    expect(s.server.calls).toEqual([]);
  });

  it("refreshes an expired access token with the stored refresh token and keeps the new session", async () => {
    const s = setup();
    s.secrets.map.set(SESSION_KEY, session({ accessToken: "stale", accessExpiresAt: "2026-09-29T11:00:00Z" }));
    const r = await s.run(["orgs"]);
    expect(r.code, r.err).toBe(0);
    expect(s.server.refreshes).toBe(1);
    expect(JSON.parse(s.secrets.map.get(SESSION_KEY)!)).toMatchObject({ accessToken: "test-access", refreshToken: "test-refresh-2" });
  });

  it("reads the session the orchestrator writes (same SecretStore key)", () => {
    expect(SESSION_KEY).toBe(ORCHESTRATOR_SESSION_KEY);
  });
});

describe("wos apps", () => {
  it("lists Your Apps and Available Apps with their state; says when Build is not in the registry (golden)", async () => {
    const s = setup();
    s.server.registry.set("contacts", entry("contacts", { name: "Contacts", kind: "module" }));
    s.server.registry.set("crm", entry("crm", { name: "CRM" }));
    s.server.registry.set("helpdesk", entry("helpdesk", { name: "Helpdesk" }));
    s.server.setState(PERSONAL.id, "helpdesk", "disabled", 2);
    const before = await session_(s, [["apps"]]);
    s.server.registry.set("build", buildEntry());
    s.server.setState(PERSONAL.id, "build", "enabled");
    const after = await session_(s, [["apps"], ["apps", "--org", "acme"]]);
    expect([...before.runs, ...after.runs].map((r) => r.code)).toEqual([0, 0, 0]);
    await expect(`${before.text}\n${after.text}`).toMatchFileSnapshot(golden("apps.txt"));
  });

  it("--json prints the organization and OrgApps", async () => {
    const s = setup();
    s.server.registry.set("build", buildEntry());
    const r = await s.run(["apps", "--json"]);
    expect(r.code).toBe(0);
    const j = JSON.parse(r.out);
    expect(j).toMatchObject({ type: "result", organization: PERSONAL, organizationId: PERSONAL.id });
    expect(j.yourApps.map((v: { app: { id: string } }) => v.app.id)).toEqual(["core"]);
    expect(j.availableApps.map((v: { app: { id: string } }) => v.app.id)).toEqual(["build"]);
  });

  it("--org works before or after the subcommand", async () => {
    const s = setup();
    s.server.registry.set("crm", entry("crm", { name: "CRM" }));
    for (const argv of [
      ["apps", "--org", "acme", "enable", "crm"],
      ["apps", "enable", "crm", "--org", "acme"],
    ]) {
      const r = await s.run(argv);
      expect(r.code).toBe(1);
      expect(r.err).toContain("error    FORBIDDEN: only an owner or admin of acme can enable apps; your role there is member");
    }
  });

  it("an unknown --org names your organizations (exit 1)", async () => {
    const s = setup();
    const r = await s.run(["apps", "--org", "nope"]);
    expect(r.code).toBe(1);
    expect(r.err).toBe(
      "error    NOT_FOUND: you are not a member of an organization named nope\nhint     your organizations: dev, acme (wos orgs)\n",
    );
  });

  it.each([[["apps", "enable"]], [["apps", "disable"]], [["apps", "bogus"]]])("%j is a usage error (exit 2)", async (argv) => {
    const s = setup();
    const r = await s.run(argv);
    expect(r.code).toBe(2);
    expect(s.server.calls).toEqual([]);
  });
});

describe("wos apps enable build", () => {
  it("today: the registry has no Build release, so the server refuses and the CLI says so plainly (golden)", async () => {
    const s = setup();
    const { text, runs } = await session_(s, [["apps", "enable", "build"]]);
    expect(runs[0]!.code).toBe(1);
    // The CLI asked the server; it does not assume the outcome.
    expect(s.server.calls.map((c) => c.route)).toEqual(["listMyOrganizations", "listOrgApps", "enableApp"]);
    expect(s.server.calls[2]!.body).toEqual({ expectedRowVersion: null });
    expect(runs[0]!.err).toContain("error    NOT_FOUND: Build isn't available to enable yet (registry has no Build release)");
    expect(runs[0]!.err).toContain("server   enableApp: NOT_FOUND: app build has no published release");
    await expect(text).toMatchFileSnapshot(golden("apps-enable-build-unreleased.txt"));

    const j = await s.run(["apps", "enable", "build", "--json"]);
    expect(j.code).toBe(1);
    expect(JSON.parse(j.out)).toMatchObject({
      type: "error",
      code: "NOT_FOUND",
      message: "Build isn't available to enable yet (registry has no Build release)",
      server: { message: "enableApp: NOT_FOUND: app build has no published release" },
    });
  });

  it("once Build's release is published: enables it on the personal org, then reports it as already enabled (golden)", async () => {
    const s = setup();
    s.server.registry.set("build", buildEntry());
    const { text, runs } = await session_(s, [["apps", "enable", "build"], ["apps", "enable", "build"], ["apps"]]);
    expect(runs.map((r) => r.code)).toEqual([0, 0, 0]);
    expect(s.server.rows.get(`${PERSONAL.id}/build`)).toMatchObject({ state: "enabled", rowVersion: 1 });
    expect(s.server.calls.filter((c) => c.route === "enableApp")).toHaveLength(1);
    expect(s.server.calls.find((c) => c.route === "enableApp")!.idempotencyKey).toMatch(/^[0-9a-f-]{36}$/);
    await expect(text).toMatchFileSnapshot(golden("apps-enable-build.txt"));

    s.server.rows.clear();
    const j = await s.run(["apps", "enable", "build", "--json"]);
    expect(j.code).toBe(0);
    expect(JSON.parse(j.out)).toMatchObject({
      type: "result",
      organization: PERSONAL,
      changed: true,
      app: { id: "build" },
      entitlement: { state: "enabled", rowVersion: 1 },
    });
  });
});

describe("wos apps enable / disable: refusals explained", () => {
  it("FORBIDDEN, DEPENDENCY_NOT_ENABLED, DEPENDENT_ENABLED and a row-version conflict (golden)", async () => {
    const s = setup();
    s.server.registry.set("contacts", entry("contacts", { name: "Contacts" }));
    s.server.registry.set("crm", entry("crm", { name: "CRM", deps: ["contacts"] }));
    const parts: string[] = [];
    const step = async (argv: string[], expectCode: number) => {
      const r = await s.run(argv);
      expect(r.code, r.err).toBe(expectCode);
      parts.push(transcript(argv, r));
      return r;
    };
    await step(["apps", "enable", "crm", "--org", "acme"], 1); // member, not owner/admin
    await step(["apps", "enable", "crm"], 1); // contacts not enabled
    await step(["apps", "enable", "contacts"], 0);
    await step(["apps", "enable", "crm"], 0);
    await step(["apps", "disable", "contacts"], 1); // crm requires it
    // Another admin disables crm between this command's read and its write.
    s.server.interleave = () => s.server.setState(PERSONAL.id, "crm", "disabled", 2);
    await step(["apps", "disable", "crm"], 0); // it is disabled either way: reported, not an error
    await step(["apps", "enable", "crm"], 0);
    // Another admin disables crm and enables it again in between: the row version moved, the state did not.
    s.server.interleave = () => s.server.setState(PERSONAL.id, "crm", "enabled", 5);
    await step(["apps", "disable", "crm"], 1);
    await expect(parts.join("\n")).toMatchFileSnapshot(golden("apps-refusals.txt"));
    expect(s.server.rows.get(`${PERSONAL.id}/contacts`)).toMatchObject({ state: "enabled" });
  });

  it("disable on an app that was never enabled changes nothing", async () => {
    const s = setup();
    s.server.registry.set("crm", entry("crm", { name: "CRM" }));
    const r = await s.run(["apps", "disable", "crm"]);
    expect(r.code).toBe(0);
    expect(r.out).toBe("unchanged crm is not enabled on dev (personal, owner)\n");
    expect(s.server.calls.map((c) => c.route)).not.toContain("disableApp");
  });

  it("a DEPENDENCY_NOT_ENABLED --json error keeps the server's details", async () => {
    const s = setup();
    s.server.registry.set("contacts", entry("contacts", { name: "Contacts" }));
    s.server.registry.set("crm", entry("crm", { name: "CRM", deps: ["contacts"] }));
    const r = await s.run(["apps", "enable", "crm", "--json"]);
    expect(r.code).toBe(1);
    expect(JSON.parse(r.out)).toMatchObject({
      type: "error",
      code: "DEPENDENCY_NOT_ENABLED",
      server: { details: { missing: ["contacts is not enabled"] } },
      hints: ["enable it first: wos apps enable contacts", "then: wos apps enable crm"],
    });
  });
});

describe("NOT_ENTITLED on the claims", () => {
  let h: Harness | null = null;
  afterEach(() => {
    h?.dispose();
    h = null;
  });

  const refuse = (h: Harness, path: RegExp) => {
    const served = h.server.fetch;
    h.server.fetch = async (input, init) =>
      path.test(new URL(String(input)).pathname)
        ? new Response(
            JSON.stringify({
              error: { code: "NOT_ENTITLED", message: "the build app is not enabled for any of your organizations", requestId: "r" },
            }),
            { status: 403 },
          )
        : served(input, init);
  };

  it("wos build, wos roadmap and wos review say Build isn't enabled and give the command (golden)", async () => {
    h = harness();
    refuse(h, /\/claim$/);
    h.server.openAuthorTask("roadmap_author");
    const parts: string[] = [];
    for (const argv of [["build", `${TARGET}/${ABU_KEY}`], ["roadmap"], ["review", "--slot", "astra"]]) {
      const r = await wos(() => h!.make("cli"), argv);
      expect(r.code, r.out + r.err).toBe(1);
      expect(r.err).toContain(
        "hint     the Build app isn't enabled for your account, so wOS won't lease you work; enable it: wos apps enable build",
      );
      parts.push(transcript(argv, r));
    }
    await expect(parts.join("\n")).toMatchFileSnapshot(golden("not-entitled.txt"));
  });
});
