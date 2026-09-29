```json
{
  "id": "B-0001-verification",
  "status": "open",
  "raisedBy": "verification",
  "raisedAt": "2026-09-29T18:18:19Z",
  "affectedContract": "packages/contracts/src/agent-io.ts Changeset.signature / submissionSha256; packages/context-engine canonicalSha256; wos.devices.public_key",
  "reason": "Three byte-level rules that client, server and CI must agree on are ambiguous, and the one JCS implementation lives in context-engine, which verification may not depend on. (1) 'file contents replaced by their sha256' does not say whether contentBase64 becomes the sha256 value or is removed. (2) The diff hash lists {path, op, mode, sha256} for every file but deletes have no mode or sha256: omitted vs null changes the hash. (3) Whether the signed object is the pre- or post-parse changeset: Changeset.localVerification has a zod default([]), so a signer that omits it and a verifier that parses first sign different bytes. (4) The device public key encoding (raw 32-byte base64, SPKI DER, PEM) is unstated; devices.public_key is free text.",
  "evidence": "packages/contracts/src/agent-io.ts:219-240; packages/verification/src/index.ts computeSubmissionSha256 and changesetSigningPayload implement one reading; packages/verification/src/jcs.ts duplicates canonicalSha256; test/primitives.test.ts has a pending byte-equality check against context-engine.",
  "requestedCapability": "A normative statement (or a contracts-level function) for: the signing payload (contentBase64 := sha256 value, post-parse object), delete entries in the diff hash (path and op only, fields omitted), the device key encoding (base64 of the raw 32-byte Ed25519 key), and ONE canonicalJson/canonicalSha256 exported from @waronsaas/contracts that every package uses.",
  "affectedWorkstreams": [
    "github-build",
    "control-plane",
    "context-policy",
    "verification"
  ],
  "suggestedResolution": "Move canonicalJson + sha256 helpers into packages/contracts (MINOR: additive export). Adopt the readings implemented in packages/verification/src/index.ts, which github-build can import today as computeSubmissionSha256 and changesetSigningPayload.",
  "decision": null
}
```

Raised by the verification workstream in Wave 1. See the evidence paths above; continuing with unaffected work.
