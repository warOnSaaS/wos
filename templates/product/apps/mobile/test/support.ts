/**
 * Test helpers for wOS Mobile's runtime: a manual clock and timers (no real waiting), a scripted fetch, and a TEST
 * FIXTURE app (`fixture`) whose screens use every screen kind and every action. The fixture exists only here, to
 * exercise the renderer; no screen a user sees is built from it.
 */
import type { Environment } from "../src/runtime/environment.js";
import type { CloudSession } from "../src/runtime/storage.js";
import type { HttpFetch, HttpMethod } from "../src/runtime/http.js";
import type { Clock, Timers } from "../src/runtime/session.js";
import { ENVIRONMENT_TOKEN_TTL_SECONDS, MobileScreen, type MobileScreenT, WosAppManifest, type WosAppManifestT } from "../src/contracts.js";

export const T0 = Date.parse("2026-10-01T12:00:00Z");

/** A clock and timers that move only when the test says so. */
export class ManualTime implements Clock, Timers {
  private t = T0;
  private seq = 0;
  private readonly pending = new Map<number, { at: number; fn: () => void }>();
  now() {
    return this.t;
  }
  setTimeout(fn: () => void, ms: number): unknown {
    const id = ++this.seq;
    this.pending.set(id, { at: this.t + ms, fn });
    return id;
  }
  clearTimeout(handle: unknown) {
    this.pending.delete(handle as number);
  }
  get scheduled(): number[] {
    return [...this.pending.values()].map((p) => p.at - this.t).sort((a, b) => a - b);
  }
  /** Moves the clock without running timers: a suspended phone (JS timers do not run in the background). */
  jump(seconds: number) {
    this.t += seconds * 1000;
  }
  /** Moves time forward, firing due timers in order, and lets their promises settle. */
  async advance(seconds: number) {
    const end = this.t + seconds * 1000;
    for (;;) {
      const due = [...this.pending.entries()].filter(([, p]) => p.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      this.pending.delete(due[0]);
      this.t = due[1].at;
      due[1].fn();
      await settle();
    }
    this.t = end;
    await settle();
  }
}

export async function settle() {
  for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r));
}

export type Req = { method: HttpMethod; url: string; path: string; headers: Record<string, string>; body: unknown };
export type Handler = (req: Req) => { status: number; body?: unknown } | undefined;

/** A fetch answering from handlers (first that answers wins); it records every request. Unknown requests get 404. */
export function scriptedFetch(...handlers: Handler[]): HttpFetch & { requests: Req[] } {
  const requests: Req[] = [];
  const f = (async (url: string, init: { method: HttpMethod; headers: Record<string, string>; body?: string }) => {
    const path = url.replace(/^https?:\/\/[^/]+/, "");
    const req: Req = { method: init.method, url, path, headers: init.headers, body: init.body ? JSON.parse(init.body) : undefined };
    requests.push(req);
    for (const h of handlers) {
      const r = h(req);
      if (r) return { status: r.status, json: async () => r.body ?? null };
    }
    return {
      status: 404,
      json: async () => ({ error: { code: "NOT_FOUND", message: `no route ${init.method} ${path}`, requestId: "t" } }),
    };
  }) as HttpFetch & { requests: Req[] };
  f.requests = requests;
  return f;
}

export const apiError = (status: number, code: string) => ({
  status,
  body: { error: { code, message: code.toLowerCase(), requestId: "t" } },
});

