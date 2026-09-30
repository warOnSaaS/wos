```json
{
  "id": "B-0007-control-plane",
  "status": "resolved",
  "raisedBy": "control-plane",
  "raisedAt": "2026-09-30T13:00:00-04:00",
  "affectedContract": "packages/db/migrations/0006_one_product.sql wos.app_releases (check on desktop_package; no column for the bundle sha256); packages/contracts/src/api.ts AppRoutes.publishAppRelease",
  "reason": "Two gaps between 0006 and the 5.2.0 AppRoutes contract. (1) WORKSTREAMS 12.4 and publishAppRelease say the control plane accepts a null desktop package for `build` (bundled in Desktop, D16), and Build's manifest supports desktop. But app_releases has `check (('desktop' = any (surfaces)) = (desktop_package is not null))`, so Build's release is refused by the database whenever `surfaces` lists the manifest's supported surfaces. (2) AppRegistryEntry.surfaces.desktop.package.sha256 and AppReleaseView.desktopPackage.sha256 are sha256Of(the downloaded ModuleBundle bytes), but the publish body carries no such hash and app_releases has no column to keep it, so the control plane can only learn it by downloading the bundle.",
  "evidence": "services/control-plane/test/apps.test.ts \"Build's release: no package, source waronsaas/wos (the database refuses it until B-0007-control-plane is ruled)\": POST /v1/admin/app-releases with apps/desktop/src/apps/build/wos-app.json, desktopPackage null, source waronsaas/wos -> the insert raises check_violation 23514 on app_releases (answered 400 VALIDATION_FAILED 'the registry refused this release'). For (2): services/control-plane/src/domain/apps.ts bundleSha() downloads the bundle at publish (verifying it) and, after a cold start, once more on first read, caching the hash in memory per (app, version, url).",
  "requestedCapability": "(1) A Build release with a desktop surface and no package must be storable. (2) A place for the bundle sha256 of a release, written once at publish.",
  "affectedWorkstreams": [
    "control-plane",
    "desktop",
    "verification"
  ],
  "suggestedResolution": "Migration 0007 (additive): replace the check with `check (('desktop' = any (surfaces)) = (desktop_package is not null) or (app_id = 'build' and desktop_package is null and desktop_package_url is null))`, and add `desktop_bundle_sha256 text check (desktop_bundle_sha256 ~ '^sha256:[0-9a-f]{64}$')` with `check ((desktop_package is null) = (desktop_bundle_sha256 is null))` plus the immutability trigger covering it. No route change: the control plane keeps downloading and verifying the bundle at publish and stores the hash. The control plane then drops the in-memory cache and flips the Build-release test to expect 200.",
  "decision": {
    "outcome": "accepted",
    "contractsVersion": "5.6.0",
    "note": "Accepted, migration 0008_build_release.sql (numbered after ws/protocol's 0007; commutes with it): Build, and only Build, may list desktop with no package; desktop_bundle_sha256 is covered by the immutability trigger. Implemented on ws/blockers: the control plane stores the bundle hash at publish and reads it from the row (the in-memory cache is gone; reads never download), the Build-release test publishes and reads Build back, and migration 0009 (contracts 5.7.0, B-0009-control-plane) makes the hash present exactly with a package, as this blocker asked. Production: the coordinator applies 0008 and 0009 through the runner (--check first), then a maintainer publishes Build with tools/registry/publish-build-release.mjs.",
    "decidedAt": "2026-09-30T17:29:27Z"
  }
}
```

Until this is ruled:
- Build has no registry release, so it is absent from `listApps`/`getApp` and `OrgApps`, exactly as the 5.2.0 shared rules describe for an unreleased Build. Its entitlement still gates claims (S-40), and migration 0006 already enabled it on every pre-0006 personal organization. New accounts cannot enable Build through `enableApp` until it has a release, because `enableApp` answers with the registry entry.
- Registry reads of an app with a desktop package are correct but may download the bundle once per cold start to compute `package.sha256`. A failed download answers 500 rather than a guessed hash.
