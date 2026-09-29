/**
 * Adversarial suite, API layer: the attacks of WORKSTREAMS.md verification DONE (5) driven through the
 * frozen Routes, against the real control plane (see support/harness.ts). Skipped until the harness
 * exists; every assertion is written against contracts 1.0.0 only.
 */
import { Routes } from "@waronsaas/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { scopesOverlap } from "../../src/index.js";
import { type del, signedChangeset, upsert } from "../../src/vectors.js";
import { type Contributor, type ControlPlaneHarness, HARNESS_REASON, loadHarness } from "./support/harness.js";

const h = await loadHarness();
const path = (p: string, params: Record<string, string>) => p.replace(/:(\w+)/g, (_, k: string) => params[k] ?? `:${k}`);
const codes = (body: unknown) =>
  ((body as { validation?: { errors: { code: string }[] } }).validation?.errors ?? []).map((e) => e.code).sort();

describe.skipIf(!h)(`integration-and-e2e: API attacks${h ? "" : HARNESS_REASON}`, () => {
  const H = h as ControlPlaneHarness;
  let builder: Contributor;
  let reviewerA: Contributor;
  let reviewerB: Contributor;

  beforeAll(async () => {
    builder = await H.contributor();
    reviewerA = await H.contributor();
    reviewerB = await H.contributor();
  }, 60_000);
  afterAll(async () => {
    await H.close();
  });

  async function submit(who: Contributor, leaseId: string, body: unknown) {
    return H.request("POST", path(Routes.submitChangeset.path, { id: leaseId }), {
      token: who.accessToken,
      body,
      headers: { "Idempotency-Key": crypto.randomUUID() },
    });
  }

  // ---- S-22 / S-16 / S-17: a modified client -------------------------------------------------------
  describe("modified-client submission", () => {
    const attacks: Array<
      [string, string[], (l: { files: ReturnType<typeof upsert>[] }) => ReturnType<typeof upsert>[] | ReturnType<typeof del>[]]
    > = [
      ["workflow edit", ["WORKFLOW_FILE"], () => [upsert(".github/workflows/wos-verify.yml", "on: push\n")]],
      ["lockfile without resource", ["LOCKFILE_WITHOUT_RESOURCE"], () => [upsert("package-lock.json", "{}\n")]],
      ["out of scope", ["OUT_OF_SCOPE"], () => [upsert("modules/billing/x.ts", "x")]],
      ["wos.json", ["PROTECTED_PATH"], () => [upsert("wos.json", "{}")]],
    ];
    for (const [name, expected, files] of attacks) {
      it(`${name}: 422 with ${expected.join(", ")} and nothing reaches GitHub`, async () => {
        const abu = await H.seedAbu({
          key: `atk-${name.replace(/\W+/g, "-")}#01`,
          write: ["modules/contacts/**", "package-lock.json", "wos.json", ".github/**"],
        });
        const lease = await H.leaseReadyToSubmit(builder, abu);
        const before = H.githubCalls().length;
        const cs = signedChangeset(files({ files: [] }), {
          parent: lease.parentCommit,
          manifestSha256: lease.manifestSha256,
          key: builder.deviceKey,
          ids: { taskId: lease.taskId, leaseId: lease.leaseId, deviceId: builder.deviceId },
        });
        const res = await submit(builder, lease.leaseId, cs);
        expect(res.status).toBe(422);
        expect(codes(res.body)).toEqual(expect.arrayContaining(expected));
        expect(
          H.githubCalls()
            .slice(before)
            .filter((c) => c.method !== "GET"),
        ).toEqual([]);
      });
    }

    it("a forged submission (content swapped after signing, hashes recomputed) is refused with SIGNATURE_INVALID", async () => {
      const lease = await H.leaseReadyToSubmit(builder, await H.seedAbu({ key: "atk-forged#01", write: ["modules/contacts/**"] }));
      const cs = signedChangeset([upsert("modules/contacts/a.ts", "ok")], {
        parent: lease.parentCommit,
        manifestSha256: lease.manifestSha256,
        key: builder.deviceKey,
        ids: { taskId: lease.taskId, leaseId: lease.leaseId, deviceId: builder.deviceId },
      });
      const evil = upsert("modules/contacts/a.ts", "exfiltrate()");
      const forged = { ...cs, files: [evil] };
      const res = await submit(builder, lease.leaseId, forged);
      expect(res.status).toBe(422);
      expect(codes(res.body)).toContain("SIGNATURE_INVALID");
    });

    it("a hand-written diff with a valid signature is accepted but stays unqualified until two other people's reviews and CI", async () => {
      const lease = await H.leaseReadyToSubmit(builder, await H.seedAbu({ key: "atk-handwritten#01", write: ["modules/contacts/**"] }));
      const cs = signedChangeset([upsert("modules/contacts/hand.ts", "export {}\n")], {
        parent: lease.parentCommit,
        manifestSha256: lease.manifestSha256,
        key: builder.deviceKey,
        ids: { taskId: lease.taskId, leaseId: lease.leaseId, deviceId: builder.deviceId },
      });
      const res = await submit(builder, lease.leaseId, cs);
      expect(res.status).toBe(200);
      const att = await H.request("GET", path(Routes.getAttempt.path, { id: lease.attemptId }), { token: builder.accessToken });
      expect(JSON.stringify(att.body)).not.toMatch(/"state":"(qualified|pr_open|merged)"/);
      expect(H.githubCalls().some((c) => c.method === "POST" && /\/pulls$/.test(c.path))).toBe(false);
    });

    it("another account's lease cannot be used to submit (LEASE_NOT_HELD)", async () => {
      const lease = await H.leaseReadyToSubmit(builder, await H.seedAbu({ key: "atk-steal#01", write: ["modules/contacts/**"] }));
      const cs = signedChangeset([upsert("modules/contacts/s.ts", "x")], {
        parent: lease.parentCommit,
        manifestSha256: lease.manifestSha256,
        key: reviewerA.deviceKey,
        ids: { taskId: lease.taskId, leaseId: lease.leaseId, deviceId: reviewerA.deviceId },
      });
      const res = await submit(reviewerA, lease.leaseId, cs);
      expect(res.status).toBe(403);
    });
  });

  // ---- S-12 / S-11 / S-23: reviews ---------------------------------------------------------------------
  describe("reviews", () => {
    it("self-review outside bootstrap: the builder is never assigned their own round", async () => {
      await H.bootstrap(false);
      const round = await H.roundInReview(builder, await H.seedAbu({ key: "atk-selfreview#01", write: ["modules/contacts/**"] }));
      for (const slot of ["astra", "fable"]) {
        const res = await H.request("POST", Routes.claimReview.path, {
          token: builder.accessToken,
          body: { deviceId: builder.deviceId, slot, kinds: ["implementation_review"] },
          headers: { "Idempotency-Key": crypto.randomUUID() },
        });
        expect(JSON.stringify(res.body)).not.toContain(round.roundId);
      }
    });

    it("reviewer seeing the other slot: nothing of a sealed verdict is served to the other slot before reveal", async () => {
      await H.bootstrap(false);
      const round = await H.roundInReview(builder, await H.seedAbu({ key: "atk-seal#01", write: ["modules/contacts/**"] }));
      const claim = await H.request("POST", Routes.claimReview.path, {
        token: reviewerA.accessToken,
        body: { deviceId: reviewerA.deviceId, slot: "astra", kinds: ["implementation_review"] },
        headers: { "Idempotency-Key": crypto.randomUUID() },
      });
      const leaseId = (claim.body as { lease: { id: string } }).lease.id;
      const runId = await H.reviewAgentRun(reviewerA, leaseId);
      const canary = "CANARY sealed astra verdict";
      const verdict = {
        schema: "review-verdict.v1",
        verdict: "MATERIAL_GAPS",
        summary: canary,
        findings: [
          {
            localId: "f1",
            severity: "material",
            category: "security",
            title: canary,
            detail: canary,
            evidence: [],
            suggestedResolution: "",
          },
        ],
        priorFindings: [],
      };
      const posted = await H.request("POST", path(Routes.submitVerdict.path, { id: leaseId }), {
        token: reviewerA.accessToken,
        body: { verdict, headSha: round.headSha, submissionSha256: round.submissionSha256, agentRunId: runId },
        headers: { "Idempotency-Key": crypto.randomUUID() },
      });
      expect(posted.status).toBe(200);
      const other = await H.request("POST", Routes.claimReview.path, {
        token: reviewerB.accessToken,
        body: { deviceId: reviewerB.deviceId, slot: "fable", kinds: ["implementation_review"] },
        headers: { "Idempotency-Key": crypto.randomUUID() },
      });
      for (const res of [
        other,
        await H.request("GET", path(Routes.getAttempt.path, { id: round.attemptId }), { token: reviewerB.accessToken }),
      ]) {
        expect(JSON.stringify(res.body)).not.toContain("CANARY");
      }
    });

    it("fabricated verdict for another round: a verdict bound to another round's head is refused and not stored", async () => {
      await H.bootstrap(false);
      const r1 = await H.roundInReview(builder, await H.seedAbu({ key: "atk-fab-a#01", write: ["modules/contacts/a/**"] }));
      const r2 = await H.roundInReview(builder, await H.seedAbu({ key: "atk-fab-b#01", write: ["modules/contacts/b/**"] }));
      const claim = await H.request("POST", Routes.claimReview.path, {
        token: reviewerA.accessToken,
        body: { deviceId: reviewerA.deviceId, slot: "fable", kinds: ["implementation_review"] },
        headers: { "Idempotency-Key": crypto.randomUUID() },
      });
      const leaseId = (claim.body as { lease: { id: string } }).lease.id;
      const mine = JSON.stringify(claim.body).includes(r1.roundId) ? r1 : r2;
      const theirs = mine === r1 ? r2 : r1;
      const runId = await H.reviewAgentRun(reviewerA, leaseId);
      const verdict = { schema: "review-verdict.v1", verdict: "NO_MATERIAL_GAPS", summary: "fine", findings: [], priorFindings: [] };
      const res = await H.request("POST", path(Routes.submitVerdict.path, { id: leaseId }), {
        token: reviewerA.accessToken,
        body: {
          verdict,
          headSha: theirs.headSha === mine.headSha ? "f".repeat(40) : theirs.headSha,
          submissionSha256: theirs.submissionSha256,
          agentRunId: runId,
        },
        headers: { "Idempotency-Key": crypto.randomUUID() },
      });
      expect([409, 422]).toContain(res.status);
    });
  });

  /*
   * ---- 20 simultaneous builders: scenario design -------------------------------------------------
   * Layers: (1) DB constraints under 20 real connections (db.adversarial.test.ts: one active lease per
   * task, one live attempt per ABU, one holder per exclusive key); (2) the claim protocol itself with a
   * forced worst interleaving, with and without the per-repo advisory lock (same file); (3) the real
   * control plane over HTTP (below). Workload: 20 accounts, each with a linked 400-day GitHub and an
   * attested claude device; ABUs 0-9 own disjoint subtrees modules/rN/**, ABUs 10-14 own single files
   * inside subtrees 0-4, ABUs 15-19 duplicate subtrees 0-4. Invariants checked after the race:
   *   I1 no two live path locks overlap (scopesOverlap over every granted pair);
   *   I2 exactly ten claims win (one per distinct subtree), whatever the interleaving;
   *   I3 every loser gets 409 RESOURCE_LOCKED or CONFLICT, never 500, never a half-created attempt;
   *   I4 each ABU has at most one live attempt and one active lease;
   *   I5 one ABU claimed by 20 people yields exactly one lease.
   * Wave 3 adds: heartbeats from all 20 for 5 minutes, one killed mid-build (lease expires, ABU reopens),
   * and two of the 20 submitting at once to prove submissions on disjoint scopes both reach review.
   */
  describe("leases-and-locks: 20 simultaneous builders over HTTP", () => {
    it("20 builders claiming one ABU: exactly one lease, 19 conflicts", async () => {
      const abu = await H.seedAbu({ key: "race-one#01", write: ["modules/race-one/**"] });
      const people = await Promise.all(Array.from({ length: 20 }, () => H.contributor()));
      const res = await Promise.all(
        people.map((p) =>
          H.request("POST", path(Routes.claimBuild.path, { id: abu }), {
            token: p.accessToken,
            body: { deviceId: p.deviceId },
            headers: { "Idempotency-Key": crypto.randomUUID() },
          }),
        ),
      );
      expect(res.filter((r) => r.status === 200)).toHaveLength(1);
      expect(res.filter((r) => r.status === 409)).toHaveLength(19);
    });

    it("20 builders over 20 ABUs with overlapping scopes: granted scopes never overlap and every disjoint subtree is granted", async () => {
      const scopes = Array.from({ length: 20 }, (_, i) =>
        i < 10 ? `modules/r${i}/**` : i < 15 ? `modules/r${i - 10}/s${i}.ts` : `modules/r${i - 15}/**`,
      );
      const abus = await Promise.all(scopes.map((s, i) => H.seedAbu({ key: `race-many-${String(i).padStart(2, "0")}#01`, write: [s] })));
      const people = await Promise.all(Array.from({ length: 20 }, () => H.contributor()));
      const res = await Promise.all(
        people.map((p, i) =>
          H.request("POST", path(Routes.claimBuild.path, { id: abus[i]! }), {
            token: p.accessToken,
            body: { deviceId: p.deviceId },
            headers: { "Idempotency-Key": crypto.randomUUID() },
          }),
        ),
      );
      const granted = scopes.filter((_, i) => res[i]!.status === 200);
      for (let i = 0; i < granted.length; i++)
        for (let j = i + 1; j < granted.length; j++)
          expect(scopesOverlap(granted[i]!, granted[j]!), `${granted[i]} x ${granted[j]}`).toBe(false);
      expect(granted).toHaveLength(10);
      for (const r of res.filter((x) => x.status !== 200)) expect(JSON.stringify(r.body)).toMatch(/RESOURCE_LOCKED|CONFLICT/);
    });

    it("a lease with no heartbeat expires and the ABU can be claimed again (S-27)", async () => {
      // The harness clock is advanced by the sweep route's fake clock; asserted via the public ABU view.
      const abu = await H.seedAbu({ key: "race-expire#01", write: ["modules/race-expire/**"] });
      const first = await H.request("POST", path(Routes.claimBuild.path, { id: abu }), {
        token: builder.accessToken,
        body: { deviceId: builder.deviceId },
        headers: { "Idempotency-Key": crypto.randomUUID() },
      });
      expect(first.status).toBe(200);
      const res = await H.request("GET", Routes.cronSweep.path, {
        headers: { authorization: "Bearer test-cron", "x-wos-test-advance-minutes": "31" },
      });
      expect(res.status).toBe(200);
      const again = await H.request("POST", path(Routes.claimBuild.path, { id: abu }), {
        token: reviewerA.accessToken,
        body: { deviceId: reviewerA.deviceId },
        headers: { "Idempotency-Key": crypto.randomUUID() },
      });
      expect(again.status).toBe(200);
    });
  });

  // ---- S-1 .. S-6: identity ---------------------------------------------------------------------------
  describe("accounts and sessions", () => {
    it("S-3: the start response is identical for a known and an unknown email", async () => {
      const a = await H.request("POST", Routes.startEmailSignIn.path, {
        body: { email: builder.email, clientKind: "cli", deviceName: null, devicePublicKey: null },
        ip: "198.51.100.1",
      });
      const b = await H.request("POST", Routes.startEmailSignIn.path, {
        body: { email: "nobody-at-all@example.com", clientKind: "cli", deviceName: null, devicePublicKey: null },
        ip: "198.51.100.2",
      });
      expect(a.status).toBe(b.status);
      const shape = (x: unknown) => Object.keys(x as object).sort();
      expect(shape(a.body)).toEqual(shape(b.body));
    });

    it("S-2: a link redeemed with the wrong poll secret fails", async () => {
      const start = await H.request("POST", Routes.startEmailSignIn.path, {
        body: { email: "victim@example.com", clientKind: "cli", deviceName: null, devicePublicKey: null },
      });
      const mail = await H.lastEmail("victim@example.com");
      const res = await H.request("POST", Routes.redeemEmailSignIn.path, {
        body: {
          requestId: (start.body as { requestId: string }).requestId,
          code: mail?.code,
          pollSecret: "not-the-poll-secret",
          linkToken: null,
        },
      });
      expect(res.status).toBe(401);
    });

    it("S-6: a contributor route without a linked GitHub is 403 GITHUB_REQUIRED", async () => {
      const unlinked = await H.contributor({ github: false });
      const res = await H.request("GET", Routes.listOpenTasks.path, { token: unlinked.accessToken });
      expect(res.status).toBe(403);
      expect(JSON.stringify(res.body)).toContain("GITHUB_REQUIRED");
    });

    it("S-24: a GitHub account younger than 90 days cannot claim a build", async () => {
      const young = await H.contributor({ githubAgeDays: 30 });
      const abu = await H.seedAbu({ key: "atk-young#01", write: ["modules/young/**"] });
      const res = await H.request("POST", path(Routes.claimBuild.path, { id: abu }), {
        token: young.accessToken,
        body: { deviceId: young.deviceId },
        headers: { "Idempotency-Key": crypto.randomUUID() },
      });
      expect(res.status).toBe(403);
      expect(JSON.stringify(res.body)).toContain("NOT_ELIGIBLE");
    });
  });

  // ---- S-18 / S-19: GitHub -------------------------------------------------------------------------
  describe("the PR gate", () => {
    it("S-19: an unsigned webhook delivery is refused", async () => {
      const res = await H.request("POST", Routes.githubWebhook.path, {
        body: { action: "opened" },
        headers: { "x-github-event": "pull_request", "x-github-delivery": crypto.randomUUID(), "x-hub-signature-256": "sha256=00" },
      });
      expect(res.status).toBe(403);
    });
  });
});
