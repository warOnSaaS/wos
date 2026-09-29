```json
{
  "id": "B-0004-desktop",
  "status": "open",
  "raisedBy": "desktop",
  "raisedAt": "2026-09-29T21:00:00Z",
  "affectedContract": ".github/workflows/** (outside apps/desktop) and the platform repo's `release` environment (FOUNDER-CHECKLIST section 7)",
  "reason": "DONE (4) requires electron-builder to produce the macOS dmg and Linux AppImage in CI with signing wired to the `release` environment secrets. GitHub only runs workflows from .github/workflows/, which the desktop workstream does not own.",
  "evidence": "apps/desktop/ci/desktop-release.yml (the complete workflow) and apps/desktop/test/packaging.test.ts (asserts: dmg + AppImage targets, signing secrets only in the macOS job, which uses environment `release`, refuses an unsigned or un-notarised artefact with codesign/spctl/stapler before upload, npm ci --ignore-scripts). A local unsigned `electron-builder --mac dir` build packaged 11 entries in app.asar (no node_modules, no fake control plane); nothing was signed or notarised locally (D7).",
  "requestedCapability": "Install apps/desktop/ci/desktop-release.yml as .github/workflows/desktop-release.yml (tags desktop-v*), and keep its secret names in step with FOUNDER-CHECKLIST section 7 (CSC_LINK, CSC_KEY_PASSWORD, APPLE_API_KEY, APPLE_API_KEY_ID, APPLE_API_ISSUER).",
  "affectedWorkstreams": ["desktop", "verification", "architect"],
  "suggestedResolution": "Move the file as is (or let verification own it next to ci.yml). The desktop test keeps reading apps/desktop/ci/desktop-release.yml; point it at the new path when moved.",
  "decision": null
}
```
