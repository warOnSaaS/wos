/**
 * S-43 end to end (B-0002-suite-shell, B-0008-control-plane): the product template's wOS Web and hosted wOS Core
 * driven against THIS control plane (real routes, real database), not a test double. wOS Web signs in as clientKind
 * web_app from its server; the emailed link lands on app.waronsaas.com/sign-in/code and works only in the browser
 * that started; the control plane sets no cookie on any of it; environment tokens come from issueEnvironmentToken.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BUNDLED_APPS } from "../../../templates/product/applications/registry.js";
import { createCoreApp } from "../../../templates/product/apps/api/src/app.js";
import { loadConfig } from "../../../templates/product/apps/api/src/config.js";
import { createWebApp } from "../../../templates/product/apps/web/src/app.js";
import { Browser } from "../../../templates/product/apps/web/test/browser.js";
import { loadBundle } from "../../../templates/product/modules/core/src/bundle.js";
import { createHarness, HAS_DB, type Harness } from "./support/harness.js";

const API = "https://api.waronsaas.com";
const CORE = "https://core.waronsaas.test";

describe.skipIf(!HAS_DB)("S-43: wOS Web against the control plane", () => {
  let h: Harness;
  const controlPlaneCookies: string[] = [];
  const controlPlaneCalls: string[] = [];
  let web: ReturnType<typeof createWebApp>;

  beforeAll(async () => {
    h = await createHarness();
    const toControlPlane = async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (!url.startsWith(`${API}/`)) throw new Error(`unexpected call to ${url}`);
      controlPlaneCalls.push(`${init?.method ?? "GET"} ${new URL(url).pathname}`);
      const res = await h.app.request(url, init);
      controlPlaneCookies.push(...res.headers.getSetCookie());
      return res;
    };
    const bundle = loadBundle(BUNDLED_APPS);
    const core = createCoreApp({
      config: loadConfig(
        { WOS_MODE: "cloud", WOS_PUBLIC_URL: CORE, WOS_CORE_SECRET: "core-secret-0123456789abcdef0123456789", WOS_CONTROL_PLANE_URL: API },
        bundle,
      ),
      bundle,
      store: null,
      mailer: null,
      fetch: toControlPlane,
      now: () => new Date(),
      log: () => {},
    });
    web = createWebApp({
      config: { coreUrl: CORE, sessionSecret: "web-session-secret-0123456789abcdef", secureCookies: true },
      coreFetch: async (input, init) => core.fetch(new Request(String(input), init)),
      cloudFetch: toControlPlane,
      now: () => new Date(),
    });
  });
  afterAll(async () => {
    await h?.close();
  });

  const emailedLink = (email: string) => {
    const text = [...h.mailer.sent].reverse().find((m) => m.to === email)!.text;
    return new URL(/(https:\/\/\S+)/.exec(text)![1]!);
  };

  it("signs in through the emailed link in the starting browser, then shows Your Apps from the control plane", async () => {
    const b = new Browser(web);
    const started = await b.post("/sign-in", { email: "shell@example.com" });
    expect(started.headers.get("location")).toBe("/sign-in/code");
    const link = emailedLink("shell@example.com");
    expect(link.origin).toBe("https://app.waronsaas.com");
    expect(link.pathname).toBe("/sign-in/code");

    // Another browser cannot use it, and the page does not show the link token.
    const other = await new Browser(web).get(`${link.pathname}${link.search}`);
    expect(other.status).toBe(400);
    expect(await other.text()).not.toContain(link.searchParams.get("t")!);

    const done = await b.get(`${link.pathname}${link.search}`);
    expect(done.status, await done.clone().text()).toBe(302);
    expect(done.headers.get("location")).toBe("/core/apps");
    const apps = await b.get("/core/apps");
    expect(apps.status, await apps.clone().text()).toBe(200);
    expect(await apps.text()).toContain("YOUR APPS");

    // Reusing the link (in the same browser, after a new start) is refused by the control plane.
    await b.post("/sign-in", { email: "shell@example.com" });
    expect((await b.get(`${link.pathname}${link.search}`)).status).toBe(400);

    const [session] = await h.owner<{ client_kind: string; device_id: string | null }[]>`
      select s.client_kind, s.device_id from wos.sessions s join wos.account_emails e on e.account_id = s.account_id
       where e.email_normalized = 'shell@example.com' order by s.created_at limit 1`;
    expect(session).toEqual({ client_kind: "web_app", device_id: null });
    expect(controlPlaneCalls).toContain("POST /v1/auth/email/start");
    expect(controlPlaneCalls).toContain("POST /v1/auth/email/redeem");
    expect(controlPlaneCalls.some((c) => c.startsWith("POST /v1/environments/"))).toBe(true);
    // Nothing is carried by control-plane cookies: it sets none for web_app.
    expect(controlPlaneCookies).toEqual([]);
    expect(h.violations).toEqual([]);
  });

  it("the typed code works too, and only with this browser's sign-in", async () => {
    const b = new Browser(web);
    await b.post("/sign-in", { email: "shell-code@example.com" });
    const { code } = h.mailer.lastTo("shell-code@example.com");
    const intruder = new Browser(web);
    expect((await intruder.post("/sign-in/code", { code })).headers.get("location")).toBe("/sign-in");
    const done = await b.post("/sign-in/code", { code });
    expect(done.headers.get("location")).toBe("/core/apps");
    expect((await b.get("/core/apps")).status).toBe(200);
    expect(controlPlaneCookies).toEqual([]);
  });
});
