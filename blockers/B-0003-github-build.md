```json
{
  "id": "B-0003-github-build",
  "status": "open",
  "raisedBy": "github-build",
  "raisedAt": "2026-09-29T18:06:05Z",
  "affectedContract": "packages/contracts/src/orchestrator.ts Orchestrator.login",
  "reason": "Orchestrator.login(observer, openUrl(url, userCode)) is documented as 'brokered GitHub device flow', but D8 makes sign-in an email magic link/code for everyone with GitHub only linked afterwards (startEmailSignIn -> redeemEmailSignIn, then startGithubLink -> pollGithubLink). The signature has no way to receive the email address or the 8-character code the user types, so neither the CLI nor Desktop can implement D8 sign-in through the one orchestrator.",
  "evidence": "orchestrator.ts line 'login(observer, openUrl): Promise<Me>' and its doc comment; DECISIONS.md D8; api.ts startEmailSignIn/redeemEmailSignIn bodies (email, code).",
  "requestedCapability": "Orchestrator operations for D8: signIn({email}, prompt: {code(): Promise<string>, deepLink?: AsyncIterable<string>}) and linkGithub(observer, openUrl(url, userCode)).",
  "affectedWorkstreams": ["cli", "desktop", "github-build", "architect"],
  "suggestedResolution": "MAJOR-safe alternative: keep login() as linkGithub semantics and add signIn(input, prompt) as a new method (MINOR, additive). The orchestrator on ws/github-build implements login() as the GitHub link step only and throws UNAUTHENTICATED when there is no session.",
  "decision": null
}
```
