```json
{
  "id": "B-0004-verification",
  "status": "accepted",
  "raisedBy": "verification",
  "raisedAt": "2026-09-29T18:18:19Z",
  "affectedContract": "docs/architecture/SECURITY.md S-16 SECRET_DETECTED; CONTEXT-PROTOCOL.md 'another slot's current verdict'",
  "reason": "Two controls cannot be tested as written. (1) S-16 says SECRET_DETECTED fires on 'the secret patterns in SECURITY.md', but SECURITY.md lists no patterns. (2) checkManifestAgainstPlan must reject 'an artifact ref that is another slot's current verdict', but no ref scheme names a verdict (only wos:findings/<subject>@<n>, which by definition holds revealed rounds), so there is nothing concrete to reject.",
  "evidence": "SECURITY.md S-16; CONTEXT-PROTOCOL.md lines 57, 109, 231. Verification proposed a pattern list in packages/verification/src/secrets.ts (private keys, AWS, GitHub, Anthropic, OpenAI, Slack, Stripe live, Google, npm, Resend, non-local Postgres URLs with passwords).",
  "requestedCapability": "SECURITY.md adopts (or amends) the pattern list in packages/verification/src/secrets.ts as normative. CONTEXT-PROTOCOL states the rule as: a reviewer manifest may reference wos:findings only at round <= current-1, and the server rejects any server_document ref not in the plan.",
  "affectedWorkstreams": [
    "architect",
    "context-policy",
    "verification"
  ],
  "suggestedResolution": null,
  "decision": {
    "outcome": "accepted",
    "contractsVersion": "2.0.0",
    "note": "accepted. (1) packages/verification/src/secrets.ts is the normative SECRET_DETECTED list (SECURITY.md S-16), changes reviewed by the architect (GAPS G-53). (2) The verdict rule is stated in CONTEXT-PROTOCOL.md: wos:verdict/<roundId>/<slot> is reserved and never planned; the server rejects any server_document ref not in the plan; reviewer plans may include wos:findings only up to the previous round.",
    "decidedAt": "2026-09-29T19:30:00Z"
  }
}
```

Raised by the verification workstream in Wave 1. See the evidence paths above; continuing with unaffected work.
