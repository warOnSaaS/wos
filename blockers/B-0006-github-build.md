```json
{
  "id": "B-0006-github-build",
  "status": "accepted",
  "raisedBy": "github-build",
  "raisedAt": "2026-09-29T20:05:10Z",
  "affectedContract": "packages/contracts/src/orchestrator.ts LocalStatus; packages/contracts/src/agent-io.ts ToolchainAttestation.tools[].name",
  "reason": "WORKSTREAMS section 8 asks wos status and Desktop to collect a ToolchainAttestation and show it, but LocalStatus (the only thing status() returns to the CLI and Desktop) has no field for it, so the CLI and Desktop cannot display what was attested. Second, the tool names in ToolchainAttestation.tools and RepoManifest.toolchainRequirements[].tools are free strings with no shared vocabulary; only the doc comment mentions 'xcode'. If the client says 'xcode' and a repo's wos.json says 'Xcode' or 'xcodebuild', eligibility silently fails.",
  "evidence": "orchestrator.ts LocalStatus {signedIn, me, git, providers, eligibleRoles, activeLeases, workspaceRoot}; agent-io.ts ToolchainAttestation.tools name: z.string(); artifacts.ts toolchainRequirements tools name: z.string(). packages/orchestrator/src/orchestrator.ts collectToolchain posts {os, osVersion, tools: node|xcode|android-sdk}.",
  "requestedCapability": "(1) LocalStatus.toolchain: ToolchainAttestation | null (MINOR, additive). (2) A ToolName enum (proposal: 'node', 'xcode', 'android-sdk'; extendable) used by both ToolchainAttestation and toolchainRequirements, plus the version rule (dotted numeric prefix, compared numerically).",
  "affectedWorkstreams": [
    "github-build",
    "cli",
    "desktop",
    "context-policy",
    "verification",
    "architect"
  ],
  "suggestedResolution": "Accept both as MINOR. The orchestrator already collects and posts the attestation with names node / xcode (from xcodebuild -version, macOS only) / android-sdk (from sdkmanager --version) and the raw os version (sw_vers -productVersion, uname -r); returning it in LocalStatus is a one-line change once the field exists.",
  "decision": {
    "outcome": "accepted",
    "contractsVersion": "4.2.0",
    "note": "accepted: LocalStatus.toolchain; ToolName enum (node, xcode, android-sdk) in both attestations and toolchainRequirements; compareToolVersions (dotted numeric prefix).",
    "decidedAt": "2026-09-29T23:00:00Z"
  }
}
```
