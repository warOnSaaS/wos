```json
{
  "id": "B-0002-desktop",
  "status": "accepted",
  "raisedBy": "desktop",
  "raisedAt": "2026-09-29T21:00:00Z",
  "affectedContract": "docs/architecture/SECURITY.md S-29 (openExternal allowlist) with D8 / S-6 (GitHub device flow)",
  "reason": "S-29 allows openExternal only for https://waronsaas.com/... and https://github.com/waronsaas/.... The GitHub device flow (S-6, orchestrator linkGithub) returns verificationUri https://github.com/login/device, which the allowlist refuses, so Desktop cannot open the page the user must visit to link GitHub. Widening the allowlist on my own would change a security control.",
  "evidence": "packages/orchestrator/src/orchestrator.ts linkGithub -> openUrl(start.verificationUri, start.userCode); fake and real control plane return https://github.com/login/device. apps/desktop/test/core.test.ts 'links GitHub through the device flow' asserts nothing is opened; test/security.test.ts refuses https://github.com/login/device.",
  "requestedCapability": "A ruling on whether openExternal may open exactly https://github.com/login/device (the verification URI the control plane returns, compared by exact string), or that Desktop keeps showing the URL and code for the user to type.",
  "affectedWorkstreams": [
    "desktop",
    "architect"
  ],
  "suggestedResolution": "Allow the single exact URL https://github.com/login/device (no query, no other path) in S-29, only as the openUrl callback of linkGithub, never from the renderer's openExternal. Until then Desktop shows the URL, the code and a COPY CODE button.",
  "decision": {
    "outcome": "accepted",
    "contractsVersion": "4.4.0",
    "note": "accepted as suggested: exactly https://github.com/login/device may be opened by the main process as linkGithub's openUrl callback, never via the renderer channel (SECURITY S-29 amendment).",
    "decidedAt": "2026-09-30T02:00:00Z"
  }
}
```
