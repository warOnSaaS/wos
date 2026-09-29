```json
{
  "id": "B-0007-verification",
  "status": "open",
  "raisedBy": "verification",
  "raisedAt": "2026-09-29T20:33:00Z",
  "affectedContract": "vitest.config.ts (frozen root config): test timeouts",
  "reason": "Heavy suites exceed vitest's 5 s default testTimeout under a cold full-suite run (all files in parallel) and pass alone: at the Wave 2a gate two files failed this way on the first full run, and github-build saw packages/context-engine/test/determinism.test.ts (100 iterations per role) time out once. Per-file vi.setConfig fixes only the files a workstream owns; context-engine's test is context-policy's, and the root config is frozen. A flaky gate trains people to rerun red CI, which defeats the ship gate.",
  "evidence": "docs/dogfood/integration.md (Wave 2a first full run); coordinator report on determinism.test.ts; verification applied vi.setConfig({testTimeout: 60000, hookTimeout: 120000}) to its four heavy files (templates, ship, pipeline and db adversarial) and they pass under a full parallel run.",
  "requestedCapability": "A repo-wide timeout policy in vitest.config.ts: testTimeout 30000 and hookTimeout 60000 (heavy files may raise it per file), so no suite depends on the 5 s default.",
  "affectedWorkstreams": [
    "architect",
    "context-policy",
    "verification"
  ],
  "suggestedResolution": "Add `testTimeout: 30_000, hookTimeout: 60_000` to the root vitest.config.ts test block. Meanwhile context-policy can add vi.setConfig to determinism.test.ts.",
  "decision": null
}
```

Raised by the verification workstream in Wave 2b. Its own heavy files already carry a per-file timeout.
