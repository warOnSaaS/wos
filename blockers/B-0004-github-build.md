```json
{
  "id": "B-0004-github-build",
  "status": "accepted",
  "raisedBy": "github-build",
  "raisedAt": "2026-09-29T18:15:42Z",
  "affectedContract": "packages/contracts/src/api.ts Routes (server documents); agent-io.ts Changeset.submissionSha256 and signature definitions; ContextPlan for revisions and local repair",
  "reason": "Four gaps met while writing the orchestrator against the frozen contracts. (1) ContextPlan artifacts of kind server_document must be fetched by ref (CONTEXT-PROTOCOL.md) but no route serves them, so SnapshotReader.readServerDocument cannot be implemented on the client. (2) The diff hash is defined as JCS of {path, op, mode, sha256} per file, but deletes have no mode or sha256: absent keys vs null is undefined and client, server and CI must agree byte for byte. The signature is 'over the JCS of the changeset without signature, with file contents replaced by their sha256' - which field holds the sha256 is not stated. (3) BUILD-PROTOCOL says parentCommit is the candidate head for revisions and the new base after a rebase, but ContextPlan does not say which commit a revision builds on; the orchestrator assumes plan.source.commit is always the parent. (4) A local repair loop (verify_failed_locally) re-runs the builder with the identical plan, so the failing check output cannot reach the agent's context without breaking the manifest (renderedPromptSha256).",
  "evidence": "api.ts has no route for server documents; CONTEXT-PROTOCOL.md table row server_document; BUILD-PROTOCOL.md section 6; packages/orchestrator/src/orchestrator.ts submissionSha256, signChangeset, snapshotReader, buildAndSubmit.",
  "requestedCapability": "(1) GET /v1/leases/:id/documents/:ref returning bytes whose sha256 matches the plan. (2) An exact definition, ideally a pure helper in contracts: submissionSha256(parentCommit, files) with deletes as {path, op} only, and signingView(changeset) replacing contentBase64 with the file sha256. (3) ContextPlan.source.commit documented as the submission parentCommit for every build and revision plan. (4) A local-repair artifact kind (e.g. local_document 'local-verification-output', hashed into the manifest) so repair runs see why they failed.",
  "affectedWorkstreams": [
    "control-plane",
    "context-policy",
    "verification",
    "github-build",
    "architect"
  ],
  "suggestedResolution": "The orchestrator on ws/github-build implements (2) and (3) as described above (deletes carry path and op only; contentBase64 replaced by the sha256 string) and leaves (1) throwing NOT_IMPLEMENTED; accept those definitions or tell us the right ones before Wave 2.",
  "decision": {
    "outcome": "accepted",
    "contractsVersion": "2.0.0",
    "note": "accepted. (1) Route getLeaseDocument GET /v1/leases/:id/documents/:ref (403 for refs not in the lease plan). (2) Diff hash and signing view are canonical.ts rules C-3/C-4 with test vectors (deletes are {path, op} only; contentBase64 replaced by the sha256 string; signed object is the zod-parsed changeset). (3) ContextPlan.source.commit IS the submission parentCommit for every build and revision plan. (4) Artifact kind local_document with ref local:verification-output for repair runs; a repair run posts a new manifest for the same lease.",
    "decidedAt": "2026-09-29T19:30:00Z"
  }
}
```
