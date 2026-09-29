/**
 * WORKSTREAMS 3 desktop DONE (2) and (3): the spec's flow — sign in, link GitHub, Sniper List ->
 * Salesforce -> CRM -> feature -> claimable ABU -> model picker -> BUILD — through the Desktop's main
 * process code (DesktopCore) and the REAL orchestrator, against the fake control plane; orchestrator
 * events stream to the activity pane tagged per run.
 */
import type { AbuSummary, AppFeatureDetail, Me, Orchestrator, TargetDetail, TargetSummary } from "@waronsaas/contracts";
import { afterEach, describe, expect, it } from "vitest";
import { FAKE_LINK, SIGNIN_REQUEST_ID } from "../dev/fake-backend.js";
import { bridgeErrorMessage, explainFailure } from "../src/main/core.js";
import type { BuilderModelChoice, ContributionHistory, DesktopEvent, RunSnapshot } from "../src/shared/ipc.js";
import { type Rig, rig, signIn, until } from "./support.js";

let r: Rig | null = null;
afterEach(() => {
  r?.dispose();
  r = null;
});

const orch = (events: DesktopEvent[]) =>
  events.filter((e): e is Extract<DesktopEvent, { kind: "orchestrator" }> => e.kind === "orchestrator");

describe("sign in (D8) through the main process", () => {
  it("email -> typed code -> Me; the code is normalised and the poll secret never leaves main", async () => {
    r = rig();
    const me = (await signIn(r)) as Me;
    expect(me.email).toBe("dev@example.com");
    expect(me.github).toBeNull();
    const redeem = r.backend.server.redeems.at(-1) as { code?: string; pollSecret?: string };
    expect(redeem.code).toBe("ABCD-EFGH");
    // Nothing sent to the renderer carries the poll secret.
    expect(JSON.stringify(r.events)).not.toContain("poll-secret-xyz");
    expect(r.backend.server.signInStarts.at(-1)).toMatchObject({ email: "dev@example.com", deviceName: "test-device" });
  });

  it("completes from a wos://auth deep link bound to the request", async () => {
    r = rig();
    const pending = r.core.invoke("wos:sign-in", { email: "dev@example.com" });
    await until(() => orch(r!.events).some((e) => e.event.type === "sign_in" && e.event.status === "waiting_for_code"));
    expect(r.core.handleDeepLink("wos://evil?r=x&t=y")).toBe(false);
    expect(r.core.handleDeepLink(FAKE_LINK)).toBe(true);
    const me = (await pending) as Me;
    expect(me.email).toBe("dev@example.com");
    expect(r.backend.server.redeems.at(-1)).toMatchObject({ requestId: SIGNIN_REQUEST_ID, linkToken: "good-token" });
    expect(r.events).toContainEqual({ kind: "deep_link", accepted: false, detail: "IGNORED: not a wos://auth sign-in link." });
  });

  it("a deep link with no sign-in waiting is ignored", () => {
    r = rig();
    expect(r.core.handleDeepLink(FAKE_LINK)).toBe(false);
    expect(r.events.at(-1)).toMatchObject({ kind: "deep_link", accepted: false });
  });

  it("a wrong code is retried through the same prompt", async () => {
    r = rig();
    const pending = r.core.invoke("wos:sign-in", { email: "dev@example.com" });
    await until(() => orch(r!.events).some((e) => e.event.type === "sign_in" && e.event.status === "waiting_for_code"));
    await r.core.invoke("wos:sign-in-code", { code: "WXYZ-2345" });
    await until(() => r!.backend.server.redeems.length === 1);
    await r.core.invoke("wos:sign-in-code", { code: "ABCD-EFGH" });
    expect(((await pending) as Me).email).toBe("dev@example.com");
    expect(r.backend.server.redeems.map((x) => (x as { code?: string }).code)).toEqual(["WXYZ-2345", "ABCD-EFGH"]);
  });

  it("cancel aborts the waiting sign-in", async () => {
    r = rig();
    const pending = r.core.invoke("wos:sign-in", { email: "dev@example.com" }).catch((e: unknown) => bridgeErrorMessage(e));
    await until(() => orch(r!.events).some((e) => e.event.type === "sign_in" && e.event.status === "waiting_for_code"));
    await r.core.invoke("wos:sign-in-cancel", undefined);
    expect(await pending).toMatch(/ABORTED|cancel/i);
  });

  it("links GitHub through the device flow and shows the code to the renderer", async () => {
    r = rig();
    await signIn(r);
    const me = (await r.core.invoke("wos:link-github", undefined)) as Me;
    expect(me.github?.login).toBe("octo-dev");
    expect(r.events).toContainEqual({ kind: "github_code", verificationUri: "https://github.com/login/device", userCode: "WOS1-2345" });
    // The device URL is displayed, never opened: it is outside the S-29 allowlist (B-0002-desktop).
    expect(r.opened).toEqual([]);
  });
});