export const fixtureManifest: WosAppManifestT = WosAppManifest.parse({
  protocol: "wos-app/v1",
  app: {
    id: "fixture",
    name: "wOS Fixture",
    version: "0.1.0",
    kind: "app",
    billing: "addon",
    summary: "Test fixture for the renderer tests only.",
  },
  requires: { wos: "^0.1.0", apps: [] },
  surfaces: {
    web: { supported: false },
    desktop: { supported: false },
    ios: { supported: true },
    android: { supported: true },
    api: { supported: true },
  },
  mobile: { screens: "./mobile/screens" },
  data: { schema: "app_fixture", migrations: null },
  permissions: [
    { key: "fixture.items.read", description: "Read items", grantedTo: ["owner", "admin", "member"] },
    { key: "fixture.items.write", description: "Write items", grantedTo: ["owner", "admin"] },
    { key: "fixture.items.delete", description: "Delete items", grantedTo: ["owner"] },
    { key: "fixture.items.run", description: "Run an item's check", grantedTo: ["owner", "admin", "member"] },
  ],
  events: {},
  routes: { ui: "/fixture", api: "/apps/fixture" },
  navigation: [
    { id: "fixture.items", title: "Items", route: "/fixture", surfaces: ["ios", "android"], permission: "fixture.items.read", order: 20 },
    { id: "fixture.admin", title: "Admin", route: "/fixture/admin", surfaces: ["ios"], permission: "fixture.items.delete", order: 5 },
  ],
  hosting: { selfHost: { supported: true }, hosted: { supported: true } },
});

const screen = (s: unknown): MobileScreenT => MobileScreen.parse(s);

export const fixtureScreens = {
  list: screen({
    schema: "wos-screen.v1",
    id: "fixture.items.list",
    app: "fixture",
    kind: "list",
    resource: "/apps/fixture/items",
    title: { text: "Items" },
    permission: "fixture.items.read",
    list: { fields: ["name", "phone", "status"], search: true, onTap: "fixture.items.detail" },
    actions: [{ kind: "create", id: "fixture.new", screen: "fixture.items.new", permission: "fixture.items.write" }],
  }),
  detail: screen({
    schema: "wos-screen.v1",
    id: "fixture.items.detail",
    app: "fixture",
    kind: "detail",
    resource: "/apps/fixture/items/:id",
    title: { field: "name" },
    permission: "fixture.items.read",
    sections: [
      { type: "fields", fields: [{ field: "name" }, { field: "phone", label: "Phone" }, { field: "email" }, { field: "active" }] },
      { type: "related_list", relationship: "notes", screen: "fixture.notes.list" },
    ],
    actions: [
      { kind: "call", id: "fixture.call", field: "phone" },
      { kind: "email", id: "fixture.email", field: "email" },
      { kind: "open_screen", id: "fixture.open_notes", screen: "fixture.notes.list" },
      { kind: "edit", id: "fixture.edit", screen: "fixture.items.edit", permission: "fixture.items.write" },
      { kind: "delete", id: "fixture.delete", permission: "fixture.items.delete" },
      { kind: "invoke", id: "fixture.run_check", endpoint: "/apps/fixture/items/:id/check", permission: "fixture.items.run" },
    ],
  }),
  edit: screen({
    schema: "wos-screen.v1",
    id: "fixture.items.edit",
    app: "fixture",
    kind: "form",
    resource: "/apps/fixture/items/:id",
    title: { field: "name" },
    permission: "fixture.items.write",
    sections: [
      {
        type: "fields",
        fields: [
          { field: "id", input: "readonly" },
          { field: "name", input: "text", required: true },
          { field: "email", input: "email" },
          { field: "phone", input: "phone" },
          { field: "seats", input: "number" },
          { field: "renews_on", input: "date" },
          {
            field: "status",
            input: "select",
            options: [
              { value: "open", label: "Open" },
              { value: "closed", label: "Closed" },
            ],
          },
        ],
      },
    ],
  }),
  create: screen({
    schema: "wos-screen.v1",
    id: "fixture.items.new",
    app: "fixture",
    kind: "form",
    resource: "/apps/fixture/items",
    title: { text: "New item" },
    permission: "fixture.items.write",
    sections: [{ type: "fields", fields: [{ field: "name", input: "text", required: true }] }],
  }),
  notes: screen({
    schema: "wos-screen.v1",
    id: "fixture.notes.list",
    app: "fixture",
    kind: "list",
    resource: "/apps/fixture/notes",
    title: { text: "Notes" },
    permission: "fixture.items.read",
    list: { fields: ["body"], search: false, onTap: null },
  }),
};

