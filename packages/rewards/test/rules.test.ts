import { LedgerEntryDraft, RewardCategory } from "@waronsaas/contracts";
import { describe, expect, it } from "vitest";
import {
  type AwardFact,
  computeBalances,
  computeLedgerDrafts,
  computeReleaseDrafts,
  featureCompletionPoolTotal,
  type RewardFacts,
  RewardFactsError,
} from "../src/index.js";
import { ALICE, accepted, at, award, BOB, CAROL, contribution, ev, facts, NOW, schedule, u } from "./support.js";

const SHA = "a".repeat(40);
const run = (e: Parameters<typeof computeLedgerDrafts>[0], f: RewardFacts) => computeLedgerDrafts(e, f, schedule);
const amounts = (ds: LedgerEntryDraft[]) => Object.fromEntries(ds.map((d) => [d.accountId, d.amount]));

// ---------------------------------------------------------------------------------------------- DONE 2
// One describe per RewardCategory; each asserts the acceptance condition and its negation.

describe("implementation: accepted when its PR merged", () => {
  const c = contribution({
    category: "implementation",
    implementation: { attemptId: u(0xa7), abuId: u(0xab), abuKey: "contacts#01", sizePoints: 3, merged: true },
  });

  it("pays 20 x size points once, held for 14 days", () => {
    const [d, ...rest] = run(accepted(c), facts({ contribution: c }));
    expect(rest).toEqual([]);
    expect(d).toMatchObject({
      accountId: ALICE,
      kind: "award",
      bucket: "held",
      amount: 60,
      category: "implementation",
      contributionId: c.id,
      idempotencyKey: `award:implementation:${u(0xa7)}:${ALICE}`,
      scheduleVersion: "rewards.v1",
      releaseAfter: at(14),
    });
  });

  it("pays nothing when the PR did not merge or the contribution is not accepted", () => {
    const notMerged = { ...c, implementation: { ...c.implementation!, merged: false } };
    expect(run(accepted(notMerged), facts({ contribution: notMerged }))).toEqual([]);
    for (const state of ["pending", "rejected", "reversed"] as const) {
      const s = { ...c, state };
      expect(run(accepted(s), facts({ contribution: s }))).toEqual([]);
    }
  });
});

describe("review: accepted when the subject is accepted and the review was not invalidated (G-13)", () => {
  const base = {
    reviewId: u(0x7e),
    sizePoints: null as number | null,
    subjectAccepted: true,
    schemaValid: true,
    onTime: true,
    invalidated: false,
  };
  const mk = (r: Partial<typeof base> & { subjectKind: "roadmap" | "feature_contract" | "implementation" }) =>
    contribution({ category: "review", review: { ...base, ...r } });

  it("pays a flat amount per valid, on-time review: roadmap 40, contract 20, implementation 4 x size", () => {
    const roadmap = mk({ subjectKind: "roadmap" });
    const contract = mk({ subjectKind: "feature_contract" });
    const impl = mk({ subjectKind: "implementation", sizePoints: 3 });
    expect(run(accepted(roadmap), facts({ contribution: roadmap }))[0]?.amount).toBe(40);
    expect(run(accepted(contract), facts({ contribution: contract }))[0]?.amount).toBe(20);
    const [d] = run(accepted(impl), facts({ contribution: impl }));
    expect(d).toMatchObject({ amount: 12, category: "review", idempotencyKey: `award:review:${u(0x7e)}:${ALICE}` });
  });

  it("pays nothing for a rejected subject, an invalid, late or invalidated review", () => {
    for (const bad of [{ subjectAccepted: false }, { schemaValid: false }, { onTime: false }, { invalidated: true }]) {
      const c = mk({ subjectKind: "roadmap", ...bad });
      expect(run(accepted(c), facts({ contribution: c }))).toEqual([]);
    }
  });

  it("has no per-finding component: the flat pay is the whole review award", () => {
    const c = mk({ subjectKind: "roadmap" });
    const ds = run(accepted(c), facts({ contribution: c, findingsRaised: 9 }));
    expect(ds).toHaveLength(1);
    expect(ds[0]!.amount).toBe(schedule.review.roadmapReview);
  });

  it("refuses an implementation review without size points", () => {
    const c = mk({ subjectKind: "implementation" });
    expect(() => run(accepted(c), facts({ contribution: c }))).toThrow(RewardFactsError);
  });
});

