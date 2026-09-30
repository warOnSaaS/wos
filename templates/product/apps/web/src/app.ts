/**
 * wOS Web (app.waronsaas.com, or any self-hosted Core): the authenticated shell. It reads its environment's
 * descriptor to choose the sign-in (the wOS account on wOS Cloud, local sign-in on a self-hosted Core), shows
 * Your Apps / Available Apps, builds navigation from the active manifests and renders each active app's compiled-in
 * web page. Everything is server-rendered; the browser holds sealed, HttpOnly, host-only cookies (no Domain, S-43).
 */
import { randomBytes, randomUUID } from "node:crypto";
import { Hono, type Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { BUNDLED_APPS } from "../../../applications/registry.js";
import { type AppRow, renderAppsPage } from "../../../applications/core/web/index.js";
import {
  type ActiveApps,
  type EnvironmentDescriptor,
  type OrganizationView,
  type OrgRole,
  WEB_APP_SIGNIN_CODE_PATH,
} from "../../../modules/core-contracts/src/index.js";
import { type Bundle, loadBundle } from "../../../modules/core/src/bundle.js";
import type { Fetch } from "../../../modules/core/src/env-token.js";
import { escapeHtml as e } from "../../../modules/core/src/html.js";
import { appForUiPath, navigationFor } from "../../../modules/core/src/navigation.js";
import { roleHas } from "../../../modules/core/src/permissions.js";
import { CloudClient, CloudError, type Tokens } from "./cloud-client.js";
import { CoreClient } from "./core-client.js";
import { bare, csp, shell } from "./layout.js";
import { Sealer } from "./seal.js";

export type WebConfig = {
  /** Where wOS Web reaches its Core (server to server), e.g. http://core:8080 or https://core.waronsaas.com. */
  coreUrl: string;
  sessionSecret: string;
  /** Secure cookies when wOS Web is served over https. */
  secureCookies: boolean;
};

export type WebDeps = {
  config: WebConfig;
  coreFetch: Fetch;
  /** Used ONLY when the environment is wOS Cloud (auth kind wos_cloud), to call its issuer. */
  cloudFetch: Fetch;
  now: () => Date;
  bundle?: Bundle;
};

type LocalSession = { kind: "local"; sid: string; token: string; expiresAt: string; role: OrgRole };
type CloudSession = {
  kind: "cloud";
  sid: string;
  tokens: Tokens;
  orgId: string | null;
  env: { token: string; expiresAt: string; orgId: string } | null;
};
type Session = LocalSession | CloudSession;
/** A sign-in in progress, sealed in this browser's cookie. `pollSecret` (cloud only) binds the emailed link to it. */
type Pending = { kind: "local" | "cloud"; requestId: string; pollSecret: string | null; email: string };

const SESSION_COOKIE = "wos_web";
const PENDING_COOKIE = "wos_web_pending";

type Signed = {
  descriptor: EnvironmentDescriptor;
  session: Session;
  bearer: string;
  active: ActiveApps;
  role: OrgRole;
  orgLabel: string;
  orgs: OrganizationView[];
  cloud: CloudClient | null;
};

export function createWebApp(deps: WebDeps): Hono {
  const bundle = deps.bundle ?? loadBundle(BUNDLED_APPS);
  const sealer = new Sealer(deps.config.sessionSecret);
  const core = new CoreClient(deps.config.coreUrl, deps.coreFetch, () => deps.now().getTime());
  const nowMs = () => deps.now().getTime();
  const cookieOpts = { httpOnly: true, secure: deps.config.secureCookies, sameSite: "Lax" as const, path: "/" };

  const cloudFor = (d: EnvironmentDescriptor) => (d.auth.kind === "wos_cloud" ? new CloudClient(d.auth.issuer, deps.cloudFetch) : null);
  const save = (c: Context, s: Session) => setCookie(c, SESSION_COOKIE, sealer.seal(s), { ...cookieOpts, maxAge: 30 * 24 * 3600 });
  const nonce = () => randomBytes(16).toString("base64url");
  const html = (c: Context, n: string, body: string, status = 200) => {
    c.header("content-security-policy", csp(n));
    c.header("x-content-type-options", "nosniff");
    c.header("referrer-policy", "same-origin");
    c.header("cache-control", "no-store");
    return c.html(body, status as 200);
  };

  /** Resolves the signed-in context, refreshing account and environment tokens on wOS Cloud; null = sign in. */
  async function signedIn(c: Context): Promise<Signed | null> {
    const session = sealer.open<Session>(getCookie(c, SESSION_COOKIE));
    if (!session) return null;
    const descriptor = await core.descriptor();
    if (session.kind === "local") {
      if (descriptor.auth.kind !== "local" || Date.parse(session.expiresAt) <= nowMs()) return null;
      const active = await core.activeApps(session.token);
      if (!active) return null;
      return { descriptor, session, bearer: session.token, active, role: session.role, orgLabel: descriptor.name, orgs: [], cloud: null };
    }
    const cloud = cloudFor(descriptor);
    if (!cloud) return null;
    let changed = false;
    try {
      if (Date.parse(session.tokens.accessExp) - 30_000 <= nowMs()) {
        session.tokens = await cloud.refresh(session.tokens.refresh);
        changed = true;
      }
      const orgs = await cloud.organizations(session.tokens.access);
      const org = orgs.find((o) => o.id === session.orgId) ?? orgs[0];
      if (!org) return null;
      if (session.orgId !== org.id) {
        session.orgId = org.id;
        changed = true;
      }
      if (!session.env || session.env.orgId !== org.id || Date.parse(session.env.expiresAt) - 60_000 <= nowMs()) {
        const t = await cloud.environmentToken(session.tokens.access, descriptor.environmentId, org.id);
        session.env = { ...t, orgId: org.id };
        changed = true;
      }
      const active = await core.activeApps(session.env.token);
      if (!active) return null;
      if (changed) save(c, session);
      return { descriptor, session, bearer: session.env.token, active, role: org.role, orgLabel: org.name, orgs, cloud };
    } catch (err) {
      if (err instanceof CloudError && err.status === 401) return null;
      throw err;
    }
  }

  const activeKey = (s: Signed) =>
    s.active.apps
      .map((a) => `${a.id}@${a.version}`)
      .sort()
      .join(",");

  function page(c: Context, s: Signed, title: string, body: string, status = 200) {
    const n = nonce();
    return html(
      c,
      n,
      shell({
        title,
        nonce: n,
        envName: s.descriptor.name,
        envKind: s.descriptor.kind,
        orgLabel: s.orgLabel,
        nav: navigationFor(s.active.apps, "web", s.role),
        path: new URL(c.req.url).pathname,
        csrf: sealer.csrf(s.session.sid),
        activeKey: activeKey(s),
        body,
      }),
      status,
    );
  }

  const app = new Hono();

  app.get("/", async (c) => c.redirect((await signedIn(c)) ? "/core/apps" : "/sign-in"));

  // ---- sign-in
  app.get("/sign-in", async (c) => {
    const d = await core.descriptor();
    const n = nonce();
    const how = d.auth.kind === "wos_cloud" ? "Sign in with your warOnSaaS account." : `Sign in to ${d.name}.`;
    if (d.auth.kind === "oidc")
      return html(c, n, bare({ title: "wOS", nonce: n, envName: d.name, body: "<p>OpenID Connect sign-in is not built yet.</p>" }), 501);
    return html(
      c,
      n,
      bare({
        title: "Sign in · wOS",
        nonce: n,
        envName: d.name,
        body: `<h1>SIGN IN</h1><p>${e(how)} We send a one-time code.</p>
<form method="post" action="/sign-in"><p><label>EMAIL<br><input name="email" type="email" required autocomplete="email"></label></p><button>SEND CODE</button></form>`,
      }),
    );
  });

  app.post("/sign-in", async (c) => {
    const d = await core.descriptor();
    const email = String((await c.req.parseBody()).email ?? "").trim();
    let pending: Pending;
    if (d.auth.kind === "wos_cloud") {
      const r = await cloudFor(d)!.startSignIn(email);
      pending = { kind: "cloud", requestId: r.requestId, pollSecret: r.pollSecret, email };
    } else if (d.auth.kind === "local") {
      const r = await core.startLocalSignIn(email);
      if (r.status !== 202) {
        const n = nonce();
        return html(
          c,
          n,
          bare({
            title: "Sign in · wOS",
            nonce: n,
            envName: d.name,
            body: `<p class="error">Sign-in failed (HTTP ${r.status}).</p><p><a href="/sign-in">TRY AGAIN</a></p>`,
          }),
          400,
        );
      }
      pending = { kind: "local", requestId: (r.body as { requestId: string }).requestId, pollSecret: null, email };
    } else return c.text("OpenID Connect sign-in is not built yet", 501);
    setCookie(c, PENDING_COOKIE, sealer.seal(pending), { ...cookieOpts, maxAge: 15 * 60 });
    return c.redirect(WEB_APP_SIGNIN_CODE_PATH);
  });

  /**
   * The code page, and where the emailed link lands for a wOS Cloud sign-in (HOSTS.app + WEB_APP_SIGNIN_CODE_PATH
   * + ?r=<requestId>&t=<linkToken>, S-43). The link is redeemed only with the pollSecret sealed in THIS browser's
   * pending cookie for that same request, so it is bound to the browser that started sign-in. Opened anywhere else,
   * the page says so; it never shows the link token and never offers it as a code.
   */
  app.get(WEB_APP_SIGNIN_CODE_PATH, async (c) => {
    const d = await core.descriptor();
    const p = sealer.open<Pending>(getCookie(c, PENDING_COOKIE));
    const r = c.req.query("r");
    const t = c.req.query("t");
    if (r !== undefined || t !== undefined) {
      const otherBrowser = () => {
        const n = nonce();
        return html(
          c,
          n,
          bare({
            title: "Sign in · wOS",
            nonce: n,
            envName: d.name,
            body: `<h1>OPEN IT WHERE YOU STARTED</h1><p>This sign-in link works only in the browser where you asked for it. Open the link there, or type the code from the same email in that browser.</p><p><a href="/sign-in">START AGAIN HERE</a></p>`,
          }),
          400,
        );
      };
      if (!r || !t || !p || p.kind !== "cloud" || p.requestId !== r || !p.pollSecret || d.auth.kind !== "wos_cloud") return otherBrowser();
      try {
        const tokens = await cloudFor(d)!.redeemSignIn(p.requestId, p.pollSecret, { linkToken: t });
        save(c, { kind: "cloud", sid: randomUUID(), tokens, orgId: null, env: null });
      } catch (err) {
        if (err instanceof CloudError && err.status < 500) return otherBrowser();
        throw err;
      }
      deleteCookie(c, PENDING_COOKIE, cookieOpts);
      return c.redirect("/core/apps");
    }
    if (!p) return c.redirect("/sign-in");
    const n = nonce();
    const where =
      d.auth.kind === "local"
        ? "Your operator's wOS Core sends it by email, or writes it to its log."
        : "Check your email: open its link in this browser, or type its code here.";
    return html(
      c,
      n,
      bare({
        title: "Code · wOS",
        nonce: n,
        envName: d.name,
        body: `<h1>ENTER CODE</h1><p>A code was requested for ${e(p.email)}. ${e(where)}</p>
<form method="post" action="${WEB_APP_SIGNIN_CODE_PATH}"><p><label>CODE<br><input name="code" required pattern="[A-HJ-NP-Za-hj-np-z2-9]{4}-?[A-HJ-NP-Za-hj-np-z2-9]{4}" autocomplete="one-time-code"></label></p><button>SIGN IN</button></form>`,
      }),
    );
  });

  app.post(WEB_APP_SIGNIN_CODE_PATH, async (c) => {
    const d = await core.descriptor();
    const p = sealer.open<Pending>(getCookie(c, PENDING_COOKIE));
    if (!p) return c.redirect("/sign-in");
    const raw = String((await c.req.parseBody()).code ?? "")
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, "");
    const code = `${raw.slice(0, 4)}-${raw.slice(4, 8)}`;
    const sid = randomUUID();
    const fail = () => {
      const n = nonce();
      return html(
        c,
        n,
        bare({
          title: "Code · wOS",
          nonce: n,
          envName: d.name,
          body: `<p class="error">That code was not accepted.</p><p><a href="${WEB_APP_SIGNIN_CODE_PATH}">TRY AGAIN</a></p>`,
        }),
        401,
      );
    };
    if (p.kind === "local") {
      const r = await core.redeemLocalSignIn(p.requestId, code);
      if (r.status !== 200) return fail();
      const b = r.body as { token: string; expiresAt: string; role: OrgRole };
      save(c, { kind: "local", sid, token: b.token, expiresAt: b.expiresAt, role: b.role });
    } else {
      try {
        if (!p.pollSecret) return fail();
        const tokens = await cloudFor(d)!.redeemSignIn(p.requestId, p.pollSecret, { code });
        save(c, { kind: "cloud", sid, tokens, orgId: null, env: null });
      } catch (err) {
        if (err instanceof CloudError && err.status < 500) return fail();
        throw err;
      }
    }
    deleteCookie(c, PENDING_COOKIE, cookieOpts);
    return c.redirect("/core/apps");
  });

  app.post("/sign-out", async (c) => {
    const s = sealer.open<Session>(getCookie(c, SESSION_COOKIE));
    const form = await c.req.parseBody();
    if (s && sealer.csrfOk(s.sid, String(form.csrf ?? ""))) {
      if (s.kind === "local") await core.logoutLocal(s.token).catch(() => undefined);
      else {
        const cloud = cloudFor(await core.descriptor());
        await cloud?.logout(s.tokens.access);
      }
      deleteCookie(c, SESSION_COOKIE, cookieOpts);
    }
    return c.redirect("/sign-in");
  });

  // ---- Your Apps / Available Apps
  app.get("/core/active.json", async (c) => {
    const s = await signedIn(c);
    if (!s) return c.json({ key: null }, 401);
    c.header("cache-control", "no-store");
    return c.json({ key: activeKey(s) });
  });

  app.get("/core/apps", async (c) => {
    const s = await signedIn(c);
    if (!s) return c.redirect("/sign-in");
    const coreManifest = s.active.apps.find((a) => a.id === "core")!.manifest;
    const notice = c.req.query("notice") ?? null;
    const csrf = sealer.csrf(s.session.sid);
    if (!s.cloud) {
      const yourApps: AppRow[] = s.active.apps.map((a) => ({
        id: a.id,
        name: a.manifest.app.name,
        kind: a.manifest.app.kind,
        version: a.version,
        summary: a.manifest.app.summary,
        status: a.source === "core" ? "ALWAYS ON" : a.source === "dependency" ? "REQUIRED BY AN ACTIVE APP" : "SET BY WOS_APPS",
        rowVersion: null,
        action: null,
      }));
      return page(c, s, "Apps · wOS", renderAppsPage({ mode: "self_hosted", yourApps, availableApps: null, csrf, notice }));
    }
    const cs = s.session as CloudSession;
    const orgApps = await s.cloud.orgApps(cs.tokens.access, cs.orgId!);
    const manage = roleHas(coreManifest, s.role, "core.apps.manage");
    const row = (v: (typeof orgApps.yourApps)[number], action: AppRow["action"]): AppRow => ({
      id: v.app.id,
      name: v.app.name,
      kind: v.app.kind,
      version: v.app.currentVersion,
      summary: v.app.summary,
      status: v.app.kind === "app" ? v.entitlement.state.toUpperCase() : "PART OF wOS",
      // expectedRowVersion is null while the org has no entitlement row (state available).
      rowVersion: v.entitlement.state === "available" ? null : v.entitlement.rowVersion,
      action: manage && v.app.kind === "app" ? action : null,
    });
    const orgPicker =
      s.orgs.length > 1
        ? `<form method="post" action="/core/org"><input type="hidden" name="csrf" value="${e(csrf)}"><label>ORGANIZATION <select name="org">${s.orgs
            .map((o) => `<option value="${e(o.id)}"${o.id === cs.orgId ? " selected" : ""}>${e(o.name)}</option>`)
            .join("")}</select></label> <button>SWITCH</button></form>`
        : "";
    return page(
      c,
      s,
      "Apps · wOS",
      orgPicker +
        renderAppsPage({
          mode: "cloud",
          yourApps: orgApps.yourApps.map((v) => row(v, v.entitlement.state === "enabled" ? "disable" : null)),
          availableApps: orgApps.availableApps.map((v) => row(v, v.entitlement.state === "suspended" ? null : "enable")),
          csrf,
          notice,
        }),
    );
  });

  app.post("/core/org", async (c) => {
    const s = sealer.open<Session>(getCookie(c, SESSION_COOKIE));
    const form = await c.req.parseBody();
    if (s?.kind !== "cloud" || !sealer.csrfOk(s.sid, String(form.csrf ?? ""))) return c.text("forbidden", 403);
    s.orgId = String(form.org ?? "");
    s.env = null;
    save(c, s);
    return c.redirect("/core/apps");
  });

  app.post("/core/apps/:app/:action{enable|disable}", async (c) => {
    const s = await signedIn(c);
    if (!s) return c.redirect("/sign-in");
    const form = await c.req.parseBody();
    if (!s.cloud || !sealer.csrfOk(s.session.sid, String(form.csrf ?? ""))) return c.text("forbidden", 403);
    const cs = s.session as CloudSession;
    const rv = String(form.rowVersion ?? "");
    let notice = "";
    try {
      await s.cloud.setApp(
        cs.tokens.access,
        cs.orgId!,
        c.req.param("app"),
        c.req.param("action") as "enable" | "disable",
        rv === "" ? null : Number(rv),
      );
    } catch (err) {
      if (!(err instanceof CloudError) || err.status >= 500) throw err;
      notice = `${err.code}: ${err.message}`;
    }
    // A new environment token carries the new app set, so navigation changes on this request, not in 15 minutes.
    cs.env = null;
    save(c, cs);
    return c.redirect(notice ? `/core/apps?notice=${encodeURIComponent(notice)}` : "/core/apps");
  });

  // ---- every active app's web page, under its routes.ui
  app.get("*", async (c) => {
    const path = new URL(c.req.url).pathname;
    const s = await signedIn(c);
    if (!s) return c.redirect("/sign-in");
    const active = appForUiPath(s.active.apps, path);
    const entry = active ? bundle.apps.get(active.id)?.web : null;
    const nav = active ? navigationFor([active], "web", s.role) : [];
    if (!active || !entry || nav.length === 0)
      return page(c, s, "Not active · wOS", "<h1>NOT ACTIVE</h1><p>No app active for this organization answers this address.</p>", 404);
    const body = await entry.render({
      manifest: active.manifest,
      path,
      callApi: (p) => {
        const prefix = `${active.manifest.routes.api}/`;
        if (!active.manifest.routes.api || !p.startsWith(prefix)) throw new Error(`${active.id} may call only ${prefix}`);
        return core.getApp(p, s.bearer);
      },
    });
    return page(c, s, `${active.manifest.app.name} · wOS`, body);
  });

  app.onError((err, c) => {
    const n = nonce();
    process.stderr.write(`wOS Web error: ${err.message}\n`);
    return html(
      c,
      n,
      bare({ title: "Error · wOS", nonce: n, envName: null, body: "<h1>ERROR</h1><p>wOS Web could not complete that request.</p>" }),
      500,
    );
  });
  return app;
}