export const CLOUD_ENV_ID = "0192f000-0000-7000-8000-00000000c10d";
export const LOCAL_ENV_ID = "0192f000-0000-7000-8000-0000000000e1";
export const ORG_ID = "0192f000-0000-7000-8000-000000000002";
export const USER_ID = "0192f000-0000-7000-8000-000000000001";
export const ISSUER = "https://api.waronsaas.com";

export function cloudEnvironment(): Environment {
  return {
    url: "https://core.waronsaas.com",
    descriptor: {
      schema: "wos-environment.v1",
      environmentId: CLOUD_ENV_ID,
      name: "wOS Cloud",
      kind: "cloud",
      protocol: "wos-app/v1",
      coreVersion: "0.1.0",
      apiBase: "https://core.waronsaas.com",
      auth: { kind: "wos_cloud", issuer: ISSUER },
    },
  };
}

export function localEnvironment(): Environment {
  return {
    url: "https://wos.example.test",
    descriptor: {
      schema: "wos-environment.v1",
      environmentId: LOCAL_ENV_ID,
      name: "Example Co",
      kind: "self_hosted",
      protocol: "wos-app/v1",
      coreVersion: "0.1.0",
      apiBase: "https://wos.example.test",
      auth: { kind: "local" },
    },
  };
}

export const iso = (ms: number) => new Date(ms).toISOString();

/** A control plane double: mints environment tokens and rotates refresh tokens, and can be told to refuse. */
export function controlPlane(time: ManualTime) {
  const state = {
    minted: 0,
    refreshed: 0,
    access: "acc-0",
    refresh: "ref-0",
    refuseRefresh: false,
    expireAccess: false,
    apps: ["core", "contacts", "crm"],
  };
  const handler = (req: Req) => {
    if (!req.url.startsWith(ISSUER)) return undefined;
    if (req.method === "POST" && req.path === "/v1/auth/refresh") {
      if (state.refuseRefresh || (req.body as { refreshToken: string }).refreshToken !== state.refresh)
        return apiError(401, "UNAUTHENTICATED");
      state.refreshed++;
      state.access = `acc-${state.refreshed}`;
      state.refresh = `ref-${state.refreshed}`;
      state.expireAccess = false;
      const now = time.now();
      return {
        status: 200,
        body: {
          accessToken: state.access,
          accessExpiresAt: iso(now + 3600_000),
          refreshToken: state.refresh,
          refreshExpiresAt: iso(now + 30 * 86400_000),
        },
      };
    }
    if (req.method === "POST" && req.path === `/v1/environments/${CLOUD_ENV_ID}/token`) {
      if (state.expireAccess || req.headers.authorization !== `Bearer ${state.access}`) return apiError(401, "UNAUTHENTICATED");
      state.minted++;
      const iat = Math.floor(time.now() / 1000);
      const claims = {
        iss: ISSUER,
        aud: CLOUD_ENV_ID,
        sub: USER_ID,
        org: ORG_ID,
        role: "admin",
        apps: state.apps,
        iat,
        exp: iat + ENVIRONMENT_TOKEN_TTL_SECONDS,
      };
      return { status: 200, body: { token: `env-token-${state.minted}-padding-padding`, expiresAt: iso((iat + 900) * 1000), claims } };
    }
    if (req.method === "GET" && req.path === "/v1/orgs") {
      return {
        status: 200,
        body: { items: [{ id: ORG_ID, slug: "personal-1", name: "Personal", kind: "personal", createdAt: iso(T0), role: "owner" }] },
      };
    }
    if (req.method === "POST" && req.path === "/v1/auth/logout") return { status: 200, body: { ok: true } };
    return undefined;
  };
  return { state, handler };
}

export function cloudSession(time: ManualTime): CloudSession {
  return {
    kind: "wos_cloud",
    issuer: ISSUER,
    accessToken: "acc-0",
    accessExpiresAt: iso(time.now() + 3600_000),
    refreshToken: "ref-0",
    refreshExpiresAt: iso(time.now() + 30 * 86400_000),
    organizationId: null,
  };
}
