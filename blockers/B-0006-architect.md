```json
{
  "id": "B-0006-architect",
  "status": "accepted",
  "raisedBy": "architect",
  "raisedAt": "2026-09-29T20:30:00Z",
  "affectedContract": "packages/contracts/src/events.ts; DOMAIN-MODEL.md section 3",
  "reason": "Attempt creation was emitted as attempt.state_changed from 'none'.",
  "evidence": "Reported by the control-plane workstream at the Wave 1 gate (worked around without a blocker; ws/control-plane @ 4c93f85).",
  "requestedCapability": "A contract decision so the workaround can be removed.",
  "affectedWorkstreams": [
    "control-plane"
  ],
  "suggestedResolution": null,
  "decision": {
    "outcome": "accepted",
    "contractsVersion": "3.0.0",
    "note": "Creation is not a transition: creating an aggregate in its initial state writes <aggregate>.created. New event attempt.created {attemptId, abu, state: 'leased'}; DOMAIN-MODEL section 3 states the rule.",
    "decidedAt": "2026-09-29T20:30:00Z"
  }
}
```

Raised by the Lead Architect on the control-plane workstream's behalf at the Wave 1 gate.
