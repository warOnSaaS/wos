```json
{
  "id": "B-0002-suite-shell",
  "status": "resolved",
  "raisedBy": "suite-shell",
  "raisedAt": "2026-09-30T17:07:45Z",
  "affectedContract": "packages/contracts/src/api.ts Routes.startEmailSignIn / redeemEmailSignIn / refreshSession (clientKind, cookies, email link); services/control-plane cookieDomain; ARCHITECTURE A10",
  "reason": "wOS Web at app.waronsaas.com has no defined way to sign a wOS account in. The control plane's CORS allows only https://waronsaas.com, sign-in email links point at https://waronsaas.com/auth/verify, and web clients receive their tokens only as Set-Cookie headers. Also, in production the control plane sets cookies with Domain=waronsaas.com, so wos_session and wos_refresh are sent to every subdomain (app., core.), against A10 (separate origins, no shared cookies).",
  "evidence": "services/control-plane/src/http/router.ts cors origin === config.webOrigin; services/control-plane/src/handlers/account.ts signinMail link `${webOrigin}/auth/verify`, setWebSessionCookies and the empty accessToken/refreshToken in the web redeem and refresh responses; services/control-plane/src/deps.ts cookieDomain = hostname of webOrigin in production. Workaround in templates/product/apps/web/src/cloud-client.ts: wOS Web calls the control plane server-to-server as clientKind 'web', reads pollSecret and the session tokens from Set-Cookie, keeps them in its own sealed HttpOnly cookie, and asks the user to type the 8-character code (the emailed link opens waronsaas.com instead). Tested against a control-plane test double only (apps/web/test/fake-control-plane.ts).",
  "requestedCapability": "A sanctioned sign-in for authenticated wOS Web: either a `clientKind` for a server-side web shell that returns tokens in the body (like desktop and cli, with devicePublicKey null), or an allowed origin plus an email link that returns to https://app.waronsaas.com/sign-in/code. And host-only session cookies on api.waronsaas.com (no Domain attribute).",
  "affectedWorkstreams": [
    "control-plane",
    "architect"
  ],
  "suggestedResolution": "Contracts MINOR: add clientKind 'web_app' (server-side wOS Web; tokens in the body; the email link goes to HOSTS.app + '/sign-in/code?r=&t='), and drop the Domain attribute from control-plane cookies. wOS Web then stops reading Set-Cookie. Until then the code path works and the link does not.",
  "decision": {
    "outcome": "accepted",
    "contractsVersion": "5.6.0",
    "note": "Accepted with a first-party server-side client, not OAuth/PKCE (WORKSTREAMS 14, SECURITY S-43). startEmailSignIn.clientKind gains web_app: wOS Web's server receives the pollSecret and tokens in response bodies, server to server; the email link opens HOSTS.app + WEB_APP_SIGNIN_CODE_PATH (?r=&t=) and is redeemed only with the pollSecret sealed in the starting browser's cookie, which gives the binding PKCE would. Control-plane cookies are host-only (B-0008-control-plane). Implemented on ws/blockers: the control plane accepts web_app (migration 0009 lets the database store it, B-0009-control-plane); wOS Web no longer reads Set-Cookie, keeps tokens in its sealed host-only cookie and serves the /sign-in/code link page; tested against the real control plane (services/control-plane/test/web-app-shell.test.ts).",
    "decidedAt": "2026-09-30T17:29:27Z"
  }
}
```

`raisedBy` read `architect` until contracts 5.6.0 added `suite-shell` to `Workstream` (B-0001-suite-shell item 2); corrected on ws/blockers.

Proof steps 2, 3, 5 and 7 on the hosted side depend on this and on the control plane serving `AppRoutes`. They are tested in process against a test double of the control plane (`templates/product/apps/web/test/shell.test.ts`), not against api.waronsaas.com.
