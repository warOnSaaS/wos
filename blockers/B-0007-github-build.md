```json
{
  "id": "B-0007-github-build",
  "status": "open",
  "raisedBy": "github-build",
  "raisedAt": "2026-09-29T20:05:10Z",
  "affectedContract": "services/control-plane buildPlan (builder plans) vs CONTEXT-PROTOCOL.md section 3 item 7a and context-engine builderArtifactSelectors(localVerificationOutput)",
  "reason": "A local repair run happens inside the SAME lease and therefore the SAME plan. The manifest check (checkManifestAgainstPlan) accepts a local_document only when the plan selects it, and the context engine includes it only when selected. The control plane's builder plans never select local:verification-output, so against the real control plane a repair run cannot show the agent why its checks failed (the orchestrator does serve it through readLocalDocument; the engine never asks). The fake control plane in the orchestrator tests selects it and the flow works there.",
  "evidence": "services/control-plane/src/domain/plans.ts buildPlan role === 'builder' branch pushes no local_document; packages/context-engine/src/selectors.ts localVerificationOutput flag; packages/context-engine/src/index.ts checkManifestAgainstPlan 'UNSELECTED_ARTIFACT: local:verification-output'.",
  "requestedCapability": "Builder (abu_build and abu_revision) plans always include the optional selector {kind: local_document, ref: local:verification-output, required: false}; a first run reports it as excluded missing_optional.",
  "affectedWorkstreams": ["control-plane", "context-policy", "github-build"],
  "suggestedResolution": "control-plane: call builderArtifactSelectors (or push the selector) with localVerificationOutput: true for every builder plan. No contract type changes.",
  "decision": null
}
```
