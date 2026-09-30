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
