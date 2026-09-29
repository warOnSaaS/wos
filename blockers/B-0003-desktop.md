```json
{
  "id": "B-0003-desktop",
  "status": "accepted",
  "raisedBy": "desktop",
  "raisedAt": "2026-09-29T21:00:00Z",
  "affectedContract": "packages/contracts/src/orchestrator.ts Orchestrator (no account-settings operation); api.ts updateMe",
  "reason": "The Desktop settings screen should let the contributor change the account preferences in Me (displayName, leaderboardOptIn, progressEmails, followedTargets) through PATCH /v1/me. The Desktop may call the control plane only through the orchestrator, which holds and refreshes the session; the orchestrator exposes no updateMe. Calling the route from main with the session read out of the SecretStore would duplicate the orchestrator's session and refresh logic.",
  "evidence": "orchestrator.ts: the 4.2.0 read operations are listClaimableAbus, listOpenTasks, myWork, events; none writes Me. apps/desktop/src/renderer/screens/Account.tsx SettingsView shows these preferences read-only and names this blocker.",
  "requestedCapability": "Orchestrator.updateMe(patch: RouteBody<'updateMe'>): Promise<Me>, a thin ApiClient call like the 4.2.0 reads (MINOR, additive). The CLI can use it for a future `wos profile` command.",
  "affectedWorkstreams": [
    "desktop",
    "github-build",
    "cli",
    "architect"
  ],
  "suggestedResolution": "Add updateMe to the Orchestrator interface (contracts MINOR) and to OrchestratorImpl (github-build); Desktop then adds the controls and an IPC channel validated with the route's body schema.",
  "decision": {
    "outcome": "accepted",
    "contractsVersion": "4.4.0",
    "note": "accepted: Orchestrator.updateMe(patch) (contracts 4.4.0), implemented in the orchestrator at the gate.",
    "decidedAt": "2026-09-30T02:00:00Z"
  }
}
```
