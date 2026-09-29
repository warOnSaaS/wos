```json
{
  "id": "B-0004-control-plane",
  "status": "accepted",
  "raisedBy": "control-plane",
  "raisedAt": "2026-09-29T14:40:00-04:00",
  "affectedContract": "packages/contracts/src/agent-io.ts Changeset.signature and state-machines.ts TaskMachine reject_output guard",
  "reason": "(1) The changeset signature is over 'JCS(changeset without signature, file contents replaced by their sha256)'; this is ambiguous (drop contentBase64? set contentBase64 to the sha256 string? keep bytes?) and client and server must agree byte for byte. (2) The TaskMachine reject_output guard says the github_sync consumer retries the App commit for builds for up to 1 hour, but a changeset's content is never stored (changesets.file_manifest has no content), so nothing can be retried after the request ends.",
  "evidence": "services/control-plane/src/handlers/work.ts changesetSigningBytes() uses: every upsert keeps all fields and its contentBase64 is replaced by the file's sha256 string; then JCS. submitChangeset commits through the App INSIDE the request before recording anything (G-24): on GitHub failure the client gets 502 UPSTREAM_GITHUB with the lease still active and retries with the same Idempotency-Key.",
  "requestedCapability": "Fix the signing form in the contract text (proposal: contentBase64 replaced by the sha256 value, everything else unchanged, JCS UTF-8) and confirm the commit-inside-the-request model, rewording the reject_output guard accordingly.",
  "affectedWorkstreams": [
    "control-plane",
    "github-build",
    "verification"
  ],
  "suggestedResolution": "PATCH: clarify both texts; no type change.",
  "decision": {
    "outcome": "accepted",
    "contractsVersion": "3.0.0",
    "note": "accepted. (1) Already settled by contracts 2.0.0 canonical.ts C-4, which matches your reading (contentBase64 replaced by the sha256 string, everything else kept, JCS UTF-8 of the parsed object); replace changesetSigningBytes with changesetSigningPayload from @waronsaas/contracts/canonical. (2) Commit-inside-the-request is the model; the TaskMachine reject_output and AttemptMachine submit/candidate_committed guards and BUILD-PROTOCOL sections 6-7 are reworded; the retry-for-an-hour rule is gone.",
    "decidedAt": "2026-09-29T20:30:00Z"
  }
}
```