describe("review_finding: accepted when resolved after a fix or upheld by a ruling, max 5 per review", () => {
  const mk = (f: Partial<NonNullable<ReturnType<typeof contribution>["finding"]>>) =>
    contribution({
      category: "review_finding",
      finding: { findingId: u(0xf1), reviewId: u(0x7e), material: true, state: "resolved", paidRank: 0, ...f },
    });

  it("pays the upheld-finding bonus for resolved and upheld material findings", () => {
    for (const state of ["resolved", "upheld"] as const) {
      const c = mk({ state });
      expect(run(accepted(c), facts({ contribution: c }))).toMatchObject([
        { amount: 5, category: "review_finding", idempotencyKey: `award:review_finding:${u(0xf1)}:${ALICE}` },
      ]);
    }
  });

  it("pays nothing for overruled, open or disputed findings, non-material ones, or past the cap", () => {
    for (const f of [
      { state: "overruled" as const },
      { state: "open" as const },
      { state: "disputed" as const },
      { material: false },
      { paidRank: 5 },
    ]) {
      const c = mk(f);
      expect(run(accepted(c), facts({ contribution: c }))).toEqual([]);
    }
    const fifth = mk({ paidRank: 4 });
    expect(run(accepted(fifth), facts({ contribution: fifth }))).toHaveLength(1);
  });

  it("a ruling event alone pays nothing (the finding contribution's acceptance pays)", () => {
    const e = ev({ type: "finding.ruled", visibility: "public", payload: { findingId: u(0xf1), decision: "upheld", confirmedBy: BOB } });
    expect(run(e, facts({ contribution: mk({ state: "upheld" }) }))).toEqual([]);
  });
});

describe("roadmap_work and feature_contract_work: pools split pro rata when the version merges", () => {
  const doc = u(0xd0c);
  const merged = (kind: "roadmap" | "feature_contract") =>
    ev({ type: "document.merged", visibility: "public", payload: { documentId: doc, kind, mergeSha: SHA, prNumber: 7 } });
  const authors = [
    { contributionId: u(0xc1), accountId: ALICE, acceptedRevisions: 2 },
    { contributionId: u(0xc2), accountId: BOB, acceptedRevisions: 1 },
  ];

  it("splits 1000 over a merged roadmap version by accepted revisions (largest remainder)", () => {
    const ds = run(merged("roadmap"), facts({ documentPool: { documentId: doc, kind: "roadmap", authors } }));
    expect(amounts(ds)).toEqual({ [ALICE]: 667, [BOB]: 333 });
    expect(ds.every((d) => d.category === "roadmap_work" && d.idempotencyKey.startsWith(`award:roadmap_work:${doc}:`))).toBe(true);
  });

  it("splits 200 over a merged contract version the same way", () => {
    const ds = run(merged("feature_contract"), facts({ documentPool: { documentId: doc, kind: "feature_contract", authors } }));
    expect(amounts(ds)).toEqual({ [ALICE]: 133, [BOB]: 67 });
    expect(ds.every((d) => d.category === "feature_contract_work")).toBe(true);
  });

  it("merges several contributions of one author and names the first", () => {
    const ds = run(
      merged("roadmap"),
      facts({
        documentPool: {
          documentId: doc,
          kind: "roadmap",
          authors: [...authors, { contributionId: u(0xc0), accountId: ALICE, acceptedRevisions: 1 }],
        },
      }),
    );
    expect(amounts(ds)).toEqual({ [ALICE]: 750, [BOB]: 250 });
    expect(ds.find((d) => d.accountId === ALICE)!.contributionId).toBe(u(0xc0));
  });

  it("pays nothing per revision, nothing without a merge and nothing to authors without accepted revisions", () => {
    const c = contribution({ category: "roadmap_work" });
    expect(run(accepted(c), facts({ contribution: c }))).toEqual([]);
    const abandoned = ev({ type: "document.abandoned", visibility: "public", payload: { documentId: doc, reason: "stale" } });
    expect(run(abandoned, facts({ documentPool: { documentId: doc, kind: "roadmap", authors } }))).toEqual([]);
    const ds = run(
      merged("roadmap"),
      facts({ documentPool: { documentId: doc, kind: "roadmap", authors: [{ ...authors[1]!, acceptedRevisions: 0 }, authors[0]!] } }),
    );
    expect(amounts(ds)).toEqual({ [ALICE]: 1000 });
  });

  it("refuses facts for another document", () => {
    expect(() => run(merged("roadmap"), facts({ documentPool: { documentId: u(1), kind: "roadmap", authors } }))).toThrow(RewardFactsError);
  });
});

