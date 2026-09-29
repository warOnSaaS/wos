```json
{
  "id": "B-0003-architect",
  "status": "accepted",
  "raisedBy": "architect",
  "raisedAt": "2026-09-29T20:30:00Z",
  "affectedContract": "packages/db schema reviews; qualification check 7",
  "reason": "reviews has no agent-run id, so qualification accepts any signed run on the reviewer's lease.",
  "evidence": "Reported by the control-plane workstream at the Wave 1 gate (worked around without a blocker; ws/control-plane @ 4c93f85).",
  "requestedCapability": "A contract decision so the workaround can be removed.",
  "affectedWorkstreams": [
    "control-plane"
  ],
  "suggestedResolution": null,
  "decision": {
    "outcome": "accepted",
    "contractsVersion": "3.0.0",
    "note": "reviews.agent_run_id (not null, unique) with trigger check_review_agent_run: the run must belong to the same lease, manifest and account and have signature_valid. submitVerdict already carries agentRunId; persist it.",
    "decidedAt": "2026-09-29T20:30:00Z"
  }
}
```

Raised by the Lead Architect on the control-plane workstream's behalf at the Wave 1 gate.
