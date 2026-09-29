```json
{
  "id": "B-0005-github-build",
  "status": "accepted",
  "raisedBy": "github-build",
  "raisedAt": "2026-09-29T18:49:09Z",
  "affectedContract": "packages/context-engine/src/index.ts SnapshotReader (local_document artifacts)",
  "reason": "Contracts 2.0.0 added the local_document selector (local:verification-output) and WORKSTREAMS 7.1 item 4 requires repair runs to see it, but SnapshotReader, the only channel between the orchestrator and buildContext, has no method for local documents and does not say how a missing optional document is signalled. Without a defined channel, context-policy and github-build will guess differently and the repair manifest will not be reproducible.",
  "evidence": "context-engine/src/index.ts on main 615930d: SnapshotReader = readFile, listFiles, readServerDocument only. agent-io.ts ArtifactSelector local_document. packages/orchestrator/src/orchestrator.ts snapshotReader().",
  "requestedCapability": "Either SnapshotReader.readLocalDocument(ref): Promise<Uint8Array | null> (null = missing_optional), or a normative statement that readServerDocument(\"local:verification-output\") is answered locally and throws when absent.",
  "affectedWorkstreams": [
    "context-policy",
    "github-build",
    "architect"
  ],
  "suggestedResolution": "Add readLocalDocument(ref) returning null when absent (additive, MINOR). Until then the orchestrator on ws/github-build answers readServerDocument(\"local:verification-output\") locally (never over the network) and throws NOT_FOUND when there is no failing output yet; a one-line change moves it to readLocalDocument.",
  "decision": {
    "outcome": "accepted",
    "contractsVersion": "3.1.0",
    "note": "accepted, reconciled with context-policy's shape: SnapshotReader.readLocalDocument(ref): Promise<Uint8Array | null> (null = absent -> missing_optional) is the only channel for local documents; readServerDocument never answers local refs. The orchestrator implements readLocalDocument (integration glue at the gate).",
    "decidedAt": "2026-09-29T21:30:00Z"
  }
}
```
