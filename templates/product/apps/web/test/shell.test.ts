import { describe, expect, it } from "vitest";
import type { Fetch } from "../../../modules/core/src/env-token.js";
import { CONTROL_PLANE, Clock, cloudCore, forbiddenFetch, selfHostedCore, testKey } from "../../api/test/support.js";
import { createWebApp } from "../src/app.js";
import { Browser, csrfIn, navIn } from "./browser.js";
import { CODE, fakeControlPlane } from "./fake-control-plane.js";

const SESSION_SECRET = "web-session-secret-0123456789abcdef";
type Fetchable = { fetch: (req: Request) => Response | Promise<Response> };
/** Routes an absolute URL to an in-process app: no socket, no DNS. */
const via =
  (base: string, app: Fetchable): Fetch =>
  async (input, init) => {
    if (!String(input).startsWith(base)) throw new Error(`unexpected call to ${String(input)}`);
    return app.fetch(new Request(String(input), init));
  };

async function signInSelfHosted(b: Browser, mailer: { sent: { to: string; code: string }[] }, email: string) {
  expect((await b.get("/")).headers.get("location")).toBe("/sign-in");
  expect(await (await b.get("/sign-in")).text()).toContain("Sign in to Self-hosted wOS.");
  const sent = await b.post("/sign-in", { email });
  expect(sent.headers.get("location")).toBe("/sign-in/code");
  const code = mailer.sent.find((m) => m.to === email)!.code;
  const done = await b.post("/sign-in/code", { code: code.replace("-", "").toLowerCase() });
  expect(done.headers.get("location")).toBe("/core/apps");
}

describe("suite-shell V1 proof step 8 (in process): self-hosted Core with WOS_APPS=crm and no route to warOnSaaS", () => {
  it("wOS Web signs in locally and shows CRM in navigation, with 0 features and nothing fetched from outside", async () => {
    const coreCalls: string[] = [];
    const webCloudCalls: string[] = [];
    const core = selfHostedCore({ apps: "crm", fetchCalls: coreCalls });
    const web = createWebApp({
      config: { coreUrl: "http://core.internal:8080", sessionSecret: SESSION_SECRET, secureCookies: false },
      coreFetch: via("http://core.internal:8080", core.app),
      cloudFetch: forbiddenFetch(webCloudCalls),
      now: () => core.clock.now,
    });
    const b = new Browser(web);
    await signInSelfHosted(b, core.mailer, "owner@example.test");

    const apps = await (await b.get("/core/apps")).text();
    expect(navIn(apps)).toEqual(["core:/core/apps", "crm:/crm"]);
    expect(apps).toContain("YOUR APPS");
    expect(apps).toMatch(/data-app="crm"><td>wOS CRM/);
    expect(apps).toMatch(/data-app="contacts"><td>wOS Contacts.*REQUIRED BY AN ACTIVE APP/s);
    expect(apps).toContain("WOS_APPS");
    expect(apps).toContain("Self-hosted");

    const crm = await b.get("/crm");
    expect(crm.status).toBe(200);
    const page = await crm.text();
    expect(page).toContain("<h1>wOS CRM</h1>");
    expect(page).toContain('<p class="big">0</p>');
    expect(page).toContain("No CRM feature is built yet.");

    expect(coreCalls).toEqual([]);
    expect(webCloudCalls).toEqual([]);
  });

  it("without CRM in WOS_APPS the navigation has no CRM and /crm is not active", async () => {
    const core = selfHostedCore({ apps: "" });
    const web = createWebApp({
      config: { coreUrl: "http://core.internal:8080", sessionSecret: SESSION_SECRET, secureCookies: false },
      coreFetch: via("http://core.internal:8080", core.app),
      cloudFetch: forbiddenFetch([]),
      now: () => core.clock.now,
    });
    const b = new Browser(web);
    await signInSelfHosted(b, core.mailer, "owner@example.test");
    expect(navIn(await (await b.get("/core/apps")).text())).toEqual(["core:/core/apps"]);
    expect((await b.get("/crm")).status).toBe(404);
  });
});

