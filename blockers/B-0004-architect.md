```json
{
  "id": "B-0004-architect",
  "status": "accepted",
  "raisedBy": "architect",
  "raisedAt": "2026-09-29T20:30:00Z",
  "affectedContract": "docs/architecture/SECURITY.md S-1, S-4",
  "reason": "Token hashing: SECURITY.md said SHA-256, the checklist gives SESSION_TOKEN_PEPPER; control-plane used HMAC-SHA256 with the pepper.",
  "evidence": "Reported by the control-plane workstream at the Wave 1 gate (worked around without a blocker; ws/control-plane @ 4c93f85).",
  "requestedCapability": "A contract decision so the workaround can be removed.",
  "affectedWorkstreams": [
    "control-plane"
  ],
  "suggestedResolution": null,
  "decision": {
    "outcome": "accepted",
    "contractsVersion": "3.0.0",
    "note": "HMAC-SHA256 with SESSION_TOKEN_PEPPER is normative for sign-in tokens, codes, poll secrets and session tokens; SECURITY.md updated. Column names (*_hash) unchanged.",
    "decidedAt": "2026-09-29T20:30:00Z"
  }
}
```

Raised by the Lead Architect on the control-plane workstream's behalf at the Wave 1 gate.
