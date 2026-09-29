```json
{
  "id": "B-0003-control-plane",
  "status": "open",
  "raisedBy": "control-plane",
  "raisedAt": "2026-09-29T14:40:00-04:00",
  "affectedContract": "packages/contracts/src/api.ts Routes (claims and ContextPlan server documents)",
  "reason": "(1) ContextPlan carries server_document selectors (wos:policy, wos:task, wos:findings, wos:catalog-index, ...) that the client must fetch by ref and match by sha256 (CONTEXT-PROTOCOL.md sections 1-2, SnapshotReader.readServerDocument), but Routes has no route that serves them, so no orchestrator can build a context. (2) claimBuild and claimTask must read GitHub to pin the base commit (BUILD-PROTOCOL section 3 step 6) but UPSTREAM_GITHUB is not in their errors lists. (3) IDEMPOTENCY_MISMATCH is promised by the api.ts header for every idempotent route but appears in no route's errors list (the router treats it as implicit).",
  "evidence": "services/control-plane/src/domain/plans.ts renderServerDocument() renders every V1 ref deterministically (canonical JSON) and the plan carries its sha256; there is nowhere to serve it. services/control-plane/src/http/router.ts IMPLICIT list and the idempotency allowance.",
  "requestedCapability": "A route getServerDocument: GET /v1/leases/:id/documents?ref=<ref>, auth contributor, holder of the lease only, response {ref, sha256, contentBase64}, errors LEASE_NOT_HELD, NOT_FOUND. Add UPSTREAM_GITHUB to claimBuild and claimTask errors. List IDEMPOTENCY_MISMATCH on idempotent routes (or document it as implicit).",
  "affectedWorkstreams": ["control-plane", "github-build", "context-policy"],
  "suggestedResolution": "MINOR change for all three; the renderer already exists server-side, so the route is a thin handler.",
  "decision": null
}
```
