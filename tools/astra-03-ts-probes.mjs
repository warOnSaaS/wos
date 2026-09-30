// Astra review 03 TypeScript probes (the .jsonl cases plus two more). Needs built contracts: npm run build -w @waronsaas/contracts.
// Output before the fix is recorded in docs/protocol/reviews/ASTRA-REVIEW-03-repros-prefix.txt; the fixed behaviour is asserted in packages/contracts/test/protocol.test.ts.
import * as P from "../packages/contracts/dist/protocol/index.js";
import { readFileSync } from "node:fs";
const reward = JSON.parse(readFileSync(new URL("../packages/contracts/src/protocol/data/reward-policy.v1.json", import.meta.url), "utf8"));
const completion = JSON.parse(
  readFileSync(new URL("../packages/contracts/src/protocol/data/completion-policy.v1.json", import.meta.url), "utf8"),
);
const base = P.engineParamsFrom(reward, completion);
const p = { ...base, emissionReserve: 1000n, budgetPpm: 0n, holdbackBp: 0n };
const st = (o) => ({ ...P.initialState(1000n), ...o });
const show = (name, f) => {
  try {
    const r = f();
    console.log(
      name,
      "=>",
      JSON.stringify(r, (_k, v) => (typeof v === "bigint" ? v.toString() : v instanceof Map ? Object.fromEntries(v) : v)),
    );
  } catch (e) {
    console.log(name, "=> THROWS", e.message);
  }
};
show(
  "return_identified_only_by_event_not_entitlement",
  () =>
    P.computeEpoch(
      {
        epochNumber: 1,
        state: st({ remainingReserve: 900n, cumulativeIssued: 100n }),
        receipts: [],
        returns: [
          { id: "x1", kind: "unbound_expiry", beneficiaryId: "nobody", amount: 80n },
          { id: "x2", kind: "unbound_expiry", beneficiaryId: "nobody", amount: 20n },
        ],
      },
      p,
    ).state,
);
show(
  "confiscation_exceeds_proven_excess",
  () =>
    P.computeEpoch(
      {
        epochNumber: 1,
        state: st({ remainingReserve: 900n, cumulativeIssued: 100n }),
        receipts: [],
        confiscations: [{ id: "c", beneficiaryId: "a", holdbackBase: 0n, unclaimedBase: 100n, provenExcessBase: 1n, bounties: [] }],
      },
      p,
    ).state,
);
show(
  "holdback_policy_changes_old_tranches",
  () =>
    P.computeEpoch(
      {
        epochNumber: 2,
        state: st({ remainingReserve: 950n, cumulativeIssued: 50n, holdback: [{ beneficiaryId: "a", epochNumber: 1, amount: 50n }] }),
        receipts: [],
      },
      { ...p, holdbackEpochs: 1 },
    ).entitlements,
);
const tiers = {
  routine: { thresholdBp: 6000, turnoutLockedBp: 1000, turnoutContributionBp: 1000 },
  structural: { thresholdBp: 7000, turnoutLockedBp: 1000, turnoutContributionBp: 1000 },
  governance: { thresholdBp: 7500, turnoutLockedBp: 1000, turnoutContributionBp: 1000 },
  emergency_ratification: { thresholdBp: 5001, turnoutLockedBp: 1000, turnoutContributionBp: 1000 },
};
const raw = [{ accountId: "org", organizationId: "O", locked: 900n, contribution: 900n }];
for (let i = 0; i < 50; i++) raw.push({ accountId: `act${i}`, organizationId: null, locked: 0n, contribution: 2n });
for (let i = 0; i < 50; i++) raw.push({ accountId: `pas${i}`, organizationId: null, locked: 2n, contribution: 0n });
const capped = P.applyWeightCaps(raw, { perWalletCapBp: 500, orgCapBp: 1000 });
const tally = P.tallyDualMajority([{ accountId: "org", choice: "yes" }], capped, {
  tiers,
  lockedVoterMustHaveContributed: true,
  mode: "dual_majority",
});
const eligLocked = capped.filter((w) => w.contribution > 0n).reduce((t, w) => t + w.locked, 0n);
show("caps_before_eligibility", () => ({
  feasible: capped.feasible,
  orgLockedShareOfEligibleBp: Number((capped.find((w) => w.accountId === "org").locked * 10000n) / eligLocked),
  tally,
}));
show(
  "feasible_lost_on_copy",
  () =>
    P.tallyDualMajority(
      [{ accountId: "org", choice: "yes" }],
      [
        ...P.applyWeightCaps(
          [
            { accountId: "a", organizationId: "O", locked: 1n, contribution: 1n },
            { accountId: "b", organizationId: "Q", locked: 1n, contribution: 1n },
          ],
          { perWalletCapBp: 500, orgCapBp: 1000 },
        ),
      ],
      { tiers, lockedVoterMustHaveContributed: true, mode: "dual_majority" },
    ).reasons,
);
const big = 9007199254740991;
show("aggregate_usage_overflow", () =>
  P.parseClaudeStream([
    JSON.stringify({ type: "assistant", message: { id: "m1", usage: { input_tokens: big } } }),
    JSON.stringify({ type: "assistant", message: { id: "m2", usage: { input_tokens: big } } }),
  ]),
);
show("missing_rollout_response_id", () =>
  P.parseCodexRollout([JSON.stringify({ type: "token_usage_record", payload: { usage: { input_tokens: 10, output_tokens: 5 } } })]),
);
show("empty_adapter", () => P.parseClaudeStream([]));
const one = (w) => ({
  receiptId: w.id,
  accountId: "a",
  beneficiaries: [
    { beneficiaryId: "a", shareBp: 5000 },
    { beneficiaryId: "b", shareBp: 5000 },
  ],
  slice: "execution",
  weightMicro: w.w,
  featurePoolKeys: [],
  applicationPoolKeys: [],
});
const pr = {
  ...base,
  emissionReserve: 1_000_000_000n,
  budgetPpm: 1000n,
  holdbackBp: 0n,
  rateCeilingInitialBasePerAcu: 100_000_000n * 1_000_000n,
};
show("split_sponsored_rounding", () => ({
  one: P.computeEpoch({ epochNumber: 1, state: P.initialState(1_000_000_000n), receipts: [one({ id: "r", w: 2n })] }, pr).entitlements,
  split: P.computeEpoch(
    { epochNumber: 1, state: P.initialState(1_000_000_000n), receipts: [one({ id: "r1", w: 1n }), one({ id: "r2", w: 1n })] },
    pr,
  ).entitlements,
}));
show("trailing_rate_not_previous_epoch_bound", () => {
  const trailing = (100_000_000n * 3n + 1_000_000n) / 4n;
  return {
    trailing,
    ceiling: P.computeEpoch(
      {
        epochNumber: 5,
        state: P.initialState(base.emissionReserve),
        trailingRateBasePerAcu: trailing,
        receipts: [
          { receiptId: "q", accountId: "a", slice: "execution", weightMicro: 1_000_000n, featurePoolKeys: [], applicationPoolKeys: [] },
        ],
      },
      base,
    ).rateCeilingBasePerAcu,
  };
});
show(
  "late_completion_correction_after_payout",
  () =>
    P.computeEpoch(
      {
        epochNumber: 2,
        state: st({ remainingReserve: 1000n }),
        receipts: [],
        accrualCorrections: [{ id: "k", poolKey: "paid", amount: 5n }],
      },
      p,
    ).state,
);
