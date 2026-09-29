```json
{
  "id": "B-0001-control-plane",
  "status": "open",
  "raisedBy": "control-plane",
  "raisedAt": "2026-09-29T14:40:00-04:00",
  "affectedContract": "packages/github/src/app/index.ts (the App operations the control plane calls)",
  "reason": "The frozen @waronsaas/github/app API lacks operations the constitution requires the control plane to perform: starting the GitHub device flow (S-6 link; only the exchange exists), reading the default-branch head to pin an attempt's base (BUILD-PROTOCOL section 3 step 6), reading files at a commit (wos.json for allowedCommands and ScopeContext.repoManifest; ROADMAP/INVENTORY/CONTRACT/BUILD-GRAPH at the merge commit for ingestion), listing blob paths at a commit (ScopeContext.existingPaths for DELETE_MISSING_FILE and CASE_COLLISION), creating/force-moving the official branch at the qualified candidate commit (BUILD-PROTOCOL section 9 step 1), closing and locking a PR (S-18 fallback, abandoned attempts), and a base..head compare for the wos:diff server document.",
  "evidence": "services/control-plane/src/deps.ts GithubPort second block (startDeviceAuthorization, webAuthorizeUrl, getBranchHead, readFile, listPaths, setBranch, closePullRequest). githubFromEnv() answers UPSTREAM_GITHUB for them until this is resolved; tests use FakeGithub.",
  "requestedCapability": "Add to @waronsaas/github/app: startDeviceAuthorization(creds) -> {deviceCode,userCode,verificationUri,intervalSeconds,expiresInSeconds}; getBranchHead(creds, repo, branch); readFileAt(creds, repo, commit, path) -> bytes|null; listTreePaths(creds, repo, commit); setBranch(creds, repo, branch, sha, {force}); closePullRequest(creds, repo, number, comment, {lock}); compareDiff(creds, repo, base, head) -> unified diff text.",
  "affectedWorkstreams": ["github-build", "control-plane"],
  "suggestedResolution": "MINOR contract change: add the seven functions with these signatures; the control plane's GithubPort adapter maps 1:1 and the fakes already implement the same shapes.",
  "decision": null
}
```

Until resolved, production calls to these operations fail with 502 UPSTREAM_GITHUB (never silently). Everything is covered by tests against `FakeGithub` in `services/control-plane/test/support/harness.ts`, whose method shapes are the proposal above.
