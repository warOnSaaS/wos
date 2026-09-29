```json
{
  "id": "B-0002-verification",
  "status": "accepted",
  "raisedBy": "verification",
  "raisedAt": "2026-09-29T18:18:19Z",
  "affectedContract": "vitest.config.ts include; tsconfig.test.json include",
  "reason": "WORKSTREAMS.md gives verification ownership of tests/** (integration and e2e suites at the repo root), but the frozen root vitest.config.ts and tsconfig.test.json only include packages/*/test, services/*/test and apps/cli/test. Tests placed under tests/ would never run in npm test or be typechecked.",
  "evidence": "vitest.config.ts include list; tsconfig.test.json include list. Worked around by placing the adversarial and integration suites under packages/verification/test/adversarial/.",
  "requestedCapability": "Add 'tests/**/*.test.ts' to vitest.config.ts include and 'tests/**/*.ts' to tsconfig.test.json include, or drop tests/** from verification's owned paths.",
  "affectedWorkstreams": [
    "verification"
  ],
  "suggestedResolution": "Either is fine; the suites can move to tests/ at the Wave 2 gate.",
  "decision": {
    "outcome": "accepted",
    "contractsVersion": "2.0.0",
    "note": "accepted. tests/**/*.test.ts added to vitest.config.ts and tests/**/*.ts to tsconfig.test.json.",
    "decidedAt": "2026-09-29T19:30:00Z"
  }
}
```

Raised by the verification workstream in Wave 1. See the evidence paths above; continuing with unaffected work.
