/** Contracts 5.6.0: rulings on B-0001/B-0002/B-0003-suite-shell and B-0007/B-0008-control-plane. */
import { describe, expect, it } from "vitest";
import { ArchitectureBlocker, CoreRoutes, HOSTS, RepoManifest, Routes, WEB_APP_SIGNIN_CODE_PATH } from "../src/index.js";

describe("contracts 5.6.0 rulings", () => {
  it("B-0001: local sign-in is part of CoreRoutes, with the implemented shapes", () => {
    expect(CoreRoutes.localSignInStart.path).toBe("/v1/core/auth/local/start");
    expect(CoreRoutes.localSignInStart.body.safeParse({ email: "a@example.com" }).success).toBe(true);
    expect(
      CoreRoutes.localSignInRedeem.body.safeParse({ requestId: "0192f000-0000-7000-8000-000000000001", code: "ABCD-EFGH" }).success,
    ).toBe(true);
    expect(
      CoreRoutes.localSignInRedeem.body.safeParse({ requestId: "0192f000-0000-7000-8000-000000000001", code: "abcd-efgh" }).success,
    ).toBe(false);
    expect(CoreRoutes.logout.auth).toBe("environment_session");
  });

  it("B-0001: suite-shell and mobile-runtime can raise blockers", () => {
    for (const ws of ["suite-shell", "mobile-runtime"]) expect(ArchitectureBlocker.shape.raisedBy.safeParse(ws).success).toBe(true);
  });

  it("B-0002: wOS Web signs in as the server-side client web_app, the link lands on app.waronsaas.com", () => {
    const start = { email: "a@example.com", clientKind: "web_app", deviceName: null, devicePublicKey: null };
    expect(Routes.startEmailSignIn.body.safeParse(start).success).toBe(true);
    expect(`${HOSTS.app}${WEB_APP_SIGNIN_CODE_PATH}`).toBe("https://app.waronsaas.com/sign-in/code");
  });

  it("B-0008: the CSRF value can travel in the web redeem and refresh bodies (optional)", () => {
    expect(Routes.refreshSession.response.shape.csrfToken.safeParse(undefined).success).toBe(true);
    expect(Routes.redeemEmailSignIn.response.shape.csrfToken.safeParse("x".repeat(32)).success).toBe(true);
  });

  it("B-0003: per-app migrations directory", () => {
    const ok = RepoManifest.shape.appMigrationsDir;
    expect(ok.safeParse("applications/*/migrations").success).toBe(true);
    expect(ok.safeParse("applications/**/migrations").success).toBe(false);
    expect(ok.safeParse("*/migrations").success).toBe(false);
  });
});
