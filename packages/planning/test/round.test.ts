import { ReviewVerdict } from "@waronsaas/contracts";
import { describe, expect, it } from "vitest";
import { computeRoundOutcome, type RoundOutcome } from "../src/index.js";
import { F1, F2, finding, verdict } from "./fixtures.js";

const M = (id: string) => finding(id, "material");
const m = (id: string) => finding(id, "minor");

interface Row {
  name: string;
  astra: ReturnType<typeof verdict>;
  fable: ReturnType<typeof verdict>;
  prior?: string[];
  overruled?: string[];
  want: RoundOutcome;
}

/** computeRoundOutcome table (REVIEW-PROTOCOL.md section 6 step 3). */
const TABLE: Row[] = [
  {
    name: "roadmap-consensus R-002 both NO_MATERIAL_GAPS, nothing open -> consensus",
    astra: verdict(),
    fable: verdict(),
    want: { outcome: "consensus" },
  },
  {
    name: "roadmap-consensus R-002 one MATERIAL_GAPS verdict -> gaps",
    astra: verdict([M("f1")]),
    fable: verdict(),
    want: { outcome: "gaps", openMaterialFindings: 1 },
  },
  {
    name: "both slots find material gaps: each finding counts",
    astra: verdict([M("f1"), M("f2")]),
    fable: verdict([M("f1")]),
    want: { outcome: "gaps", openMaterialFindings: 3 },
  },
  { name: "minor findings never block", astra: verdict([m("f1"), m("f2")]), fable: verdict([m("f1")]), want: { outcome: "consensus" } },
  {
    name: "minor plus material: only material counts",
    astra: verdict([m("f1"), M("f2")]),
    fable: verdict([m("f1")]),
    want: { outcome: "gaps", openMaterialFindings: 1 },
  },
  {
    name: "prior finding resolved by both re-checkers -> consensus",
    astra: verdict([], [[F1, "resolved"]]),
    fable: verdict([], [[F1, "resolved"]]),
    want: { outcome: "consensus" },
  },
  {
    name: "prior finding still_open for one re-checker -> gaps",
    astra: verdict([], [[F1, "resolved"]]),
    fable: verdict([], [[F1, "still_open"]]),
    want: { outcome: "gaps", openMaterialFindings: 1 },
  },
  {
    name: "prior finding still_open for both counts once",
    astra: verdict([], [[F1, "still_open"]]),
    fable: verdict([], [[F1, "still_open"]]),
    prior: [F1],
    want: { outcome: "gaps", openMaterialFindings: 1 },
  },
  {
    name: "prior open finding nobody re-checked (caller passes it) -> gaps, even with two clean verdicts",
    astra: verdict(),
    fable: verdict(),
    prior: [F2],
    want: { outcome: "gaps", openMaterialFindings: 1 },
  },
  {
    name: "prior still_open plus a new material finding",
    astra: verdict([M("f1")], [[F1, "still_open"]]),
    fable: verdict(),
    prior: [F1, F2],
    want: { outcome: "gaps", openMaterialFindings: 3 },
  },
  {
    name: "overruled prior finding a reviewer still holds open does not block",
    astra: verdict([], [[F1, "still_open"]]),
    fable: verdict(),
    overruled: [F1],
    want: { outcome: "consensus" },
  },
  {
    name: "overruled finding passed as prior is excluded, another open one still blocks",
    astra: verdict(),
    fable: verdict([], [[F2, "still_open"]]),
    prior: [F1, F2],
    overruled: [F1],
    want: { outcome: "gaps", openMaterialFindings: 1 },
  },
  {
    name: "overruling never hides a NEW material finding",
    astra: verdict([M("f1")]),
    fable: verdict(),
    overruled: [F1, F2],
    want: { outcome: "gaps", openMaterialFindings: 1 },
  },
];

describe("computeRoundOutcome", () => {
  for (const row of TABLE) {
    it(row.name, () => {
      expect(ReviewVerdict.safeParse(row.astra).success).toBe(true);
      expect(ReviewVerdict.safeParse(row.fable).success).toBe(true);
      const input = { astra: row.astra, fable: row.fable, priorOpenFindingIds: row.prior ?? [], overruledFindingIds: row.overruled ?? [] };
      expect(computeRoundOutcome(input)).toEqual(row.want);
      // Symmetric in the two slots, and pure.
      expect(computeRoundOutcome({ ...input, astra: row.fable, fable: row.astra })).toEqual(row.want);
    });
  }
});
