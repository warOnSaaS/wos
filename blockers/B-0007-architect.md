```json
{
  "id": "B-0007-architect",
  "status": "accepted",
  "raisedBy": "architect",
  "raisedAt": "2026-09-29T20:30:00Z",
  "affectedContract": "ROADMAP-PROTOCOL.md; verification_runs; progress input profileAcceptancePassed",
  "reason": "Feature BUILT can never reach 100% because profile acceptance CI results are not recorded.",
  "evidence": "Reported by the control-plane workstream at the Wave 1 gate (worked around without a blocker; ws/control-plane @ 4c93f85).",
  "requestedCapability": "A contract decision so the workaround can be removed.",
  "affectedWorkstreams": [
    "control-plane"
  ],
  "suggestedResolution": null,
  "decision": {
    "outcome": "accepted",
    "contractsVersion": "3.0.0",
    "note": "One check run per profile on each default-branch push, named profileAcceptanceCheckName(feature, target) = wos-acceptance/<feature>/<target>; the control plane records it as verification_runs (subject profile_acceptance) and emits verification.recorded; profileAcceptancePassed = latest run on a commit containing the last relevant merge concluded success. Verification adds the jobs to wos-verify.yml.",
    "decidedAt": "2026-09-29T20:30:00Z"
  }
}
```

Raised by the Lead Architect on the control-plane workstream's behalf at the Wave 1 gate.
