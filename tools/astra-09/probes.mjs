// Astra review 09, Appendix B probes.mjs, adapted only in its imports: the built contracts package replaces the
// stripped function bodies (prepare.mjs), and the policies come from the same JSON. Run from the repo root after
// `npm run build -w @waronsaas/contracts`:  node tools/astra-09/probes.mjs
// Probes assert nothing about the fix; they print what the current code does (the review's Appendix A format).
import { readFileSync } from "node:fs";
import * as E from "@waronsaas/contracts/protocol";
import * as B from "@waronsaas/contracts";
const R = { ...E, redGreenRefusals: B.redGreenRefusals };
const read = (n) => JSON.parse(readFileSync(`packages/contracts/src/protocol/data/${n}.json`));
const reward = read("reward-policy.v2"),
  cap = read("capability-policy.v2"),
  completion = read("completion-policy.v1");
const params = E.engineParamsFrom(reward, completion),
  reserve = BigInt(reward.emission.emissionReserveBase);
const log = (name, result) => console.log(JSON.stringify({ name, result }, (_, v) => (typeof v === "bigint" ? v.toString() : v)));
const safe = (f) => {
  try {
    return f();
  } catch (e) {
    return { threw: e.message };
  }
};
const state = () =>
  E.computeEpoch(
    {
      epochNumber: 1,
      state: E.initialState(reserve),
      consumedIds: new Set(),
      issuances: [
        {
          taskId: "t",
          kind: "execution",
          budgetAcuMicro: 12000000n,
          featurePoolKeys: [],
          applicationPoolKeys: [],
          ...(E.V2_ISSUANCE ?? {}),
        },
      ],
    },
    params,
  );
for (const [name, claim] of Object.entries({
  self_pick: { mode: "self_pick", queueBonusBp: 2000, bonusApplies: false },
  queue: { mode: "queue", queueBonusBp: 2000, bonusApplies: true },
  omitted: undefined,
  zero_bonus: { mode: "self_pick", queueBonusBp: 0, bonusApplies: false },
})) {
  const r = safe(() => {
    const a = state(),
      reserved = a.state.reserved.get("t").amount;
    const b = E.computeEpoch(
      {
        epochNumber: 2,
        state: a.state,
        consumedIds: new Set(a.consumedIds),
        acceptances: [{ taskId: "t", shares: [{ accountId: "a", beneficiaryId: "a", shareBp: 10000 }], ...(claim ? { claim } : {}) }],
      },
      params,
    );
    E.assertConserved(reserve, b.state);
    const paid = b.allocations.filter((x) => x.receiptId === "t").reduce((s, x) => s + x.amountBase, 0n);
    const refusals = R.taskAllocationRefusals({
      reservedBase: reserved,
      receipts: [{ receiptId: "t", accountId: "a", shareBp: 10000, orgShareBp: 0 }],
      lines: [{ receiptId: "t", beneficiary: "person", amount: paid }],
    });
    return { reserved, paid, returned: b.queueBonusReturnedBase, refusals, conserved: true };
  });
  log(name, r);
}
for (const kind of ["abu_build", "abu_revision", "architecture_author"])
  log(
    `budget_${kind}`,
    R.budgetModelMicro(
      { capabilityBudgets: cap.budgets, model: reward.budgets.model, humanReviewWeights: {}, bugs: reward.bugs },
      { taskKind: kind, sizePoints: 2, difficultyBp: 10000, importanceBp: 10000, ...(kind.startsWith("abu") ? { severity: "high" } : {}) },
    ),
  );
const green = {
  bug: "BUG-21",
  feature: "unrelated",
  regressionTest: "features/unrelated/acceptance/regressions/BUG-21.spec.ts",
  parent: { sha: "a".repeat(40), conclusion: "failure", failedTests: ["features/unrelated/acceptance/regressions/BUG-21.spec.ts"] },
  head: { sha: "b".repeat(40), conclusion: "success", failedTests: [] },
  testSha256: `sha256:${"c".repeat(64)}`,
};
const route = {
  acceptance: reward.acceptance,
  contributionType: "BUG_FIX",
  slice: "execution",
  evidenceClass: "accepted_budget",
  taskKind: "execution",
  hasLease: true,
  receiptAccountId: "fixer",
  taskId: "fix-BUG-20",
  humanReview: null,
  bugFix: {
    outcome: "fix",
    effectiveSeverity: "high",
    budgetSeverity: "high",
    redGreen: green,
    fixerTriagedIt: false,
    fixerIsBarredIntroducer: false,
  },
};
log(
  "unrelated_red_green",
  safe(() => R.receiptRouteRefusals(route)),
);
log(
  "fix_disguised_as_implementation",
  safe(() =>
    R.receiptRouteRefusals({
      ...route,
      contributionType: "IMPLEMENTATION",
      bugFix: { ...route.bugFix, redGreen: null, fixerTriagedIt: true, fixerIsBarredIntroducer: true },
    }),
  ),
);
log(
  "correction_after_issue",
  safe(() => R.receiptRouteRefusals({ ...route, bugFix: { ...route.bugFix, effectiveSeverity: "low" } })),
);
for (const status of ["ACTIVE", "RATIFIED", "FINAL_BY_SILENCE", "PROVISIONAL", "REVOKED"])
  log(
    `R08-1_${status}`,
    R.allocationChallengeRefusals({
      epochState: "PROPOSED",
      nowMs: 1,
      windowClosesAtMs: 2,
      receiptStatus: status,
      frozenReceiptSha256: "h",
      currentReceiptSha256: "h",
      publishedAllocationsRoot: "r",
      citedAllocationsRoot: "r",
      allocationOfReceiptInEpoch: true,
      challengerIsAccusedOrRelated: false,
      alreadyChallengedUndecided: false,
    }),
  );
for (const n of [0n, 1n, 5n, 1001n, 1200n, 999999999999999999n]) {
  const b = E.queueBasePrice(n, 2000);
  log("rounding", { reserved: n, base: b, returned: n - b });
}
