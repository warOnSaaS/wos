```json
{
  "id": "B-0004-context-policy",
  "status": "accepted",
  "raisedBy": "context-policy",
  "raisedAt": "2026-09-29T20:27:06Z",
  "affectedContract": "packages/agent-policy/package.json dependencies (lockfile is architect-owned, WORKSTREAMS.md section 1 rule 4)",
  "reason": "The D13 toolchain step (AGENT-POLICY.md 'Toolchain eligibility') makes checkEligibility decide whether an ABU's write scopes can touch a repo's toolchainRequirements paths, which are picomatch globs (artifacts.ts RepoManifest.toolchainRequirements). agent-policy declares only @waronsaas/contracts, and workstreams may not edit dependencies. The code imports picomatch, which resolves only because the workspace hoists it (context-engine and planning declare it).",
  "evidence": "packages/agent-policy/src/index.ts scopeCanTouchGlob (import picomatch); packages/agent-policy/test/eligibility.test.ts 'toolchain (D13)' rows; packages/context-engine/package.json and packages/planning/package.json already depend on picomatch ^4.0.7 with @types/picomatch.",
  "requestedCapability": "Add \"picomatch\": \"^4.0.7\" to packages/agent-policy dependencies and \"@types/picomatch\" to its devDependencies (no lockfile change: both are already installed at those versions).",
  "affectedWorkstreams": [
    "context-policy",
    "architect"
  ],
  "suggestedResolution": "Architect adds the two lines at the Wave 2b gate. No code change needed; a local glob matcher would duplicate picomatch semantics and could disagree with verification's and planning's matching.",
  "decision": {
    "outcome": "accepted",
    "contractsVersion": "4.4.0",
    "note": "accepted: picomatch and @types/picomatch declared in packages/agent-policy.",
    "decidedAt": "2026-09-30T02:00:00Z"
  }
}
```

Notes:

- Two builder facts are now required inputs and fail closed when absent, so the control plane (11.3 control-plane items) must pass them at claim: `activeBuildLeasesByProvider` (`LEASE_FACTS_REQUIRED`) and `toolchain: { writeScopes, requirements, attestation }` (`TOOLCHAIN_FACTS_REQUIRED`). Both are optional in the TypeScript type so existing callers still compile; a builder evaluation without them is not eligible.
- `checkEligibility` accepts `claimedModel`; the plan's budget for the chosen model is `effectiveBudget(role, model.ref)` (exported).
- Codex builders ignore `plan.allowedCommands` (codex has no per-command allowlist; already on the policy's UNVERIFIED list).
