```json
{
  "id": "B-0006-desktop",
  "status": "accepted",
  "raisedBy": "desktop",
  "raisedAt": "2026-09-29T21:00:00Z",
  "affectedContract": "docs/architecture/SECURITY.md S-30 (auto-update via electron-updater) and WORKSTREAMS section 1 rule 4 (pre-installed dependencies)",
  "reason": "S-30 says Desktop auto-updates with electron-updater from GitHub Releases of the platform repo. electron-updater is not in the pre-installed dependency list and the workstream may not add dependencies.",
  "evidence": "WORKSTREAMS section 1 rule 4 list (electron, electron-builder, vite, react... no electron-updater); root package-lock.json has no electron-updater.",
  "requestedCapability": "electron-updater added to apps/desktop dependencies by the architect's dependency batch, and the release workflow publishing latest-mac.yml / latest-linux.yml next to the artefacts.",
  "affectedWorkstreams": [
    "desktop",
    "architect"
  ],
  "suggestedResolution": "Add electron-updater (pinned) in the next dependency batch; Desktop then checks for updates from main (never the renderer) and the release job uploads the update metadata. Auto-update is not part of the Wave 2b DONE list, so nothing else waits on this.",
  "decision": {
    "outcome": "accepted",
    "contractsVersion": "4.4.0",
    "note": "accepted: electron-updater added to apps/desktop dependencies in the gate's lockfile change; the release job publishes latest-mac.yml and latest-linux.yml.",
    "decidedAt": "2026-09-30T02:00:00Z"
  }
}
```
