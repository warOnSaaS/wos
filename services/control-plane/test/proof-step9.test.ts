/**
 * V1 proof step 9 (Amendment 01, WORKSTREAMS 12.2): the Sniper List tracks Salesforce progress independently of CRM
 * entitlement or install state. Real merged work gives Salesforce a non-zero snapshot; then CRM is enabled, disabled,
 * re-enabled and suspended for an organization, with the event consumers run after each change, and the Salesforce
 * snapshot (rows and API answer) never moves. Application progress for CRM reads the same records.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { recomputeTarget } from "../src/domain/progress.js";
import { manifest, personalOrg, publish } from "./support/apps.js";
import { buildAndSubmit, reviewAs } from "./support/flow.js";
import { CRON_SECRET, createHarness, HAS_DB, type Harness, seedFeature, verdict, webhookHeaders } from "./support/harness.js";

describe.skipIf(!HAS_DB)("V1 proof step 9: target progress is independent of application entitlements", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await createHarness();
  });
  afterAll(async () => {
    await h?.close();
  });

  it("toggling CRM enabled, disabled and suspended leaves the Salesforce progress snapshot unchanged", async () => {
    const cron = { authorization: `Bearer ${CRON_SECRET}` };
    const dispatch = async () => expect((await h.call("GET", "/v1/cron/dispatch", { headers: cron })).status).toBe(200);

    // Real merged work on salesforce: contacts#01 (2 of 4 size points) built, reviewed and merged.
    const seeded = await seedFeature(h.owner, {
      abus: [
        { n: "01", write: ["modules/contacts/a/**"] },
        { n: "02", write: ["modules/contacts/b/**"] },
      ],
    });
    const builder = await h.contributor("step9-builder");
    const b = await buildAndSubmit(h, builder, seeded.abus.get("01")!, [{ path: "modules/contacts/a/x.ts", content: "a\n" }]);
    expect(b.submit.status, JSON.stringify(b.submit.body)).toBe(200);
    const head = h.github.commits.at(-1)!.sha;
    const suite = {
      action: "completed",
      repository: { full_name: "waronsaas/product" },
      check_suite: { id: 9, head_sha: head, conclusion: "success" },
    };
    await h.call("POST", "/v1/github/webhook", { body: suite, headers: webhookHeaders("check_suite", suite) });
    await reviewAs(h, await h.contributor("step9-astra"), "astra", "implementation_review", verdict("NO_MATERIAL_GAPS"));
    await reviewAs(h, await h.contributor("step9-fable"), "fable", "implementation_review", verdict("NO_MATERIAL_GAPS"));
    await dispatch();
    const pr = h.github.prs.at(-1)!;
    const merged = {
      action: "closed",
      repository: { full_name: "waronsaas/product" },
      pull_request: { number: pr.number, merged: true, merge_commit_sha: "f".repeat(40), user: { login: "waronsaas-wos[bot]" } },
    };
    expect((await h.call("POST", "/v1/github/webhook", { body: merged, headers: webhookHeaders("pull_request", merged) })).status).toBe(
      200,
    );
    await dispatch();

    const snapshot = async () => {
      const rows = await h.owner<
        { id: string; scope: string; mapped_bp: number; specified_bp: number; built_bp: number; input_sha256: string }[]
      >`
        select id, scope, mapped_bp, specified_bp, built_bp, input_sha256 from wos.progress_snapshots
         where target_id = ${seeded.targetId} order by id`;
      const api = await h.call("GET", "/v1/public/targets/salesforce/progress");
      const target = await h.call("GET", "/v1/public/targets/salesforce");
      expect(api.status).toBe(200);
      return { rows, api: api.body, progress: target.body.progress };
    };
    const recompute = () =>
      h.owner.begin(async (tx) => {
        await tx`select set_config('wos.actor_kind', 'system', true), set_config('wos.actor_id', '', true)`;
        return recomputeTarget(tx as never, h.deps, seeded.targetId, null);
      });
    // Settle: the snapshot reflects the records; recomputing again writes nothing.
    await recompute();
    const base = await snapshot();
    expect(base.progress.builtBp).toBe(5000);
    expect(base.rows.length).toBeGreaterThan(0);
    expect(await recompute()).toBe(false);

    // CRM (with its Contacts module) in the registry; it answers salesforce.
    const maint = await h.contributor("step9-maint", { maintainer: true });
    expect((await publish(h, maint.token, manifest("contacts", { kind: "module" }))).status).toBe(200);
    const crm = manifest("crm", {
      requires: [{ id: "contacts", version: "^0.1.0" }],
      features: ["contacts"],
      replaces: ["salesforce"],
      desktop: true,
    });
    expect((await publish(h, maint.token, crm)).status).toBe(200);
    await dispatch();
    expect(await snapshot()).toEqual(base);

    const owner = await h.signIn("step9-owner@example.com");
    const org = await personalOrg(h, owner.token);
    const toggle = async (action: "enable" | "disable", expectedRowVersion: number | null) => {
      const r = await h.call("POST", `/v1/orgs/${org}/apps/crm/${action}`, {
        token: owner.token,
        idem: true,
        body: { expectedRowVersion },
      });
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      return r.body.entitlement.rowVersion as number;
    };
    const unchanged = async (label: string) => {
      await dispatch();
      expect(await recompute(), `${label}: recompute found a different input`).toBe(false);
      expect(await snapshot(), label).toEqual(base);
    };

    let v = await toggle("enable", null);
    await unchanged("enabled");
    v = await toggle("disable", v);
    await unchanged("disabled");
    v = await toggle("enable", v);
    await unchanged("re-enabled");
    // Suspension is a system/maintainer transition (billing lapse or abuse); no route performs it in V1.
    await h.owner`update wos.app_entitlements set state = 'suspended', suspended_reason = 'test: billing lapse', row_version = row_version + 1
                   where organization_id = ${org} and app_id = 'crm' and state = 'enabled'`;
    await unchanged("suspended");
    await toggle("disable", v + 1);
    await unchanged("disabled after suspension");

    // The application view reads the same merged records: web (the only tagged surface) is 2 of 4 points.
    const app = await h.call("GET", "/v1/public/apps/crm/progress");
    expect(app.body).toMatchObject({ basis: "release", builtBp: 5000, relevantPoints: 4, mergedPoints: 2, complete: false });
    expect(app.body.surfaces.find((s: { surface: string }) => s.surface === "web")).toMatchObject({
      builtBp: 5000,
      relevantPoints: 4,
      mergedPoints: 2,
    });
    expect(h.violations).toEqual([]);
  });
});
