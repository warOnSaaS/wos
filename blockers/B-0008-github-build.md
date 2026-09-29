```json
{
  "id": "B-0008-github-build",
  "status": "open",
  "raisedBy": "github-build",
  "raisedAt": "2026-09-29T20:05:10Z",
  "affectedContract": "packages/contracts/src/api.ts submitVerdict body (headSha, submissionSha256) vs ContextPlan / ClaimResponse",
  "reason": "submitVerdict must carry the round's headSha and submissionSha256, and the control plane refuses anything else (work.ts: b.submissionSha256 !== round.submission_sha256 -> VALIDATION_FAILED). The reviewer's client gets headSha as plan.source.commit, but no contract field carries the submission hash: not ContextPlan, TaskView, AttemptView, ReviewView or ClaimResponse. It appears only inside the rendered wos:task document, whose format is prose in CONTEXT-PROTOCOL.md, not a schema. So Orchestrator.review() cannot complete an implementation review against the real control plane without parsing an unspecified document.",
  "evidence": "services/control-plane/src/handlers/work.ts line ~878; CONTEXT-PROTOCOL.md 'wos:task/<taskId> ... submission hash'; packages/orchestrator/src/orchestrator.ts review() sends submissionSha256: null; packages/orchestrator/test/control-plane.e2e.test.ts uses control-plane's reviewAs for that reason.",
  "requestedCapability": "A typed place for the review subject, e.g. ContextPlan.subject: { headSha: GitSha, submissionSha256: Sha256 | null } | null (set for implementation and document reviews), or ClaimResponse.round: { id, number, headSha, submissionSha256 }.",
  "affectedWorkstreams": ["control-plane", "github-build", "cli", "desktop", "architect"],
  "suggestedResolution": "Add ClaimResponse.round (nullable, MINOR). review() then sends exactly those values; until then it sends plan.source.commit and null, which the fake control plane accepts and the real one refuses.",
  "decision": null
}
```
