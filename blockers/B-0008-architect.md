```json
{
  "id": "B-0008-architect",
  "status": "accepted",
  "raisedBy": "architect",
  "raisedAt": "2026-09-29T20:30:00Z",
  "affectedContract": "state-machines.ts TaskMachine reject_output, AttemptMachine guards; BUILD-PROTOCOL sections 6-7",
  "reason": "The rule 'retry the App commit for an hour' is impossible because changeset content is not stored.",
  "evidence": "Reported by the control-plane workstream at the Wave 1 gate (worked around without a blocker; ws/control-plane @ 4c93f85).",
  "requestedCapability": "A contract decision so the workaround can be removed.",
  "affectedWorkstreams": [
    "control-plane"
  ],
  "suggestedResolution": null,
  "decision": {
    "outcome": "accepted",
    "contractsVersion": "3.0.0",
    "note": "Commit inside the request, never store content (a public repo is the store; storing content would duplicate unreviewed code in our database). Same ruling as B-0004-control-plane.",
    "decidedAt": "2026-09-29T20:30:00Z"
  }
}
```

Raised by the Lead Architect on the control-plane workstream's behalf at the Wave 1 gate.
