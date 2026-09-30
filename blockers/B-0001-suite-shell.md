```json
{
  "id": "B-0001-suite-shell",
  "status": "resolved",
  "raisedBy": "suite-shell",
  "raisedAt": "2026-09-30T17:07:45Z",
  "affectedContract": "packages/contracts/src/wos-app.ts CoreRoutes; packages/contracts/src/blocker.ts Workstream; docs/architecture/WORKSTREAMS.md 12.4 (suite-shell row)",
  "reason": "EnvironmentAuth kind `local` has no route contract, so Desktop and wOS Mobile cannot sign in to a self-hosted Core without copying suite-shell's private routes. The blocker Workstream enum has no suite-shell or mobile-runtime, so this file cannot name its real author. The 12.4 suite-shell row omits exports the web shell must use to reach wOS Cloud.",
  "evidence": "templates/product/apps/api/src/app.ts LocalAuthRoutes (POST /v1/core/auth/local/start, /v1/core/auth/local/redeem, /v1/core/auth/logout) are served and tested (apps/api/test/core.test.ts 'local sign-in'), but CoreRoutes lists only environment, activeApps and screens. ArchitectureBlocker.parse refuses raisedBy 'suite-shell' (packages/contracts/test/blockers.test.ts).",
  "requestedCapability": "(1) MINOR: add the three local sign-in routes to CoreRoutes with these shapes: start body { email } -> 202 { requestId: Uuid, expiresAt: Timestamp } (same answer for any address; only allowed addresses receive a code); redeem body { requestId: Uuid, code: 'XXXX-XXXX' } -> { token, expiresAt, userId, organizationId, role: OrgRole } (single use, 15 min, 5 tries, 401 UNAUTHENTICATED otherwise); logout with Bearer -> { ok: true }. The token is the Bearer for every CoreRoutes call on that Core. (2) MINOR: add suite-shell and mobile-runtime to Workstream. (3) Add to the 12.4 suite-shell row the existing exports it uses: Routes.startEmailSignIn / redeemEmailSignIn / refreshSession / logout, AppRoutes.listMyOrganizations / issueEnvironmentToken / getEnvironmentKeys, OrganizationView, OrgRole, ApiErrorCode, CORE_APP_ID, ENVIRONMENT_TOKEN_TTL_SECONDS, ENVIRONMENT_TOKEN_SKEW_SECONDS, ACTIVE_APPS_REFRESH_SECONDS, CONTRACTS_VERSION, and /canonical signEnvironmentToken and encodeDevicePublicKey (tests only).",
  "affectedWorkstreams": [
    "architect",
    "desktop"
  ],
  "suggestedResolution": "Contracts 5.4.0 (MINOR): CoreRoutes.localSignInStart / localSignInRedeem / logout exactly as implemented in templates/product/apps/api/src/app.ts; Workstream += suite-shell, mobile-runtime; WORKSTREAMS 12.4 lists the extra names. mobile-runtime (not in the enum either) is affected too.",
  "decision": {
    "outcome": "accepted",
    "contractsVersion": "5.6.0",
    "note": "Accepted as requested (WORKSTREAMS 14). (1) CoreRoutes.localSignInStart / localSignInRedeem / logout with the implemented shapes (LocalSignInStartBody, LocalSignInStartResponse, LocalSignInRedeemBody, LocalSignInRedeemResponse); a wOS Cloud Core answers 404 to the two sign-in routes, and logout with an environment token is a no-op { ok: true }. (2) Workstream gains suite-shell and mobile-runtime; this file and B-0002/B-0003-suite-shell now name suite-shell. (3) WORKSTREAMS 12.4's suite-shell row lists the extra exports. Implemented on ws/blockers: Core serves the routes from CoreRoutes (the private LocalAuthRoutes table is gone), logout needs a Bearer, and responses are parsed with the contract schemas (apps/api/test/core.test.ts).",
    "decidedAt": "2026-09-30T17:29:27Z"
  }
}
```

`raisedBy` read `architect` until contracts 5.6.0 added `suite-shell` to `Workstream` (item 2); corrected on ws/blockers.

Until the architect rules, Core serves the three routes as implemented and wOS Web uses them. Nothing in `packages/contracts/**` was changed; the web shell imports the section-B names through `templates/product/modules/core-contracts/src/index.ts`, which re-exports the vendored copy and defines no schema.
