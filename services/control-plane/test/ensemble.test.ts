/**
 * D73 ensemble authoring in the control plane (contracts 5.20.0): a revision merged from N shadow runs names them in its
 * summary; each must be the caller's signed shadow run of the same task on the very manifest of the revision. The PR
 * reports the stability, and is labelled low-stability (not blocked) below the policy's targets.
 */
import type { EnsembleRecord } from "@waronsaas/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type Account, CRON_SECRET, createHarness, HAS_DB, type Harness, manifestFor, signedRun } from "./support/harness.js";
import { authorRevision, roadmapFiles } from "./support/roadmap-fixture.js";

describe.skipIf(!HAS_DB)("D73 ensemble revisions", () => {
  let h: Harness;
  let founder: Account;
  let author: Account;
  beforeAll(async () => {
    h = await createHarness();
    founder = await h.contributor("en-founder", { maintainer: true });
    author = await h.contributor("en-author");
  });
  afterAll(async () => {
    await h?.close();
  });
  const dispatch = () => h.call("GET", "/v1/cron/dispatch", { headers: { authorization: `Bearer ${CRON_SECRET}` } });

  /** One shadow run as the orchestrator does it: claim, manifest, a signed run labelled shadow, release. */
  async function shadowRun(acct: Account, taskId: string, extra: Record<string, unknown> = { mode: "shadow" }) {
    const claim = await h.call("POST", `/v1/tasks/${taskId}/claim`, {
      token: acct.token,
      idem: true,
      body: { deviceId: acct.deviceId, model: "opus" },
    });
    expect(claim.status, JSON.stringify(claim.body)).toBe(200);
    const leaseId = claim.body.lease.id as string;
    const m = await manifestFor(h, claim.body.contextPlan, "roadmap_author");
    expect((await h.call("POST", `/v1/leases/${leaseId}/manifest`, { token: acct.token, idem: true, body: m })).status).toBe(200);
    const run = await h.call("POST", `/v1/leases/${leaseId}/agent-runs`, {
      token: acct.token,
      idem: true,
      body: signedRun(acct.key, claim.body.contextPlan, leaseId, acct.deviceId, m.manifestSha256, extra),
    });
    expect(run.status, JSON.stringify(run.body)).toBe(200);
    const rel = await h.call("POST", `/v1/leases/${leaseId}/release`, { token: acct.token, idem: true, body: { reason: "shadow" } });
    expect(rel.status, JSON.stringify(rel.body)).toBe(200);
    return { leaseId, agentRunId: run.body.agentRunId as string, manifestSha256: m.manifestSha256 };
  }

  const record = (runs: EnsembleRecord["runs"], belowTarget: string[]): EnsembleRecord => ({
    runs,
    threshold: 2,
    majority: "strict_majority",
    decisions: 0,
    stability: {
      capabilitiesMatchBp: 10_000,
      featuresMatchBp: belowTarget.includes("features") ? 6000 : 10_000,
      weightSpearman: null,
      groundingBp: 10_000,
      belowTarget,
    },
  });
  const summary = (ensemble: EnsembleRecord) => ({
    schema: "author-summary.v1" as const,
    summary: "Merged from the shadow runs.",
    responses: [],
    proposalsAddressed: [],
    ensemble,
  });

  it("refuses an ensemble that names a run which is not a shadow run of this task; accepts the real one and labels the PR", async () => {
    const opened = await h.call("POST", "/v1/admin/targets/shopify/roadmaps", {
      token: founder.token,
      idem: true,
      body: { reason: "Open shopify" },
    });
    expect(opened.status, JSON.stringify(opened.body)).toBe(200);
    const taskId = opened.body.taskId as string;
    const a = await shadowRun(author, taskId);
    const b = await shadowRun(author, taskId);
    const notShadow = await shadowRun(author, taskId, {});
    const files = roadmapFiles({ target: "shopify", feature: "online-storefront" });

    // A run that is not labelled shadow: refused, and nothing is committed.
    const bad = await authorRevision(h, author, taskId, files, {
      model: "opus",
      summary: summary(record([a, notShadow], ["features"])),
    });
    expect(bad.res.status, JSON.stringify(bad.res.body)).toBe(400);
    expect(bad.res.body.error).toMatchObject({ code: "VALIDATION_FAILED", details: { runs: [notShadow.agentRunId] } });
    await h.call("POST", `/v1/leases/${bad.claim.body.lease.id}/release`, { token: author.token, idem: true, body: { reason: "retry" } });

    // The same run named twice: refused.
    const twice = await authorRevision(h, author, taskId, files, { model: "opus", summary: summary(record([a, a], [])) });
    expect(twice.res.status).toBe(400);
    await h.call("POST", `/v1/leases/${twice.claim.body.lease.id}/release`, { token: author.token, idem: true, body: { reason: "retry" } });

    // Two shadow runs of this task on this manifest, below the features target: accepted; the PR says so and is labelled.
    const ok = await authorRevision(h, author, taskId, files, { model: "opus", summary: summary(record([a, b], ["features"])) });
    expect(ok.res.status, JSON.stringify(ok.res.body)).toBe(200);
    expect(ok.manifest.manifestSha256).toBe(a.manifestSha256);
    await dispatch();
    const pr = h.github.prs.find((p) => p.head === "wos/roadmap/shopify/v1")!;
    expect(pr.labels).toContain("low-stability");
    expect(pr.body).toContain("**Ensemble (D73):** 2 shadow runs on one manifest");
    expect(pr.body).toContain("| features matched | 60.0% | 80.0% | BELOW |");
  });
});
