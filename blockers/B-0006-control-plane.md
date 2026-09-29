```json
{
  "id": "B-0006-control-plane",
  "status": "open",
  "raisedBy": "control-plane",
  "raisedAt": "2026-09-29T15:40:00-04:00",
  "affectedContract": "packages/contracts/src/api.ts ApiError and Routes.submitChangeset (where a 422 carries ChangesetValidation)",
  "reason": "BUILD-PROTOCOL section 6 says a refused submission answers '422 with ChangesetValidation'. The control plane sends the ApiError envelope {error: {code: 'SCOPE_VIOLATION', details: ChangesetValidation}} (every non-2xx is an ApiError). Verification's adversarial suite reads the codes from a top-level `validation` field. Both readings fit the prose; the contract does not say which.",
  "evidence": "tests/adversarial/api.adversarial.test.ts codes() reads body.validation.errors; services/control-plane/src/handlers/work.ts submitChangeset throws ApiFailure('SCOPE_VIOLATION', ..., result). With createTestHarness exported, 5 attacks (workflow edit, lockfile, out of scope, wos.json, forged signature) get the right 422 SCOPE_VIOLATION but fail on the field name.",
  "requestedCapability": "State where ChangesetValidation lives in a 422 SCOPE_VIOLATION: error.details (current) or a top-level validation field beside error.",
  "affectedWorkstreams": ["control-plane", "verification", "github-build"],
  "suggestedResolution": "PATCH: document error.details = ChangesetValidation for SCOPE_VIOLATION in api.ts (the orchestrator already reads details); verification reads error.details.errors.",
  "decision": null
}
```

Also for verification (not a contract gap): two review attacks turn bootstrap off and then claim reviews with fresh harness contributors, who hold no accepted contribution, so the policy correctly refuses them (NOT_ELIGIBLE, `minAcceptedContributions` = 1). Either keep bootstrap on for those attacks or give the reviewers a prior accepted contribution in the test.
