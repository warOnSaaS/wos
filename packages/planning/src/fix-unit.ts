/**
 * D61 (contracts 5.7.0): deterministic validation of a FIX unit, the ABU a triage decision creates when the code
 * diverges from a merged contract. No contract version bump: the unit is added at the feature's current merged
 * version. When the contract itself is wrong, a contract revision opens instead (TriageDecision outcome
 * contract_revision) and this validator is not used.
 */
import { type AbuSpec, ARTIFACT_PATHS, type FeatureContract, type FixUnitErrorCode, regressionTestPattern } from "@waronsaas/contracts";
import { inScope } from "@waronsaas/verification";

export interface FixUnitIssue {
  code: FixUnitErrorCode;
  message: string;
}

const baseOf = (scope: string) => (scope.endsWith("/**") ? scope.slice(0, -3) : scope);
const under = (scope: string, root: string) => {
  const b = baseOf(scope);
  return b === root || b.startsWith(`${root}/`);
};

/**
 * Rules: marked as a fix; key inside the feature; writes only inside `modules/<feature>/**` and
 * `features/<feature>/acceptance/**`; every requirement exists in the merged contract; the regression test sits at
 * `<a profile's acceptance dir>/regressions/<bug>.*`, inside the write scope and listed in acceptance.tests;
 * no architectural element is changed (exclusive `arch:`).
 */
export function validateFixUnit(unit: AbuSpec, contract: FeatureContract): FixUnitIssue[] {
  const out: FixUnitIssue[] = [];
  const add = (code: FixUnitErrorCode, message: string) => out.push({ code, message });
  const feature = contract.feature;
  if (!unit.fix) {
    add("FIX_NOT_MARKED", `${unit.key} has no fix marker (bug and regression test)`);
    return out;
  }
  if (!unit.key.startsWith(`${feature}#`)) add("FIX_KEY_NOT_IN_FEATURE", `${unit.key} must be a unit of ${feature}`);
  const roots = [ARTIFACT_PATHS.module(feature), ARTIFACT_PATHS.acceptanceDir(feature)];
  for (const s of unit.scope.write)
    if (!roots.some((r) => under(s, r)))
      add("FIX_SCOPE_OUTSIDE_FEATURE", `${unit.key} writes ${s}; a fix stays inside ${roots.map((r) => `${r}/**`).join(" and ")}`);
  const known = new Set(contract.requirements.map((r) => r.key));
  for (const r of unit.requirements)
    if (!known.has(r)) add("FIX_REQUIREMENT_UNKNOWN", `${unit.key} restores ${r}, which is not in ${feature} v${contract.version}`);
  const test = unit.fix.regressionTest;
  const dirs = contract.profiles.flatMap((p) => p.acceptance.map((a) => a.dir));
  if (!dirs.some((d) => regressionTestPattern(d, unit.fix!.bug).test(test)))
    add(
      "FIX_REGRESSION_TEST_OUTSIDE_ACCEPTANCE",
      `${unit.key}: the regression test must be <acceptance dir>/regressions/${unit.fix.bug}.<ext> in one of ${dirs.join(", ")}`,
    );
  if (!unit.acceptance.tests.includes(test) || !unit.scope.write.some((s) => inScope(test, s)))
    add("FIX_REGRESSION_TEST_NOT_DECLARED", `${unit.key}: ${test} must be in acceptance.tests and inside the write scope`);
  for (const r of unit.resources)
    if (r.key.startsWith("arch:") && r.mode === "exclusive")
      add("FIX_CHANGES_ARCHITECTURE", `${unit.key} claims ${r.key} exclusive; changing an element needs an architecture record (D60)`);
  return out;
}
