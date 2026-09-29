```json
{
  "id": "B-0009-github-build",
  "status": "open",
  "raisedBy": "github-build",
  "raisedAt": "2026-09-29T20:08:16Z",
  "affectedContract": "packages/contracts/src/orchestrator.ts Orchestrator (operations the CLI and Desktop need)",
  "reason": "CLI and Desktop may not call workflow routes directly and have no session token outside the orchestrator's SecretStore, but several of their required flows need contributor-authenticated reads the Orchestrator does not offer: Desktop's 'pick Salesforce -> CRM -> feature -> eligible ABU -> BUILD' needs listClaimableAbus (auth contributor, claimable computed for the caller); 'wos roadmap' and 'wos resolve' need the task id that author({taskId}) requires, i.e. listOpenTasks; Desktop's activity pane and 'wos status' need my work (getMyWork) and my events (listMyEvents). Without these the apps must either call routes themselves with a token they do not have, or show nothing.",
  "evidence": "orchestrator.ts Orchestrator: signIn, linkGithub, logout, status, build, review, author, propose, resume, release, describeInvocation only; api.ts listClaimableAbus/listOpenTasks/getMyWork/listMyEvents auth contributor/account; WORKSTREAMS.md desktop DONE (2), cli commands roadmap/resolve.",
  "requestedCapability": "Additive read operations on Orchestrator: listClaimableAbus(target, feature): Promise<AbuSummary[]>; listOpenTasks(filter: {kind?, target?, feature?}): Promise<TaskView[]>; myWork(): Promise<{leases, tasks, attempts}>; events(after?: number): Promise<{items: DomainEvent[]; lastId: number}>. Public reads (targets, features, catalog, leaderboard) may stay direct fetches of public routes.",
  "affectedWorkstreams": ["cli", "desktop", "github-build", "architect"],
  "suggestedResolution": "MINOR additive interface change; github-build implements them as thin ApiClient calls (no workflow logic) the day the architect accepts, before cli and desktop start.",
  "decision": null
}
```
