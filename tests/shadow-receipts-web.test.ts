/**
 * The /receipts page data (P1 shadow accounting, contracts 5.20.0): the pure display model in
 * apps/web/lib/receipts.mts against fixtures — the labels a non-technical reader meets, the honest
 * NOT REPORTED / UNKNOWN states, the shadow budget line (what the work WOULD pay, no value moving),
 * and the verify lines. No network, no web build, no model calls.
 */
import { describe, expect, it } from "vitest";
import {
  budgetLine,
  costLabel,
  formatAcu,
  kindLabel,
  outcomeLabel,
  reviewLabels,
  slotLabel,
  taskLabel,
  timeLabel,
  tokensLabel,
  verdictLabel,
  verifyLines,
  type Receipt,
  type ReceiptSummary,
} from "../apps/web/lib/receipts.mjs";

const budget: ReceiptSummary["shadowBudget"] = {
  label: "shadow — no value",
  policy: { capability: "capability-policy.v2", reward: "reward-policy.v2" },
  taskKind: "abu_build",
  sizePoints: 2,
  difficultyBp: 10_000,
  importanceBp: 10_000,
  budgetAcuMicro: "8000000",
  basePriceAcuMicro: "6666666",
  queueBonusBp: 2000,
};

const summary: ReceiptSummary = {
  id: "0192f000-0000-7000-8000-0000000000ab",
  kind: "abu_build",
  handle: "glm-trial",
  target: "salesforce",
  feature: "contacts",
  abu: "contacts#01",
  abuTitle: "Unit 01",
  documentKind: null,
  documentVersion: null,
  provider: "opencode_cli",
  modelId: "opencode-go/glm-5.3",
  inputTokens: 1200,
  outputTokens: 300,
  costUsd: 0.5,
  runCount: 2,
  roundCount: 1,
  reviewCount: 2,
  trialLabel: "candidate_trial:glm",
  outcome: {
    state: "merged",
    merged: true,
    pr: { number: 101, url: "https://github.com/waronsaas/product/pull/101" },
    contribution: "accepted",
  },
  shadowBudget: budget,
  createdAt: "2026-09-30T00:00:00.000Z",
  updatedAt: "2026-09-30T01:00:00.000Z",
};

const receipt: Receipt = {
  ...summary,
  runs: [
    {
      id: "0192f000-0000-7000-8000-0000000000aa",
      provider: "opencode_cli",
      launchProvider: "opencode-go",
      modelIdRequested: "glm",
      modelIdReported: "opencode-go/glm-5.3",
      inputTokens: 1200,
      outputTokens: 300,
      costUsd: 0.5,
      steps: 2,
      startedAt: "2026-09-30T00:00:00.000Z",
      durationSeconds: 600,
      exitCode: 0,
      mode: null,
      manifestSha256: `sha256:${"a".repeat(64)}`,
      transcriptSha256: `sha256:${"b".repeat(64)}`,
    },
  ],
  rounds: [
    {
      id: "0192f000-0000-7000-8000-0000000000ac",
      number: 1,
      state: "revealed",
      outcome: "consensus",
      independence: "independent",
      reviewLabel: null,
      trialLabel: "candidate_trial:glm",
      secondSeat: "fable",
      submissionSha256: `sha256:${"d".repeat(64)}`,
      headSha: "a".repeat(40),
      revealedAt: "2026-09-30T00:30:00.000Z",
      reviews: [
        { slot: "astra", handle: "astra-seat", provider: "codex_cli", modelId: "astra", verdict: "NO_MATERIAL_GAPS" },
        { slot: "human", handle: "the-founder", provider: null, modelId: null, verdict: "NO_MATERIAL_GAPS" },
      ],
    },
  ],
  receiptSha256: `sha256:${"e".repeat(64)}`,
};

describe("the receipt labels a non-technical reader meets", () => {
  it("who did what: kind, task, seats and verdicts in plain words", () => {
    expect(kindLabel("abu_build")).toBe("Build unit");
    expect(kindLabel("roadmap_author")).toBe("Roadmap author");
    expect(taskLabel(summary)).toBe("contacts#01 — Unit 01 (salesforce)");
    expect(slotLabel("astra")).toBe("Astra seat");
    expect(slotLabel("human")).toBe("Human seat");
    expect(verdictLabel("NO_MATERIAL_GAPS")).toBe("NO MATERIAL GAPS");
    expect(verdictLabel(null)).toBe("PENDING (SEALED UNTIL THE ROUND IS REVEALED)");
  });

  it("honest unknowns: a missing cost or tokens is never filled in", () => {
    expect(costLabel(null)).toBe("NOT REPORTED");
    expect(costLabel(0.5)).toBe("$0.50 as reported");
    expect(tokensLabel({ inputTokens: null, outputTokens: null })).toBe("NOT REPORTED");
    expect(tokensLabel({ inputTokens: 1200, outputTokens: 300 })).toBe("1,200 IN / 300 OUT");
    expect(timeLabel(null)).toBe("UNKNOWN");
    expect(timeLabel("2026-09-30T01:00:00.000Z")).toBe("2026-09-30 01:00 UTC");
  });

  it("the outcome in the brief's words: submitted, accepted-merged, rejected", () => {
    expect(outcomeLabel({ outcome: { state: "merged", merged: true, pr: null, contribution: "accepted" } })).toBe(
      "MERGED (CONTRIBUTION ACCEPTED)",
    );
    expect(outcomeLabel({ outcome: { state: "in_review", merged: false, pr: null, contribution: null } })).toBe("SUBMITTED (in_review)");
    expect(outcomeLabel({ outcome: { state: "closed_unmerged", merged: false, pr: null, contribution: "rejected" } })).toBe(
      "REJECTED (closed_unmerged)",
    );
  });

  it("the shadow budget: what it WOULD pay, that no value moves, and honest rounding", () => {
    expect(budgetLine(budget)).toBe("WOULD PAY 8 ACU (base price 6.666666 ACU + 20% queue bonus) — shadow — no value");
    expect(budgetLine(null)).toContain("NO BUDGET");
    expect(formatAcu("8000000")).toBe("8 ACU");
    expect(formatAcu("6666666")).toBe("6.666666 ACU");
    expect(formatAcu("60000000")).toBe("60 ACU");
    expect(formatAcu("not-a-number")).toBe("UNKNOWN");
  });

  it("the review labels the protocol pins, explained in one line each", () => {
    expect(reviewLabels(receipt.rounds[0]!)).toEqual(["candidate_trial:glm (a candidate's designated trial run)", "second seat: fable"]);
    expect(
      reviewLabels({ reviewLabel: "single_lab_review", trialLabel: null, independence: "bootstrap_self", secondSeat: "human" }),
    ).toEqual([
      "single_lab_review (Astra + the required human seat)",
      "bootstrap_self (the founder reviewed his own work in bootstrap)",
      "second seat: human",
    ]);
    expect(reviewLabels({ reviewLabel: null, trialLabel: null, independence: null, secondSeat: null })).toEqual([]);
  });

  it("the verify lines: every hash the receipt carries, in a stable order", () => {
    expect(verifyLines(receipt).map((l) => l.label)).toEqual([
      "RECEIPT HASH (recompute it from this page's JSON)",
      `RUN ${receipt.runs[0]!.id} MANIFEST HASH`,
      `RUN ${receipt.runs[0]!.id} TRANSCRIPT HASH`,
      "ROUND 1 SUBMISSION HASH",
      "ROUND 1 HEAD COMMIT",
      "PULL REQUEST",
    ]);
    expect(verifyLines(receipt)[0]!.value).toBe(receipt.receiptSha256);
  });
});
