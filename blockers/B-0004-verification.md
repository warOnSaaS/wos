```json
{
  "id": "B-0004-verification",
  "status": "open",
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
  "decision": null
}
```

Raised by the verification workstream in Wave 1. See the evidence paths above; continuing with unaffected work.
