```json
{
  "id": "B-0002-github-build",
  "status": "open",
  "raisedBy": "github-build",
  "raisedAt": "2026-09-29T18:06:05Z",
  "affectedContract": "packages/contracts/src/agent-io.ts ProvenanceRecord.prNumber; packages/context-engine canonicalSha256 placement",
  "reason": "ProvenanceRecord requires prNumber (positive int) and BUILD-PROTOCOL section 9 puts the record hash in the PR body, but the PR number exists only after the PR is created, so the record cannot be complete when openPullRequest is called. Separately, the record is hashed with JCS, whose shared implementation (canonicalSha256) lives in context-engine, which the github package may not import (ARCHITECTURE.md section 4 layering: github <- contracts only). github-build had to carry its own JCS implementation, so two JCS implementations now exist and can drift.",
  "evidence": "agent-io.ts ProvenanceRecord: prNumber: z.number().int().positive(); ARCHITECTURE.md section 4 layering table; packages/github/src/internal/hash.ts canonicalJson.",
  "requestedCapability": "(1) A defined rule for prNumber in the record shown in the PR body. (2) One JCS implementation importable by github, context-engine, verification and control-plane.",
  "affectedWorkstreams": ["control-plane", "context-policy", "architect"],
  "suggestedResolution": "(1) Adopt what openPullRequest now does: the caller passes the record with any prNumber, openPullRequest creates the PR, sets prNumber to the real number, renders the section and PATCHes the body; the control plane stores the record with that same number (it gets it from the return value), so both hashes agree. Document it on ProvenanceRecord. (2) Move canonicalJson/canonicalSha256 into @waronsaas/contracts (pure, node:crypto only) and have context-engine re-export it.",
  "decision": null
}
```