describe("suite-shell wOS Web on wOS Cloud (proof steps 2, 3, 5, 7 against a control-plane test double)", () => {
  function cloud() {
    const key = testKey();
    const clock = new Clock();
    const cp = fakeControlPlane(key, clock, CONTROL_PLANE);
    const core = cloudCore({ keys: () => [key], clock, fetch: via(CONTROL_PLANE, cp.app) });
    const web = createWebApp({
      config: { coreUrl: "https://core.example.test", sessionSecret: SESSION_SECRET, secureCookies: true },
      coreFetch: via("https://core.example.test", core.app),
      cloudFetch: via(CONTROL_PLANE, cp.app),
      now: () => clock.now,
    });
    return { b: new Browser(web), web, clock, cp };
  }

  const linkPath = (cp: ReturnType<typeof cloud>["cp"]) => {
    const u = new URL(cp.mails.at(-1)!.link);
    return { url: u, path: `${u.pathname}${u.search}`, token: u.searchParams.get("t")! };
  };

  it("S-43: the emailed link lands on app.waronsaas.com/sign-in/code and signs in the browser that started", async () => {
    const { b, cp } = cloud();
    await b.post("/sign-in", { email: "sam@example.test" });
    const { url, path } = linkPath(cp);
    expect(url.origin).toBe("https://app.waronsaas.com");
    expect(url.pathname).toBe("/sign-in/code");
    const done = await b.get(path);
    expect(done.headers.get("location")).toBe("/core/apps");
    expect((await b.get("/core/apps")).status).toBe(200);
    // Every cookie wOS Web sets is host-only, HttpOnly, SameSite=Lax and Secure (secureCookies: true).
    const again = cloud();
    const started = await again.b.post("/sign-in", { email: "sam@example.test" });
    const finished = await again.b.get(linkPath(again.cp).path);
    const set = [...started.headers.getSetCookie(), ...finished.headers.getSetCookie()];
    expect(set.length).toBeGreaterThanOrEqual(3);
    for (const c of set) {
      expect(c, c).not.toMatch(/;\s*domain=/i);
      expect(c, c).toMatch(/;\s*HttpOnly/i);
      expect(c, c).toMatch(/;\s*SameSite=Lax/i);
      expect(c, c).toMatch(/;\s*Secure/i);
    }
  });

  it("S-43: the link opened in another browser, reused, for another request or after 15 minutes does not sign in", async () => {
    const { b, web, cp, clock } = cloud();
    await b.post("/sign-in", { email: "sam@example.test" });
    const { path, token, url } = linkPath(cp);
    // Another browser: no sealed pollSecret. The page says so and never shows the token.
    const elsewhere = new Browser(web);
    const other = await elsewhere.get(path);
    expect(other.status).toBe(400);
    const page = await other.text();
    expect(page).toContain("OPEN IT WHERE YOU STARTED");
    expect(page).not.toContain(token);
    expect(page).not.toContain('name="code"');
    expect((await elsewhere.get("/core/apps")).headers.get("location")).toBe("/sign-in");
    // Wrong request id in this browser.
    const wrong = `${url.pathname}?${new URLSearchParams({ r: "0192f000-0000-7000-8000-00000000ffff", t: token })}`;
    expect((await b.get(wrong)).status).toBe(400);
    // The right browser signs in once; the same link again is refused.
    expect((await b.get(path)).headers.get("location")).toBe("/core/apps");
    const b2 = new Browser(web);
    await b2.post("/sign-in", { email: "sam@example.test" });
    const first = linkPath(cp);
    expect((await b2.get(first.path)).status).toBe(302);
    await b2.post("/sign-in", { email: "sam@example.test" });
    const reuse = await b2.get(first.path);
    expect(reuse.status).toBe(400);
    // Expired: 15 minutes after start.
    const b3 = new Browser(web);
    await b3.post("/sign-in", { email: "sam@example.test" });
    const late = linkPath(cp);
    clock.advance(16 * 60);
    expect((await b3.get(late.path)).status).toBe(400);
  });

  it("enabling CRM puts it in navigation at once; disabling removes it; the entitlement row is kept", async () => {
    const { b, cp } = cloud();
    expect(await (await b.get("/sign-in")).text()).toContain("Sign in with your warOnSaaS account.");
    await b.post("/sign-in", { email: "sam@example.test" });
    expect((await b.post("/sign-in/code", { code: CODE })).headers.get("location")).toBe("/core/apps");

    let html = await (await b.get("/core/apps")).text();
    expect(navIn(html)).toEqual(["core:/core/apps"]);
    expect(html).toMatch(/AVAILABLE APPS.*data-app="crm".*ENABLE/s);
    expect((await b.get("/crm")).status).toBe(404);

    expect(html).toMatch(/data-app="crm".*name="rowVersion" value=""/s);
    const enabled = await b.post("/core/apps/crm/enable", { csrf: csrfIn(html), rowVersion: "" });
    expect(enabled.headers.get("location")).toBe("/core/apps");
    html = await (await b.get("/core/apps")).text();
    expect(navIn(html)).toEqual(["core:/core/apps", "crm:/crm"]);
    expect(html).toMatch(/YOUR APPS.*data-app="crm".*ENABLED.*DISABLE/s);
    expect(html).toMatch(/data-app="contacts".*PART OF wOS/s);
    const crm = await (await b.get("/crm")).text();
    expect(crm).toContain("No CRM feature is built yet.");

    expect(html).toMatch(/data-app="crm".*name="rowVersion" value="1"/s);
    await b.post("/core/apps/crm/disable", { csrf: csrfIn(html), rowVersion: "1" });
    html = await (await b.get("/core/apps")).text();
    expect(navIn(html)).toEqual(["core:/core/apps"]);
    expect((await b.get("/crm")).status).toBe(404);
    expect(cp.entitlements.get("crm")).toMatchObject({ state: "disabled", rowVersion: 2 });
  });

  it("refuses enable without the CSRF token, and a tampered session cookie means signing in again", async () => {
    const { b, web } = cloud();
    await b.post("/sign-in", { email: "sam@example.test" });
    await b.post("/sign-in/code", { code: CODE });
    expect((await b.post("/core/apps/crm/enable", { csrf: "nope", rowVersion: "0" })).status).toBe(403);
    const res = await web.request("/core/apps", { headers: { cookie: "wos_web=AAAA" } });
    expect(res.headers.get("location")).toBe("/sign-in");
  });

  it("a wrong code is refused", async () => {
    const { b } = cloud();
    await b.post("/sign-in", { email: "sam@example.test" });
    expect((await b.post("/sign-in/code", { code: "ZZZZ-ZZZZ" })).status).toBe(401);
  });

  it("renews the 15-minute environment token as it nears expiry", async () => {
    const { b, clock } = cloud();
    await b.post("/sign-in", { email: "sam@example.test" });
    await b.post("/sign-in/code", { code: CODE });
    expect((await b.get("/core/apps")).status).toBe(200);
    clock.advance(20 * 60);
    expect((await b.get("/core/apps")).status).toBe(200);
  });
});

