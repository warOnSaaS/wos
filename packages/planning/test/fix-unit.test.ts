/** D61 (contracts 5.7.0): fix units, one failing fixture per FixUnitErrorCode. */
import { type AbuSpec, FixUnitErrorCode, PRODUCT_REPO } from "@waronsaas/contracts";
import { describe, expect, it } from "vitest";
import { validateFixUnit } from "../src/index.js";
import { clone, contract } from "./fixtures.js";

const TEST = "features/contacts/acceptance/acme-crm/web/regressions/BUG-42.spec.ts";
const fixUnit = (): AbuSpec => ({
  repo: PRODUCT_REPO,
  key: "contacts#09",
  title: "Fix BUG-42: search ignores accents",
  objective: "Contact search matches names regardless of accents, as R-001 requires.",
  requirements: ["R-001"],
  dependsOn: [],
  sizePoints: 2,
  scope: { write: ["modules/contacts/api/search.ts", TEST], read: [] },
  resources: [],
  fix: { bug: "BUG-42", regressionTest: TEST },
  acceptance: { checks: [{ id: "test", run: ["npm", "test"] }], tests: [TEST] },
});
const run = (mut: (u: AbuSpec) => void = () => {}) => {
  const u = clone(fixUnit());
  mut(u);
  return [...new Set(validateFixUnit(u, contract()).map((i) => i.code))];
};

const CASES: Record<FixUnitErrorCode, (u: AbuSpec) => void> = {
  FIX_NOT_MARKED: (u) => delete u.fix,
  FIX_KEY_NOT_IN_FEATURE: (u) => (u.key = "deals#09"),
  FIX_SCOPE_OUTSIDE_FEATURE: (u) => u.scope.write.push("modules/deals/api/search.ts"),
  FIX_REQUIREMENT_UNKNOWN: (u) => (u.requirements = ["R-099"]),
  FIX_REGRESSION_TEST_OUTSIDE_ACCEPTANCE: (u) => {
    const t = "features/contacts/acceptance/acme-crm/web/BUG-42.spec.ts";
    u.fix!.regressionTest = t;
    u.acceptance.tests = [t];
    u.scope.write = ["modules/contacts/api/search.ts", t];
  },
  FIX_REGRESSION_TEST_NOT_DECLARED: (u) => (u.acceptance.tests = []),
  FIX_CHANGES_ARCHITECTURE: (u) => u.resources.push({ key: "arch:data-layer", mode: "exclusive" }),
};

describe("validateFixUnit (D61)", () => {
  it("the valid fix unit passes", () => expect(run()).toEqual([]));
  it("covers every FixUnitErrorCode", () => expect(Object.keys(CASES).sort()).toEqual([...FixUnitErrorCode.options].sort()));
  for (const code of FixUnitErrorCode.options) it(`fix-unit ${code}`, () => expect(run(CASES[code])).toEqual([code]));
  it("the regression test may live in any profile's acceptance dir of the contract", () => {
    const t = "features/contacts/acceptance/other-crm/web/regressions/BUG-42.test.ts";
    const move = (u: AbuSpec) => {
      u.fix!.regressionTest = t;
      u.acceptance.tests = [t];
      u.scope.write = ["modules/contacts/**", "features/contacts/acceptance/**"];
    };
    expect(run(move)).toEqual([]);
  });
});
