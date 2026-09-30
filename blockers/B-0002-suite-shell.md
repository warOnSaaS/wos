```json
{
  "id": "B-0002-suite-shell",
  "status": "open",
  "raisedBy": "architect",
  "raisedAt": "2026-09-30T17:07:45Z",
  "affectedContract": "packages/contracts/src/api.ts Routes.startEmailSignIn / redeemEmailSignIn / refreshSession (clientKind, cookies, email link); services/control-plane cookieDomain; ARCHITECTURE A10",
  "reason": "wOS Web at app.waronsaas.com has no defined way to sign a wOS account in. The control plane's CORS allows only https://waronsaas.com, sign-in email links point at https://waronsaas.com/auth/verify, and web clients receive their tokens only as Set-Cookie headers. Also, in production the control plane sets cookies with Domain=waronsaas.com, so wos_session and wos_refresh are sent to every subdomain (app., core.), against A10 (separate origins, no shared cookies).",
  "evidence": "services/control-plane/src/http/router.ts cors origin === config.webOrigin; services/control-plane/src/handlers/account.ts signinMail link `${webOrigin}/auth/verify`, setWebSessionCookies and the empty accessToken/refreshToken in the web redeem and refresh responses; services/control-plane/src/deps.ts cookieDomain = hostname of webOrigin in production. Workaround in templates/product/apps/web/src/cloud-client.ts: wOS Web calls the control plane server-to-server as clientKind 'web', reads pollSecret and the session tokens from Set-Cookie, keeps them in its own sealed HttpOnly cookie, and asks the user to type the 8-character code (the emailed link opens waronsaas.com instead). Tested against a control-plane test double only (apps/web/test/fake-control-plane.ts).",
  "requestedCapability": "A sanctioned sign-in for authenticated wOS Web: either a `clientKind` for a server-side web shell that returns tokens in the body (like desktop and cli, with devicePublicKey null), or an allowed origin plus an email link that returns to https://app.waronsaas.com/sign-in/code. And host-only session cookies on api.waronsaas.com (no Domain attribute).",
  "affectedWorkstreams": ["control-plane", "architect"],
  "suggestedResolution": "Contracts MINOR: add clientKind 'web_app' (server-side wOS Web; tokens in the body; the email link goes to HOSTS.app + '/sign-in/code?r=&t='), and drop the Domain attribute from control-plane cookies. wOS Web then stops reading Set-Cookie. Until then the code path works and the link does not.",
  "decision": null
}
```

`raisedBy` is `architect` only because `Workstream` has no `suite-shell` (B-0001-suite-shell item 2).

Proof steps 2, 3, 5 and 7 on the hosted side depend on this and on the control plane serving `AppRoutes`. They are tested in process against a test double of the control plane (`templates/product/apps/web/test/shell.test.ts`), not against api.waronsaas.com.