describe("the BUILD flow: Sniper List -> Salesforce -> CRM -> feature -> ABU -> model -> BUILD", () => {
  it("walks the spec's flow and streams orchestrator events for the run", async () => {
    r = rig();
    await signIn(r);
    await r.core.invoke("wos:link-github", undefined);

    const targets = (await r.core.invoke("wos:list-targets", undefined)) as TargetSummary[];
    expect(targets.map((t) => t.rank)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(targets.find((t) => t.slug === "salesforce")?.rank).toBe(1);
    // Honest numbers: untouched targets are exactly zero.
    expect(targets.find((t) => t.slug === "slack")?.progress).toMatchObject({ mappedBp: 0, specifiedBp: 0, builtBp: 0 });

    const sf = (await r.core.invoke("wos:get-target", { slug: "salesforce" })) as TargetDetail;
    const crm = sf.capabilities.find((c) => c.key === "crm")!;
    const contacts = crm.features.find((f) => f.key === "contacts")!;
    expect(contacts.title).toBe("Contacts");

    const feature = (await r.core.invoke("wos:get-feature", { slug: "salesforce", feature: "contacts" })) as AppFeatureDetail;
    expect(feature.requirements.map((x) => x.key)).toEqual(["R-001"]);

    const abus = (await r.core.invoke("wos:list-claimable-abus", { slug: "salesforce", feature: "contacts" })) as AbuSummary[];
    const abu = abus.find((a) => a.claimable)!;
    expect(abu.key).toBe("contacts#04");

    const models = (await r.core.invoke("wos:builder-models", undefined)) as BuilderModelChoice[];
    expect(models.map((m) => [m.ref, m.available, m.isDefault])).toEqual([
      ["opus", true, true],
      ["astra", true, false],
      ["sol", true, false],
    ]);
    // The status run posted the attestations the claim's eligibility check reads (D13/D15).
    expect(r.backend.server.attestations.length).toBeGreaterThan(0);

    const { runId } = (await r.core.invoke("wos:build", { abu: abu.id, model: "opus" })) as { runId: string };
    await r.core.settle();
    expect(r.buildCalls).toEqual([expect.objectContaining({ abu: abu.id, model: "opus", detachAfterSubmit: true })]);

    const mine = orch(r.events).filter((e) => e.runId === runId);
    const steps = mine.flatMap((e) => (e.event.type === "step" ? [`${e.event.step}:${e.event.status}`] : []));
    expect(steps).toContain("LEASE:started");
    expect(steps).toContain("LEASE:passed");
    expect(steps).toContain("BUILD:passed");
    expect(steps).toContain("VERIFY:passed");
    const types = new Set(mine.map((e) => e.event.type));
    for (const t of ["lease", "worktree", "context", "agent_started", "agent_output", "agent_exited", "verify", "scope", "attempt"])
      expect(types).toContain(t);

    const runs = (await r.core.invoke("wos:runs", undefined)) as RunSnapshot[];
    const run = runs.find((x) => x.id === runId)!;
    expect(run.state).toBe("passed");
    expect(run.model).toBe("opus");
    expect(run.attempt?.abu).toBe("contacts#04");
    expect(run.explanation).toMatch(/^SUBMITTED\./);
    expect(run.events.length).toBe(mine.length);
    // The run's lifecycle reached the renderer as run events: started, then finished.
    expect(r.events.filter((e) => e.kind === "run" && e.run.id === runId).map((e) => (e as { run: { state: string } }).run.state)).toEqual([
      "running",
      "passed",
    ]);
  });

  it("follows the attempt to merge when the setting says so (no detach)", async () => {
    r = rig({ githubLinked: true });
    await signIn(r);
    r.settings.set({ detachAfterSubmit: false });
    const { runId } = (await r.core.invoke("wos:build", { abu: r.backend.server.abuId, model: "opus" })) as { runId: string };
    await r.core.settle();
    const states = orch(r.events)
      .filter((e) => e.runId === runId && e.event.type === "attempt")
      .map((e) => (e.event as { attempt: { state: string } }).attempt.state);
    expect(states.at(-1)).toBe("merged");
    expect(states).toContain("pr_open");
  });

  it("D15: two builds run at once, each tagged with its own run id and model", async () => {
    // The Desktop's side of D15: two runs in flight, events kept apart per run, each model passed to
    // orchestrator.build. The orchestrator itself is stubbed here because two concurrent build() calls
    // in ONE real orchestrator are covered by the B-0005-desktop test below.
    let release: () => void = () => undefined;
    const gate = new Promise<void>((res) => {
      release = res;
    });
    r = rig({
      githubLinked: true,
      wrap: (o) =>
        new Proxy(o, {
          get(t, p) {
            if (p === "build")
              return async (opts: { model?: string }, observer: Parameters<Orchestrator["build"]>[1]) => {
                observer({ type: "step", step: "LEASE", status: "started", detail: `claiming with ${opts.model}` });
                await gate;
                observer({ type: "step", step: "LEASE", status: "passed", detail: `lease for ${opts.model}` });
                return { ok: true, attempt: null, task: null, output: null } as never;
              };
            return Reflect.get(t, p);
          },
        }) as Orchestrator,
    });
    const id = r.backend.server.abuId;
    const a = (await r.core.invoke("wos:build", { abu: id, model: "opus" })) as { runId: string };
    const b = (await r.core.invoke("wos:build", { abu: id, model: "astra" })) as { runId: string };
    expect(a.runId).not.toBe(b.runId);
    const running = ((await r.core.invoke("wos:runs", undefined)) as RunSnapshot[]).filter((x) => x.state === "running");
    expect(running.map((x) => x.model).sort()).toEqual(["astra", "opus"]);
    release();
    await r.core.settle();
    const details = (runId: string) =>
      orch(r!.events)
        .filter((e) => e.runId === runId)
        .map((e) => (e.event as { detail: string }).detail);
    expect(details(a.runId)).toEqual(["claiming with opus", "lease for opus"]);
    expect(details(b.runId)).toEqual(["claiming with astra", "lease for astra"]);
    const done = (await r.core.invoke("wos:runs", undefined)) as RunSnapshot[];
    expect(done.map((x) => x.state)).toEqual(["passed", "passed"]);
  });

  // B-0005-desktop (ruled at 4.4.0): the orchestrator serialises mirror work per repository. The Wave 2
  // gate asks for proof: two builds, different providers, ONE real orchestrator, 10 repetitions.
  it.each(Array.from({ length: 10 }, (_, i) => i + 1))(
    "D15 with the REAL orchestrator: two concurrent builds both pass (repetition %i of 10)",
    async () => {
      r = rig({ githubLinked: true });
      await signIn(r);
      const id = r.backend.server.abuId;
      await r.core.invoke("wos:build", { abu: id, model: "opus" });
      await r.core.invoke("wos:build", { abu: id, model: "astra" });
      await r.core.settle();
      const runs = (await r.core.invoke("wos:runs", undefined)) as RunSnapshot[];
      expect(runs.map((x) => [x.state, x.code])).toEqual([
        ["passed", null],
        ["passed", null],
      ]);
    },
  );

  it("refuses a model the policy does not allow for builders before anything is claimed", async () => {
    r = rig({ githubLinked: true });
    await signIn(r);
    await expect(r.core.invoke("wos:build", { abu: r.backend.server.abuId, model: "fable" })).rejects.toThrow(/not a builder model/);
    expect(r.buildCalls).toEqual([]);
    expect(r.backend.calls.some((c) => c.includes("/claim"))).toBe(false);
  });

  it("explains NOT_ELIGIBLE and LIMIT_REACHED from the server in plain words", async () => {
    r = rig({
      githubLinked: true,
      wrap: (o) =>
        new Proxy(o, {
          get(t, p) {
            if (p === "build")
              return async (opts: { model?: string }) => ({
                ok: false,
                code: opts.model === "sol" ? "NOT_ELIGIBLE" : "LIMIT_REACHED",
                message: "refused",
                task: null,
              });
            return Reflect.get(t, p);
          },
        }) as Orchestrator,
    });
    const one = (await r.core.invoke("wos:build", { abu: r.backend.server.abuId, model: "sol" })) as { runId: string };
    const two = (await r.core.invoke("wos:build", { abu: r.backend.server.abuId, model: "astra" })) as { runId: string };
    await r.core.settle();
    const runs = (await r.core.invoke("wos:runs", undefined)) as RunSnapshot[];
    const e1 = runs.find((x) => x.id === one.runId)!;
    const e2 = runs.find((x) => x.id === two.runId)!;
    expect(e1).toMatchObject({ state: "failed", code: "NOT_ELIGIBLE" });
    expect(e1.explanation).toMatch(/^NOT ELIGIBLE\. .*not attested the CLI/);
    expect(e2).toMatchObject({ state: "failed", code: "LIMIT_REACHED" });
    expect(e2.explanation).toMatch(/already hold a build lease on this provider.*One Claude build \(OPUS\) and one Codex build/);
  });
});

describe("explainFailure", () => {
  it("tells the provider lease limit apart from exhausted repair loops (both are LIMIT_REACHED)", () => {
    expect(explainFailure("LIMIT_REACHED", "x", { kind: "build", leased: false, model: "opus" })).toMatch(/already hold a build lease/);
    expect(explainFailure("LIMIT_REACHED", "x", { kind: "build", leased: true, model: "opus" })).toMatch(/repair loop/);
    expect(explainFailure("NOT_ELIGIBLE", "x", { kind: "build", leased: false, model: "astra" })).toMatch(/with ASTRA/);
    expect(explainFailure("GITHUB_REQUIRED", "x", { kind: "build", leased: false, model: null })).toMatch(/Link a GitHub/);
  });
});

describe("contribution history, profile and settings read real API shapes", () => {
  it("a new contributor has an honest empty history", async () => {
    r = rig({ githubLinked: true });
    await signIn(r);
    const h = (await r.core.invoke("wos:contributions", undefined)) as ContributionHistory;
    expect(h).toEqual({
      handle: "octo-dev",
      profile: null,
      ledger: null,
      ledgerHiddenReason: "NO PUBLIC PROFILE YET. It appears after the first accepted contribution.",
    });
    expect(r.backend.calls).toContain("GET /v1/public/contributors/octo-dev");
  });

  it("no handle before GitHub is linked", async () => {
    r = rig();
    await signIn(r);
    const h = (await r.core.invoke("wos:contributions", undefined)) as ContributionHistory;
    expect(h.handle).toBeNull();
    expect(h.ledgerHiddenReason).toMatch(/NO HANDLE YET/);
  });

  it("status carries the toolchain attestation; my work and my events come through the orchestrator", async () => {
    r = rig({ githubLinked: true });
    await signIn(r);
    const s = (await r.core.invoke("wos:status", undefined)) as { toolchain: unknown; signedIn: boolean };
    expect(s.signedIn).toBe(true);
    expect(s.toolchain).toMatchObject({ os: "linux" });
    await r.core.invoke("wos:build", { abu: r.backend.server.abuId, model: "opus" });
    await r.core.settle();
    const work = (await r.core.invoke("wos:my-work", undefined)) as { attempts: unknown[] };
    expect(work.attempts.length).toBe(1);
    expect(await r.core.invoke("wos:my-events", { after: 0 })).toEqual({ items: [], lastId: 0 });
  });

  it("settings persist through validation; bad values are refused", async () => {
    r = rig();
    expect(await r.core.invoke("wos:set-settings", { preferredModel: "astra", eventsPollSeconds: 10 })).toMatchObject({
      preferredModel: "astra",
      eventsPollSeconds: 10,
      detachAfterSubmit: true,
    });
    await expect(r.core.invoke("wos:set-settings", { eventsPollSeconds: 1 })).rejects.toThrow(/poll interval/);
    await expect(r.core.invoke("wos:set-settings", { apiBaseUrl: "https://evil.example" })).rejects.toThrow(/unexpected field/);
  });

  it("logout clears the session", async () => {
    r = rig();
    await signIn(r);
    await r.core.invoke("wos:logout", undefined);
    expect(await r.backend.secrets.get("wos.session.v1")).toBeNull();
  });
});

describe("openExternal allowlist (S-29) through the core", () => {
  it("opens only waronsaas.com and github.com/waronsaas", async () => {
    r = rig();
    await r.core.invoke("wos:open-external", { url: "https://waronsaas.com/targets/salesforce" });
    await r.core.invoke("wos:open-external", { url: "https://github.com/waronsaas/wos/releases/latest" });
    for (const url of [
      "https://github.com/login/device",
      "http://waronsaas.com/",
      "https://evil.example/",
      "file:///etc/passwd",
      "javascript:alert(1)",
    ]) {
      await expect(r.core.invoke("wos:open-external", { url })).rejects.toThrow(/only https:\/\/waronsaas.com/);
    }
    expect(r.opened).toEqual(["https://waronsaas.com/targets/salesforce", "https://github.com/waronsaas/wos/releases/latest"]);
  });
});

describe("bridge errors", () => {
  it("serialise as CODE: message", () => {
    expect(bridgeErrorMessage(Object.assign(new Error("listClaimableAbus: NOT_FOUND: no such feature"), { code: "NOT_FOUND" }))).toBe(
      "NOT_FOUND: no such feature",
    );
    expect(bridgeErrorMessage(new Error("boom"))).toBe("INTERNAL: boom");
    expect(bridgeErrorMessage(Object.assign(new Error("x"), { code: "VALIDATION_FAILED" }))).toBe("VALIDATION_FAILED: x");
  });
});
