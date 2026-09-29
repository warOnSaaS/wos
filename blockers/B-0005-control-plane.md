```json
{
  "id": "B-0005-control-plane",
  "status": "open",
  "raisedBy": "control-plane",
  "raisedAt": "2026-09-29T17:30:00-04:00",
  "affectedContract": "packages/github/src/app/index.ts (ratified 3.0.0 set) and packages/contracts/src/events.ts document.opened",
  "reason": "(1) BUILD-PROTOCOL section 9 step 5 and brief 7.4 item 8 require the App to request review from @waronsaas/maintainers when a qualified diff touches a toolchain path, but no ratified github/app operation requests reviewers. (2) document.opened.target is a required TargetSlug, while contracts 3.0.0 says feature-contract work has no target (feature + relevantTo).",
  "evidence": "services/control-plane/src/domain/consumers.ts touchesToolchain(): the PR gets label wos:toolchain and a 'maintainers review required' section in its body (both through the ratified openPullRequest), but no explicit review request is sent. services/control-plane/src/domain/documents.ts openDocument(): a contract document.opened event carries the app whose merged roadmap opened it (openedFor), which is factual but not the 3.0.0 subject model.",
  "requestedCapability": "(1) github/app requestTeamReview(creds, repo, prNumber, team) (or confirm that CODEOWNERS auto-request is sufficient and drop step 5). (2) document.opened.target nullable plus relevantTo, or confirm 'the app whose roadmap opened it' as the meaning of target for contract documents.",
  "affectedWorkstreams": ["control-plane", "github-build"],
  "suggestedResolution": "MINOR: add requestTeamReview; PATCH/MINOR: document.opened { target: TargetSlug | null, relevantTo: TargetSlug[] }.",
  "decision": null
}
```
