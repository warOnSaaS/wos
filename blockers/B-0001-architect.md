```json
{
  "id": "B-0001-architect",
  "status": "accepted",
  "raisedBy": "architect",
  "raisedAt": "2026-09-29T20:30:00Z",
  "affectedContract": "packages/contracts/src/domain.ts TaskView, AttemptView; agent-io.ts ContextPlan, ContextManifest",
  "reason": "Task, attempt and plan views take one target, but ABUs belong to shared catalog features (D10); control-plane picked the lowest-rank app.",
  "evidence": "Reported by the control-plane workstream at the Wave 1 gate (worked around without a blocker; ws/control-plane @ 4c93f85).",
  "requestedCapability": "A contract decision so the workaround can be removed.",
  "affectedWorkstreams": [
    "control-plane"
  ],
  "suggestedResolution": null,
  "decision": {
    "outcome": "accepted",
    "contractsVersion": "3.0.0",
    "note": "Roadmap work has one app; feature work (contracts, builds, implementation reviews) has one catalog feature and serves several apps. Target set only for roadmap work; feature work carries feature, relevantTo[] and repo. Never pick a representative app.",
    "decidedAt": "2026-09-29T20:30:00Z"
  }
}
```

Raised by the Lead Architect on the control-plane workstream's behalf at the Wave 1 gate.
