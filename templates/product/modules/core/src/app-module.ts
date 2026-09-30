/**
 * What a bundled application hands wOS Core and wOS Web (Amendment 01, A10: in V1 every released app's code is
 * compiled in and activated at runtime by ActiveApps). An app contributes its manifest, optional server routes
 * (mounted under its `routes.api` prefix), an optional web page renderer and optional declarative mobile screens.
 */
import type { MobileScreen, OrgRole, WosAppManifest } from "../../core-contracts/src/index.js";

/** Who is calling: a local session on a self-hosted Core, or an environment token on wOS Cloud. */
export type Principal = {
  kind: "local_session" | "environment_token";
  userId: string;
  organizationId: string;
  role: OrgRole;
};

export type HttpMethod = "GET" | "POST" | "PATCH" | "DELETE";

export type AppRequestContext = {
  principal: Principal;
  manifest: WosAppManifest;
  params: Readonly<Record<string, string>>;
  query: URLSearchParams;
  body: unknown;
};

export type AppResponse = { status?: number; body: unknown };

export type AppRouteDef = {
  method: HttpMethod;
  /** Relative to the app's `routes.api` prefix, e.g. "/features" or "/records/:id". */
  path: string;
  /** Must be a permission the manifest declares; Core refuses to mount the app otherwise. */
  permission: string;
  handler: (ctx: AppRequestContext) => AppResponse | Promise<AppResponse>;
};

export type AppServerModule = { routes: readonly AppRouteDef[] };

/** Everything the web page of an app may use: its manifest and its OWN API (Core refuses other prefixes). */
export type WebRenderContext = {
  manifest: WosAppManifest;
  /** The path under the app's `routes.ui`, e.g. "/crm". */
  path: string;
  callApi: (path: string) => Promise<{ status: number; body: unknown }>;
};

/** Returns an HTML fragment. Every value from data must pass through escapeHtml. */
export type WebEntry = { render: (ctx: WebRenderContext) => Promise<string> };

export type Migration = { file: string; sql: string };

export type BundledAppInput = {
  manifest: unknown;
  server?: AppServerModule;
  web?: WebEntry;
  screens?: readonly unknown[];
  migrations?: readonly Migration[];
};

export type BundledApp = {
  manifest: WosAppManifest;
  server: AppServerModule | null;
  web: WebEntry | null;
  screens: MobileScreen[];
  migrations: Migration[];
};
