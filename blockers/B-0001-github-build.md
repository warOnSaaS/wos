```json
{
  "id": "B-0001-github-build",
  "status": "accepted",
  "raisedBy": "github-build",
  "raisedAt": "2026-09-29T18:06:05Z",
  "affectedContract": "packages/github/src/app/index.ts public API (ARCHITECTURE.md section 4 table, github row)",
  "reason": "The frozen github/app function list cannot perform four steps the constitution requires: BUILD-PROTOCOL.md section 9 step 1 (create wos/<unit> pointing at the exact candidate commit - commitChangeset always makes a new commit), step 4 (delete the candidate ref after the PR opens), SECURITY.md S-18 fallback (close and lock a PR not authored by the App) and section 10 (move the official branch to a new qualified head). startGithubLink (api.ts) must return a device userCode/verificationUri, but only the exchange half of the device flow exists (exchangeUserAuthorization). Also, the frozen signatures take no transport, so tests and the Wave 2 fake end-to-end run need a module-level way to point the App at a fake GitHub.",
  "evidence": "packages/github/src/app/index.ts at cd2c59d has commitChangeset/openPullRequest/setCommitStatus/enableAutoMerge/blobOidsAt/createIssue/verifyWebhookSignature/exchangeUserAuthorization only; api.ts startGithubLink response has userCode.",
  "requestedCapability": "Ratify these ADDITIVE exports in @waronsaas/github/app (implemented and tested on ws/github-build, no existing signature changed): createBranchAt(creds, repo, branch, sha, {expectedHeadSha}), deleteBranch(creds, repo, branch), closePullRequest(creds, repo, prNumber, {comment, lock}), startDeviceAuthorization(creds), configureGithubApp({fetch, apiBaseUrl, oauthBaseUrl}) / resetGithubAppConfig(), GithubAppError with codes, renderPullRequestBody and renderProvenanceSection helpers. @waronsaas/github/local likewise adds configureLocalGit({remoteUrl, gitBinary}), isBlockingRejection and CaptureRejectReason.",
  "affectedWorkstreams": [
    "control-plane",
    "verification",
    "architect"
  ],
  "suggestedResolution": "Accept as a MINOR contracts bump (additive); list the new functions in ARCHITECTURE.md section 4 and tell control-plane to call createBranchAt + deleteBranch in the qualify transaction's follow-up and closePullRequest from the pull_request.opened webhook for non-App authors.",
  "decision": {
    "outcome": "accepted",
    "contractsVersion": "2.0.0",
    "note": "accepted. The additive github/app and github/local exports are ratified and listed in ARCHITECTURE.md section 4. Control plane uses createBranchAt + deleteBranch after qualification and closePullRequest for non-App PRs. Add a one-line comment that WorktreeHandle.branch is \"HEAD\" for detached worktrees.",
    "decidedAt": "2026-09-29T19:30:00Z"
  }
}
```

Notes:

- None of the Phase 0 signatures changed. The additions are the smallest set that lets the control plane do BUILD-PROTOCOL sections 9-10 and S-18 without a git binary.
- `WorktreeHandle.branch` has no defined meaning for a detached worktree; the implementation sets it to `"HEAD"`. Worth a one-line comment in the contract.