describe("suite-shell wOS Web: brand and headers", () => {
  it("monochrome console, wOS mark in Geist Mono Bold, JetBrains Mono body, a nonce CSP, no text-transform", async () => {
    const core = selfHostedCore({ apps: "crm" });
    const web = createWebApp({
      config: { coreUrl: "http://core.internal:8080", sessionSecret: SESSION_SECRET, secureCookies: false },
      coreFetch: via("http://core.internal:8080", core.app),
      cloudFetch: forbiddenFetch([]),
      now: () => core.clock.now,
    });
    const b = new Browser(web);
    await signInSelfHosted(b, core.mailer, "owner@example.test");
    const res = await b.get("/core/apps");
    const html = await res.text();
    expect(res.headers.get("content-security-policy")).toMatch(/script-src 'nonce-[^']+'/);
    expect(res.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
    expect(html).toContain('<a class="mark" href="/">wOS</a>');
    expect(html).toContain("--bg:#0b0b0b");
    expect(html).toContain('"Geist Mono"');
    expect(html).toContain('"JetBrains Mono"');
    expect(html).not.toMatch(/text-transform|italic;|#[0-9a-f]{3,6}(?<!0b0b0b|ededea|d9d9d6|a8a8a5|3d3d3b|141414)\b/i);
    // Casing: never re-cased product names in visible text.
    const text = html.replace(/<[^>]+>/g, " ");
    expect(text).not.toMatch(/\bWOS\b(?!_APPS)|\bWos\b|\bwos\b|\bWaronsaas\b|\bWARONSAAS\b/);
  });
});
