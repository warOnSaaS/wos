/**
 * P1 shadow accounting, first slice (contracts 5.20.0, src/shadow.ts): the shadow budget computed with the frozen
 * protocol's own pure functions and pinned policies, the receipt schemas, and the receipt hash (rule S-2: the same
 * bytes served are the bytes hashed). No DB, no model calls.
 */
import { describe, expect, it } from "vitest";
import { ShadowReceipt, type ShadowReceiptRun, shadowBudget, shadowReceiptSha256 } from "../src/index.js";
const basis = (taskKind: string, sizePoints: number) => shadowBudget(taskKind, sizePoints);

describe("shadowBudget: what the task WOULD pay under the frozen protocol (D49 model, D63 base price)", () => {
  it("a 2-point abu_build has the 8 ACU budget the protocol tests pin, and the published base price floor(8/1.2)", () => {
    const b = basis("abu_build", 2)!;
    expect(b.budgetAcuMicro).toBe("8000000");
    expect(b.basePriceAcuMicro).toBe("6666666");
    expect(b.queueBonusBp).toBe(2000);
  });

  it("an 8-point abu_build and a 1-point one scale per size point (4 ACU per point, base 0)", () => {
    expect(basis("abu_build", 8)!.budgetAcuMicro).toBe("32000000");
    expect(basis("abu_build", 1)!.budgetAcuMicro).toBe("4000000");
  });

  it("author work is a flat budget: roadmap_author 60 ACU, feature_author 30 ACU, implementation_review 4 ACU", () => {
    expect(basis("roadmap_author", 0)!.budgetAcuMicro).toBe("60000000");
    expect(basis("feature_author", 0)!.budgetAcuMicro).toBe("30000000");
    expect(basis("implementation_review", 1)!.budgetAcuMicro).toBe("4000000");
  });

  it("the pinned standard basis is stated, never implied (S-3), and the label says no value moves", () => {
    for (const kind of ["abu_build", "roadmap_author", "feature_author", "implementation_review"]) {
      const b = basis(kind, 2)!;
      expect(b.difficultyBp).toBe(10_000);
      expect(b.importanceBp).toBe(10_000);
      expect(b.label).toBe("shadow — no value");
      expect(b.policy).toEqual({ capability: "capability-policy.v2", reward: "reward-policy.v2" });
    }
  });

  it("an unknown task kind has no budget (unknown-safe, never a made-up number)", () => {
    expect(basis("no_such_kind", 2)).toBeNull();
  });
});

describe("shadowReceiptSha256: the served bytes are the hashed bytes (S-2, the C-4 pattern)", () => {
  const run: ShadowReceiptRun = {
    id: "0192f000-0000-7000-8000-0000000000aa",
    provider: "opencode_cli",
    launchProvider: "opencode-go",
    modelIdRequested: "glm",
    modelIdReported: "opencode-go/glm-5.3",
    reasoning: "high",
    inputTokens: 1000,
    outputTokens: 200,
    costUsd: 0.42,
    steps: 3,
    startedAt: "2026-09-30T00:00:00.000Z",
    endedAt: "2026-09-30T00:10:00.000Z",
    durationSeconds: 600,
    exitCode: 0,
    mode: null,
    manifestSha256: `sha256:${"a".repeat(64)}`,
    transcriptSha256: `sha256:${"b".repeat(64)}`,
    outputSha256: `sha256:${"c".repeat(64)}`,
  };
  const receipt: Omit<ShadowReceipt, "receiptSha256"> = {
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
    reasoning: "high",
    inputTokens: 1000,
    outputTokens: 200,
    costUsd: 0.42,
    runCount: 1,
    roundCount: 1,
    reviewCount: 2,
    trialLabel: null,
    outcome: {
      state: "merged",
      merged: true,
      pr: { number: 101, url: "https://github.com/waronsaas/product/pull/101" },
      contribution: "accepted",
    },
    shadowBudget: basis("abu_build", 2),
    createdAt: "2026-09-30T00:00:00.000Z",
    updatedAt: "2026-09-30T01:00:00.000Z",
    runs: [run],
    rounds: [
      {
        id: "0192f000-0000-7000-8000-0000000000ac",
        number: 1,
        state: "revealed",
        outcome: "consensus",
        independence: "independent",
        reviewLabel: null,
        trialLabel: null,
        secondSeat: "fable",
        headSha: "a".repeat(40),
        submissionSha256: `sha256:${"d".repeat(64)}`,
        openedAt: "2026-09-30T00:20:00.000Z",
        revealedAt: "2026-09-30T00:30:00.000Z",
        reviews: [
          {
            slot: "astra",
            handle: "astra-seat",
            provider: "codex_cli",
            modelId: "astra",
            reasoning: "max",
            verdict: "NO_MATERIAL_GAPS",
            independence: "independent",
            reviewLabel: null,
            bootstrapSelf: false,
            sealedAt: "2026-09-30T00:25:00.000Z",
          },
          {
            slot: "fable",
            handle: "fable-seat",
            provider: "claude_cli",
            modelId: "fable",
            reasoning: "max",
            verdict: "NO_MATERIAL_GAPS",
            independence: "independent",
            reviewLabel: null,
            bootstrapSelf: false,
            sealedAt: "2026-09-30T00:26:00.000Z",
          },
        ],
      },
    ],
  };

  it("is stable, and it is recomputable from the parsed receipt with the hash field removed", () => {
    const served = { ...receipt, receiptSha256: shadowReceiptSha256(receipt) };
    expect(ShadowReceipt.parse(served)).toBeTruthy();
    expect(shadowReceiptSha256(served)).toBe(served.receiptSha256);
    expect(served.receiptSha256).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it("changes when any served field changes (a receipt of a different contribution hashes differently)", () => {
    const served = { ...receipt, receiptSha256: shadowReceiptSha256(receipt) };
    const other = shadowReceiptSha256({ ...served, costUsd: 0.43 });
    expect(other).not.toBe(served.receiptSha256);
  });

  it("zod parsing strips unknown keys, so the hash does not depend on them (P-1 rule)", () => {
    const served = { ...receipt, receiptSha256: shadowReceiptSha256(receipt) };
    expect(shadowReceiptSha256({ ...served, secretExtra: "never hashed" } as never)).toBe(served.receiptSha256);
  });
});
