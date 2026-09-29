```json
{
  "id": "B-0010-github-build",
  "status": "open",
  "raisedBy": "github-build",
  "raisedAt": "2026-09-29T20:23:24Z",
  "affectedContract": "packages/contracts/src/orchestrator.ts BuildOptions and AuthorOptions; packages/contracts/src/api.ts claimBuild and claimTask bodies",
  "reason": "D15 and WORKSTREAMS 11.1/11.3 require 'model choice in build() (and the claim body)' and 'wos build ... --model opus|astra|sol', but contracts 4.2.0 carry the choice nowhere: BuildOptions has {abu, detachAfterSubmit, signal}, claimBuild's body is {deviceId} only, and claimTask's body is {deviceId} while AuthorOptions.model exists but cannot be sent. The orchestrator therefore cannot ask for Astra or Sol; the server picks the plan's model. The CLI and Desktop are starting against this interface, so it must not change without a ruling.",
  "evidence": "orchestrator.ts BuildOptions (lines ~75-81); api.ts claimBuild body z.object({ deviceId: Uuid }), claimTask body z.object({ deviceId: Uuid }); WORKSTREAMS.md 11.1 'wos build <abu|target/abu-key> [--model opus|astra|sol] (D15: the claim names the model)'.",
  "requestedCapability": "BuildOptions.model?: ModelRef; claimBuild body { deviceId, model?: ModelRef }; claimTask body { deviceId, model?: ModelRef } (author tasks, D15). Absent = the policy's first allowed model. The server answers NOT_ELIGIBLE (model not allowed for the role, provider not attested, or the per-provider lease limit) and issues the plan for the chosen model.",
  "affectedWorkstreams": ["github-build", "cli", "desktop", "control-plane", "context-policy", "architect"],
  "suggestedResolution": "MINOR additive fields. github-build then sends options.model on claimBuild and AuthorOptions.model on claimTask (a two-line change, tests ready: the orchestrator already builds with whatever model the plan names, including Astra and Sol through codex exec --sandbox workspace-write with network off).",
  "decision": null
}
```
