```json
{
  "id": "B-0005-desktop",
  "status": "open",
  "raisedBy": "desktop",
  "raisedAt": "2026-09-29T21:00:00Z",
  "affectedContract": "packages/github/src/local/index.ts (mirror + worktree setup) used by packages/orchestrator build(); D15 'one Claude build and one Codex build at once'",
  "reason": "Two concurrent build() calls on ONE orchestrator (the Desktop's D15 case: an Opus build and an Astra build side by side) race on the shared bare mirror <workspaceRoot>/repos/<owner>/<name>.git. The second run fails with INTERNAL before BUILD. This is not a Desktop contract gap: it is a defect in another workstream's package that the Desktop must not work around by serialising builds itself (that would be workflow logic in the app).",
  "evidence": "Real orchestrator + fake control plane, two builds started back to back (apps/desktop/test/core.test.ts, skipped test 'D15 with the REAL orchestrator: two concurrent builds both pass'). First mirror: `git init --bare -q: fatal: cannot copy '.../templates/info/exclude' to '.../repos/waronsaas/product.git/info/exclude': File exists`. Mirror already present: `git config remote.origin.url ...: error: could not lock config file config: File exists` (3 of 3 runs). With the agent delay of the development fake the two runs happened not to collide (screenshot 08).",
  "requestedCapability": "The orchestrator (or github/local) serialises per-repository mirror work (init, config, fetch, worktree add) with an in-process lock per mirror path, so two builds on the same repository can run concurrently from one process.",
  "affectedWorkstreams": ["github-build", "desktop", "cli"],
  "suggestedResolution": "A Map<mirrorPath, Promise> mutex around ensure-mirror/fetch/worktree-add in packages/github/src/local; add an orchestrator test that runs two build() calls at once. Desktop then un-skips its test.",
  "decision": null
}
```
