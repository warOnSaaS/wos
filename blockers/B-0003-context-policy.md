```json
{
  "id": "B-0003-context-policy",
  "status": "open",
  "raisedBy": "context-policy",
  "raisedAt": "2026-09-29T18:47:05Z",
  "affectedContract": "packages/contracts/src/agent-io.ts ContextPlan (no round number); packages/context-engine checkManifestAgainstPlan(manifest, plan)",
  "reason": "WORKSTREAMS.md 7.2 item 3 requires checkManifestAgainstPlan to reject wos:findings/<subject>@k in a reviewer plan unless k <= round - 1. The plan carries roundId (a uuid) but not the round number, and the frozen check takes only (manifest, plan), so the rule cannot be evaluated from its inputs.",
  "evidence": "agent-io.ts ContextPlan: roundId: Uuid.nullable(), no roundNumber; CONTEXT-PROTOCOL.md section 2 'A reviewer's plan may contain wos:findings/<subject>@<k> only for k <= current round - 1'. Test: packages/context-engine/test/manifest-check.test.ts 'reviewer plans: findings only for revealed rounds'.",
  "requestedCapability": "The current round number available to the check, ideally ContextPlan.roundNumber (nullable, set for review tasks).",
  "affectedWorkstreams": ["context-policy", "control-plane"],
  "suggestedResolution": "Implemented additively: checkManifestAgainstPlan(manifest, plan, { roundNumber }) with a third optional argument. For a reviewer plan that references any wos:findings ref, a missing roundNumber fails closed (ROUND_NUMBER_REQUIRED); k > roundNumber - 1 is CURRENT_ROUND_FINDINGS. Control-plane passes rounds.round_number from the claim. A MINOR bump adding ContextPlan.roundNumber would let the engine read it from the plan and drop the argument.",
  "decision": null
}
```

Notes:

- Builder plans are exempt: a builder's revision context carries the ledger of the round it answers (`wos:findings/<attemptId>@<n>`, CONTEXT-PROTOCOL.md section 3).
- `SnapshotReader` gained an optional `readLocalDocument(ref)` so the engine can materialise `local:verification-output`; absent or null = `missing_optional`. Additive; github-build implements it for repair runs (7.1 item 4).
