```json
{
  "id": "B-0008-control-plane",
  "status": "resolved",
  "raisedBy": "control-plane",
  "raisedAt": "2026-09-30T13:30:00-04:00",
  "affectedContract": "docs/architecture/SECURITY.md S-5 (Domain=waronsaas.com on wos_session) versus ARCHITECTURE.md A10 (app.waronsaas.com and waronsaas.com share no cookies); raised with B-0002-suite-shell",
  "reason": "B-0002-suite-shell found that the control plane's production cookies carry Domain=waronsaas.com, so wos_session, wos_refresh, wos_csrf and wos_signin also reach app.waronsaas.com and core.waronsaas.com. That is what S-5 specifies, word for word, and the S-5 CSRF design depends on it: the double-submit header X-wOS-Csrf is copied by waronsaas.com page script from the non-HttpOnly wos_csrf cookie, which that script can read only if the cookie's Domain covers waronsaas.com. A host-only cookie (scoped to api.waronsaas.com) would still be sent by the browser on credentialed requests from waronsaas.com (same site, SameSite=Lax), but waronsaas.com could no longer read wos_csrf, so every cookie-authenticated write from the site would answer 403. The control plane cannot make the cookies host-only without contradicting S-5, and S-5 conflicts with A10 once app.waronsaas.com exists.",
  "evidence": "services/control-plane/src/deps.ts configFromEnv: cookieDomain = hostname of WEB_ORIGIN in production (waronsaas.com); router.ts setCookie adds Domain from it. services/control-plane/test/cookies.test.ts asserts the S-5 attributes as they stand: Secure, SameSite=Lax, HttpOnly on wos_session/wos_refresh/wos_signin, wos_csrf readable, wos_refresh and wos_signin Path=/v1/auth, Domain=waronsaas.com. Current clients: Desktop and the CLI use Authorization: Bearer (no cookies); apps/web (waronsaas.com) has no browser sign-in or credentialed API call today (no credentials/csrf use in apps/web), so a host-only change would break no current flow, only the S-5 design for the site's future web sign-in.",
  "requestedCapability": "A ruling on the cookie scope: keep S-5 as is, or amend S-5 to host-only cookies with a CSRF mechanism that does not need the site to read a cookie (for example the CSRF token returned in the redeem/refresh response body, or a token endpoint under CORS).",
  "affectedWorkstreams": [
    "control-plane",
    "web",
    "architect"
  ],
  "suggestedResolution": "Amend S-5: cookies host-only on api.waronsaas.com (no Domain), Secure, SameSite=Lax (wos_session could be Strict), HttpOnly on all four including wos_csrf; the CSRF value is returned in the redeem and refresh response bodies to the web client (a new optional field, MINOR) and sent back as X-wOS-Csrf; the router keeps comparing header to cookie. The control plane change is one line (cookieDomain null) plus the response field.",
  "decision": {
    "outcome": "accepted",
    "contractsVersion": "5.6.0",
    "note": "Accepted, S-5 amended: every control-plane cookie is host-only (no Domain), HttpOnly (wos_csrf included), Secure and SameSite=Lax; the CSRF value is returned to clientKind web as csrfToken in the redeem and refresh bodies and sent back as X-wOS-Csrf, the router still comparing header and cookie; CORS stays https://waronsaas.com only. Implemented on ws/blockers: Config has no cookieDomain any more, the router always sets HttpOnly and never Domain, logout also clears wos_csrf (services/control-plane/test/cookies.test.ts).",
    "decidedAt": "2026-09-30T17:29:27Z"
  }
}
```

suite-shell (not yet a workstream id in `ArchitectureBlocker`) is affected too: it raised B-0002-suite-shell.