describe("architecture_resolution: accepted when a maintainer confirms the ruling", () => {
  it("pays 30 for a confirmed ruling and nothing otherwise", () => {
    const ok = contribution({ category: "architecture_resolution", resolution: { rulingId: u(0x5), confirmedByMaintainer: true } });
    expect(run(accepted(ok), facts({ contribution: ok }))).toMatchObject([
      { amount: 30, idempotencyKey: `award:architecture_resolution:${u(0x5)}:${ALICE}` },
    ]);
    const no = contribution({ category: "architecture_resolution", resolution: { rulingId: u(0x5), confirmedByMaintainer: false } });
    expect(run(accepted(no), facts({ contribution: no }))).toEqual([]);
  });
});

describe("security: accepted at creation by a maintainer award", () => {
  it("pays by severity with the same key the control plane's award_security writes", () => {
    const expected = { low: 25, medium: 100, high: 300, critical: 1000 } as const;
    for (const severity of ["low", "medium", "high", "critical"] as const) {
      const c = contribution({ category: "security", security: { severity, reference: "GHSA-xxxx" } });
      expect(run(accepted(c), facts({ contribution: c }))).toMatchObject([
        { amount: expected[severity], category: "security", idempotencyKey: `award:security:${c.id}:${ALICE}` },
      ]);
    }
    const noSeverity = contribution({ category: "security" });
    expect(run(accepted(noSeverity), facts({ contribution: noSeverity }))).toEqual([]);
  });
});

describe("feature_completion_pool: fires when an app's profile completes", () => {
  const pool = u(0x9001);
  const built = (target: string, to = "built") =>
    ev({ type: "app_feature.state_changed", visibility: "public", payload: { target, feature: "contacts", from: "building", to } });
  const basis = [
    { ...award({ id: u(0xe1), accountId: ALICE, amount: 60 }), abuId: u(0xab1) },
    { ...award({ id: u(0xe2), accountId: BOB, amount: 40 }), abuId: u(0xab2) },
    { ...award({ id: u(0xe3), accountId: CAROL, amount: 500, reversed: true }), abuId: u(0xab3) },
  ];
  const f = facts({
    featurePool: { poolId: pool, target: "hubspot", feature: "contacts", appFeatureId: u(0xaf), implementationAwards: basis },
  });

  it("pays 10% of the live implementation tokens, split pro rata to implementers", () => {
    expect(featureCompletionPoolTotal(basis, schedule)).toBe(10);
    const ds = run(built("hubspot"), f);
    expect(amounts(ds)).toEqual({ [ALICE]: 6, [BOB]: 4 });
    expect(ds[0]).toMatchObject({
      category: "feature_completion_pool",
      poolId: pool,
      contributionId: null,
      idempotencyKey: `award:feature_completion_pool:${pool}:${ds[0]!.accountId}`,
    });
  });

  it("pays nothing on any other transition", () => {
    for (const to of ["building", "specifying", "descoped"]) expect(run(built("hubspot", to), f)).toEqual([]);
  });

  it("refuses the facts of another app's pool", () => {
    expect(() => run(built("salesforce"), f)).toThrow(RewardFactsError);
  });
});

describe("application_completion_pool: fires when an app's BUILT reaches 10000", () => {
  const pool = u(0x9002);
  const progress = (builtBp: number) =>
    ev({
      type: "progress.recomputed",
      visibility: "public",
      payload: { target: "hubspot", mappedBp: 10000, specifiedBp: 10000, builtBp, roadmapVersion: 1, inputSha256: "x" },
    });
  const f = facts({
    applicationPool: {
      poolId: pool,
      target: "hubspot",
      earnedByAccount: [
        { accountId: ALICE, tokens: 300 },
        { accountId: BOB, tokens: 100 },
        { accountId: CAROL, tokens: 0 },
      ],
    },
  });

  it("splits 10000 pro rata to lifetime tokens earned on the app", () => {
    expect(amounts(run(progress(10000), f))).toEqual({ [ALICE]: 7500, [BOB]: 2500 });
  });

  it("pays nothing below 100%", () => {
    expect(run(progress(9999), f)).toEqual([]);
  });
});

