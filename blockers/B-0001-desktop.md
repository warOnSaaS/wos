```json
{
  "id": "B-0001-desktop",
  "status": "open",
  "raisedBy": "desktop",
  "raisedAt": "2026-09-29T21:00:00Z",
  "affectedContract": "vitest.config.ts test.include and tsconfig.test.json include (root, architect-owned)",
  "reason": "The root test and typecheck graphs include apps/cli/test but not apps/desktop/test, so the Desktop's DONE tests (S-29 unit tests, IPC fuzz, the BUILD flow against the fake and the real control plane, renderer empty states, packaging) do not run under the root `npm test` / `npm run typecheck`. The desktop tests also need the DOM lib and react-jsx for the renderer views, which the root tsconfig.test.json does not set.",
  "evidence": "vitest.config.ts include: [packages/*/test, services/*/test, apps/cli/test, tests]; tsconfig.test.json include: the same. Desktop suite today: `npm test -w apps/desktop` (8 files, 120 tests + 1 skipped pending B-0005-desktop) and `npm run typecheck:test -w apps/desktop` (apps/desktop/tsconfig.test.json).",
  "requestedCapability": "Root vitest includes apps/desktop/test/**/*.test.{ts,tsx}; root typecheck also runs `tsc -p apps/desktop/tsconfig.test.json` (DOM lib, jsx react-jsx).",
  "affectedWorkstreams": ["desktop", "architect", "verification"],
  "suggestedResolution": "vitest.config.ts: add \"apps/desktop/test/**/*.test.ts\" and \"apps/desktop/test/**/*.test.tsx\" to include. package.json typecheck: \"tsc -b && tsc -p tsconfig.test.json && tsc -p apps/desktop/tsconfig.test.json\". test/electron.test.ts skips itself without the Electron binary and the bundle, so root CI (npm ci --ignore-scripts) stays green.",
  "decision": null
}
```

The desktop suite is green on its own (`npm test -w apps/desktop`), but the root gate does not see it. Until this lands, the Wave 2b gate must run `npm test -w apps/desktop` and `npm run typecheck:test -w apps/desktop` explicitly.
