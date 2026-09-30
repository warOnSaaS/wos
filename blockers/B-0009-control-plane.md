```json
{
  "id": "B-0009-control-plane",
  "status": "resolved",
  "raisedBy": "control-plane",
  "raisedAt": "2026-09-30T17:40:00Z",
  "affectedContract": "packages/db/migrations/0001_init.sql (client_kind checks of wos.email_signin_requests and wos.sessions) against packages/contracts/src/api.ts startEmailSignIn.clientKind web_app (5.6.0); packages/db/migrations/0008_build_release.sql (desktop_bundle_sha256 optional with a package)",
  "reason": "The 5.6.0 ruling on B-0002-suite-shell added clientKind web_app to the contract but no migration: 0001 limits client_kind to web, desktop and cli on the sign-in request and on the session, so a web_app sign-in is refused by the database (check_violation) and S-43 cannot be implemented as written. Separately, 0008 made desktop_bundle_sha256 optional with a package so the pre-ruling control plane kept working; once the control plane writes it at every publish, B-0007-control-plane's check (the hash exactly with a package) can hold.",
  "evidence": "Implementing S-43 on ws/blockers: POST /v1/auth/email/start with clientKind web_app inserts wos.email_signin_requests.client_kind = 'web_app', which the 0001 check refuses; the session insert on redeem likewise. wos.devices needs no change (web_app registers no device).",
  "requestedCapability": "A migration letting wos.email_signin_requests and wos.sessions store client_kind web_app, and making desktop_bundle_sha256 present exactly with a desktop package.",
  "affectedWorkstreams": ["control-plane", "suite-shell"],
  "suggestedResolution": "Migration 0009_web_app_client.sql (0007 is ws/protocol's, 0008 is B-0007's): replace the two client_kind checks with ones that add web_app; replace app_releases_desktop_bundle_sha256 with (desktop_package is null) = (desktop_bundle_sha256 is null). Contracts 5.7.0, MINOR by the same reasoning as 0008.",
  "decision": {
    "outcome": "accepted",
    "contractsVersion": "5.7.0",
    "note": "Accepted by the architect role held by ws/blockers for this change (the coordinator's grant). Migration 0009_web_app_client.sql as suggested; db assertions cover both checks and that web_app still has no device. MINOR: the widened checks are additive, and the tightened hash check binds only the control plane, which writes the hash at every publish in the same change; no row in production can violate it unless a release with a desktop package exists without a hash, and then the migration fails in its transaction and changes nothing. Production: 0009 after 0008, by the coordinator through the runner, --check first.",
    "decidedAt": "2026-09-30T17:40:00Z"
  }
}
```

Found while implementing the 5.6.0 rulings (WORKSTREAMS 14). The contract's shapes are unchanged; only the database follows them.