it("covers every RewardCategory (DONE 2 bookkeeping)", () => {
  const tested = [
    "implementation",
    "review",
    "review_finding",
    "roadmap_work",
    "feature_contract_work",
    "architecture_resolution",
    "security",
    "feature_completion_pool",
    "application_completion_pool",
  ];
  expect([...tested].sort()).toEqual([...RewardCategory.options].sort());
});

// ---------------------------------------------------------------------------------------------- DONE 1

describe("purity and idempotency by key (DONE 1)", () => {
  const impl = contribution({
    category: "implementation",
    implementation: { attemptId: u(0xa7), abuId: u(0xab), abuKey: "contacts#01", sizePoints: 2, merged: true },
  });
  const doc = u(0xd0c);
  const cases: Array<[string, Parameters<typeof computeLedgerDrafts>[0], RewardFacts]> = [
    ["implementation", accepted(impl), facts({ contribution: impl })],
    [
      "roadmap pool",
      ev({ type: "document.merged", visibility: "public", payload: { documentId: doc, kind: "roadmap", mergeSha: SHA, prNumber: 1 } }),
      facts({
        documentPool: {
          documentId: doc,
          kind: "roadmap",
          authors: [
            { contributionId: u(0xc1), accountId: ALICE, acceptedRevisions: 1 },
            { contributionId: u(0xc2), accountId: BOB, acceptedRevisions: 1 },
            { contributionId: u(0xc3), accountId: CAROL, acceptedRevisions: 1 },
          ],
        },
      }),
    ],
    [
      "reversal",
      ev({ type: "contribution.reversed", visibility: "public", payload: { contributionId: u(0xc0), reason: "reverted" } }),
      facts({ awards: [award({ id: u(0xe1) }), award({ id: u(0xe2), released: true })] }),
    ],
  ];

  for (const [name, e, f] of cases) {
    it(`replaying ${name} yields identical drafts and keys, whatever the clock`, () => {
      const first = run(e, f);
      expect(first.length).toBeGreaterThan(0);
      const snapshot = structuredClone(f);
      const again = run(e, { ...f, now: at(30) });
      expect(again).toEqual(first);
      expect(f).toEqual(snapshot); // inputs are not mutated
      expect(new Set(first.map((d) => d.idempotencyKey)).size).toBe(first.length);
      for (const d of first) expect(LedgerEntryDraft.safeParse(d).success).toBe(true);
    });
  }

  it("does not depend on the order of the facts", () => {
    const [, e, f] = cases[1]!;
    const shuffled = { ...f, documentPool: { ...f.documentPool!, authors: [...f.documentPool!.authors].reverse() } };
    expect(run(e, shuffled)).toEqual(run(e, f));
  });

  it("refuses facts naming another contribution", () => {
    expect(() => run(accepted(impl), facts({ contribution: { ...impl, id: u(0xdead) } }))).toThrow(RewardFactsError);
  });

  it("pays nothing when the facts a rule needs were not loaded (fail closed)", () => {
    expect(run(accepted(impl), facts())).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------- DONE 4

describe("a merged ABU relevant to two apps (D10, DONE 4)", () => {
  const shared = contribution({
    id: u(0xc5),
    category: "implementation",
    implementation: { attemptId: u(0xa75), abuId: u(0xab5), abuKey: "contacts#03", sizePoints: 5, merged: true },
  });

  it("pays its implementer once and counts toward both apps' pools", () => {
    const paid = run(accepted(shared), facts({ contribution: shared }));
    expect(paid).toHaveLength(1);
    expect(paid[0]!.amount).toBe(100);
    // The key names the attempt, never a target: a second app cannot pay the same unit again.
    expect(paid[0]!.idempotencyKey).toBe(`award:implementation:${u(0xa75)}:${ALICE}`);

    const sharedAward = { ...award({ id: u(0xe5), amount: 100, contributionId: shared.id }), abuId: u(0xab5) };
    const hubspotOnly = { ...award({ id: u(0xe6), accountId: BOB, amount: 100 }), abuId: u(0xab6) };
    const pool = (target: string, poolId: string, implementationAwards: Array<AwardFact & { abuId: string }>) =>
      run(
        ev({
          type: "app_feature.state_changed",
          visibility: "public",
          payload: { target, feature: "contacts", from: "building", to: "built" },
        }),
        facts({ featurePool: { poolId, target, feature: "contacts", appFeatureId: poolId, implementationAwards } }),
      );

    const hubspot = pool("hubspot", u(0x9101), [sharedAward, hubspotOnly]);
    const salesforce = pool("salesforce", u(0x9102), [sharedAward]);
    expect(amounts(hubspot)).toEqual({ [ALICE]: 10, [BOB]: 10 });
    expect(amounts(salesforce)).toEqual({ [ALICE]: 10 });
    // Each app's pool is its own row: different keys, so both fire and neither replaces the other.
    expect(hubspot.map((d) => d.poolId)).toEqual([u(0x9101), u(0x9101)]);
    expect(salesforce[0]!.idempotencyKey).not.toBe(hubspot.find((d) => d.accountId === ALICE)!.idempotencyKey);

    // Across everything, Alice's implementation is paid exactly once.
    const all = [...paid, ...hubspot, ...salesforce];
    expect(all.filter((d) => d.category === "implementation")).toHaveLength(1);
  });

  it("refuses a pool basis listing the same award twice", () => {
    const a = { ...award({ id: u(0xe5) }), abuId: u(0xab5) };
    expect(() =>
      run(
        ev({
          type: "app_feature.state_changed",
          visibility: "public",
          payload: { target: "hubspot", feature: "contacts", from: "building", to: "built" },
        }),
        facts({ featurePool: { poolId: u(1), target: "hubspot", feature: "contacts", appFeatureId: u(2), implementationAwards: [a, a] } }),
      ),
    ).toThrow(RewardFactsError);
  });
});

// ---------------------------------------------------------------------------------------------- DONE 5

describe("bootstrap_self awards are held until an independent re-review (DONE 5)", () => {
  const c = contribution({
    category: "implementation",
    independence: "bootstrap_self",
    implementation: { attemptId: u(0xa7), abuId: u(0xab), abuKey: "contacts#01", sizePoints: 1, merged: true },
  });

  it("awards into held and says so publicly", () => {
    const [d] = run(accepted(c, at(-20)), facts({ contribution: c, bootstrapSelfReviewed: true }));
    expect(d).toMatchObject({ kind: "award", bucket: "held", amount: 20 });
    expect(d!.memo).toContain("held until an independent re-review passes");
  });

  it("is not released after the hold window while the re-review is outstanding", () => {
    const held = award({ id: u(0xe1), releaseAfter: at(-6), blockedByBootstrap: true });
    expect(computeReleaseDrafts([held], NOW)).toEqual([]);
  });

  it("is released once the independent re-review passed", () => {
    const ok = award({ id: u(0xe1), releaseAfter: at(-6), blockedByBootstrap: false });
    expect(computeReleaseDrafts([ok], NOW)).toHaveLength(2);
  });

  it("is voided when the independent re-review finds gaps", () => {
    const held = award({ id: u(0xe1), blockedByBootstrap: true });
    const revealed = (independence: "independent" | "bootstrap_self", outcome: "gaps" | "consensus") =>
      ev({
        type: "round.revealed",
        visibility: "public",
        payload: { roundId: u(0x40), subjectKind: "implementation", subjectId: u(0xa7), outcome, materialFindings: 1, independence },
      });
    const f = facts({ reReview: { roundId: u(0x40), awards: [held] } });
    expect(run(revealed("independent", "gaps"), f)).toMatchObject([
      { kind: "void", bucket: "held", amount: -60, relatedEntryId: u(0xe1), idempotencyKey: `void:${u(0xe1)}` },
    ]);
    expect(run(revealed("independent", "consensus"), f)).toEqual([]);
    expect(run(revealed("bootstrap_self", "gaps"), f)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------- DONE 6

describe("no draft for merely opening a PR (DONE 6)", () => {
  it("attempt.pr_opened, attempt.created and lease events never produce drafts, even with facts present", () => {
    const c = contribution({
      category: "implementation",
      implementation: { attemptId: u(0xa7), abuId: u(0xab), abuKey: "contacts#01", sizePoints: 8, merged: true },
    });
    const f = facts({ contribution: c, awards: [award({ id: u(0xe1) })] });
    const events = [
      ev({
        type: "attempt.pr_opened",
        visibility: "public",
        payload: { attemptId: u(0xa7), abu: "contacts#01", prNumber: 12, prUrl: "https://github.com/waronsaas/product/pull/12" },
      }),
      ev({ type: "attempt.created", visibility: "public", payload: { attemptId: u(0xa7), abu: "contacts#01", state: "leased" } }),
      ev({ type: "lease.issued", visibility: "private", payload: { leaseId: u(1), taskId: u(2), accountId: ALICE } }),
      ev({
        type: "attempt.merged",
        visibility: "public",
        payload: { attemptId: u(0xa7), abu: "contacts#01", mergeSha: SHA, prNumber: 12 },
      }),
      ev({ type: "document.revision_submitted", visibility: "public", payload: { documentId: u(3), taskId: u(4), headSha: SHA } }),
    ];
    for (const e of events) expect(run(e, f)).toEqual([]);
  });

  it("a pending contribution (PR open, not merged) earns nothing", () => {
    const c = contribution({
      category: "implementation",
      state: "pending",
      implementation: { attemptId: u(0xa7), abuId: u(0xab), abuKey: "contacts#01", sizePoints: 8, merged: false },
    });
    expect(run(accepted(c), facts({ contribution: c }))).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------- reversals, releases, balances

describe("reversals, releases and derived balances", () => {
  const reversed = ev({
    type: "contribution.reversed",
    visibility: "public",
    payload: { contributionId: u(0xc0), reason: "reverted as defective" },
  });

  it("voids held awards, claws back released ones, and skips already reversed ones", () => {
    const ds = run(
      reversed,
      facts({
        awards: [award({ id: u(0xe1) }), award({ id: u(0xe2), released: true, amount: 20 }), award({ id: u(0xe3), reversed: true })],
      }),
    );
    expect(ds.map((d) => [d.idempotencyKey, d.kind, d.bucket, d.amount])).toEqual([
      [`clawback:${u(0xe2)}`, "clawback", "available", -20],
      [`void:${u(0xe1)}`, "void", "held", -60],
    ]);
    expect(() => run(reversed, facts({ awards: [award({ id: u(0xe1), contributionId: u(0xbad) })] }))).toThrow(RewardFactsError);
  });

  it("releases as a pair with one deterministic pair id, only after the hold window", () => {
    const a = award({ id: u(0xe1), releaseAfter: at(-1) });
    const ds = computeReleaseDrafts([a, award({ id: u(0xe2), releaseAfter: at(1) }), award({ id: u(0xe3), released: true })], NOW);
    expect(ds.map((d) => d.idempotencyKey)).toEqual([`release:${u(0xe1)}:available`, `release:${u(0xe1)}:held`]);
    expect(ds[0]!.pairId).toBe(ds[1]!.pairId);
    expect(ds[0]!.amount + ds[1]!.amount).toBe(0);
    expect(computeReleaseDrafts([a], NOW)).toEqual(ds);
  });

  it("derives held, available and score like v_balances (debits never lower the score)", () => {
    const e = (kind: LedgerEntryDraft["kind"], bucket: LedgerEntryDraft["bucket"], amount: number) => ({
      accountId: ALICE,
      kind,
      bucket,
      amount,
    });
    const [b] = computeBalances([
      e("award", "held", 60),
      e("award", "held", 40),
      e("release", "held", -60),
      e("release", "available", 60),
      e("void", "held", -40),
      e("debit", "available", -10),
    ]);
    expect(b).toEqual({ accountId: ALICE, held: 0, available: 50, score: 60 });
    const [c] = computeBalances([
      e("award", "held", 20),
      e("release", "held", -20),
      e("release", "available", 20),
      e("clawback", "available", -20),
    ]);
    expect(c).toMatchObject({ held: 0, available: 0, score: 0 });
  });
});
