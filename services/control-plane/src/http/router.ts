/**
 * Serves `Routes` (packages/contracts/src/api.ts) exactly: one Hono route per entry, with the route's
 * auth mode, zod validation of params/query/body, idempotency, write rate limits, and validation of
 * every response against the route's response schema before it is sent.
 */
import {
  type ApiErrorCode,
  type AuthMode,
  CONTRACTS_VERSION,
  type RouteBody,
  type RouteDef,
  type RouteName,
  type RouteParams,
  type RouteQuery,
  type RouteResponse,
  Routes,
} from "@waronsaas/contracts";
import { inTransaction } from "@waronsaas/db";
import { Hono, type Context } from "hono";
import { generateCookie, getCookie } from "hono/cookie";
import { cors } from "hono/cors";
import type { Deps } from "../deps.js";
import { ApiFailure, HTTP_STATUS, isConflictPgError } from "../errors.js";
import { constantTimeEqual, tokenHash, uuidv7 } from "../util/crypto.js";
import { sha256Of } from "@waronsaas/contracts/canonical";

export interface Caller {
  accountId: string;
  sessionId: string;
  familyId: string;
  clientKind: "web" | "desktop" | "cli";
  deviceId: string | null;
  isMaintainer: boolean;
  githubUserId: number | null;
  handle: string | null;
  viaCookie: boolean;
}

export interface CookieSpec {
  name: string;
  value: string;
  httpOnly: boolean;
  maxAgeSeconds: number;
  path?: string;
}

export interface HandlerCtx<N extends RouteName> {
  name: N;
  params: RouteParams<N>;
  query: RouteQuery<N>;
  body: RouteBody<N>;
  /** Raw request body text (webhook signatures). */
  rawBody: string;
  /** Set for account/contributor/maintainer routes. */
  caller: Caller | null;
  deps: Deps;
  requestId: string;
  ip: string;
  header(name: string): string | undefined;
  cookie(name: string): string | undefined;
  setCookie(cookie: CookieSpec): void;
  /** Response status (default 200). */
  status: number;
  /** When set, the response is a 302 to this URL (the JSON body is still the validated response). */
  redirectTo: string | null;
}

export type Handler<N extends RouteName> = (ctx: HandlerCtx<N>) => Promise<RouteResponse<N>>;
/** Every route of the contract must have a handler: a missing one is a compile error. */
export type Handlers = { [N in RouteName]: Handler<N> };

/** Error codes every route may return in addition to its own `errors` list. */
const IMPLICIT: Record<AuthMode, readonly ApiErrorCode[]> = {
  public: ["VALIDATION_FAILED", "RATE_LIMITED", "INTERNAL"],
  account: ["VALIDATION_FAILED", "RATE_LIMITED", "INTERNAL", "UNAUTHENTICATED", "FORBIDDEN"],
  contributor: ["VALIDATION_FAILED", "RATE_LIMITED", "INTERNAL", "UNAUTHENTICATED", "FORBIDDEN", "GITHUB_REQUIRED"],
  maintainer: ["VALIDATION_FAILED", "RATE_LIMITED", "INTERNAL", "UNAUTHENTICATED", "FORBIDDEN", "GITHUB_REQUIRED"],
  github_webhook: ["VALIDATION_FAILED", "INTERNAL", "FORBIDDEN"],
  cron: ["VALIDATION_FAILED", "INTERNAL", "FORBIDDEN"],
};

/** 60 authenticated write requests per minute per account (SECURITY.md S-3). */
export const WRITE_LIMIT_PER_MINUTE = 60;

export function createApp(deps: Deps, handlers: Handlers): Hono {
  const app = new Hono();
  app.use(
    "/v1/*",
    cors({
      origin: (origin) => (origin === deps.config.webOrigin ? origin : null),
      credentials: true,
      allowMethods: ["GET", "POST", "PATCH", "DELETE"],
      allowHeaders: ["content-type", "authorization", "idempotency-key", "x-wos-csrf"],
      maxAge: 600,
    }),
  );
  app.get("/v1/health", (c) => c.json({ ok: true, contractsVersion: CONTRACTS_VERSION, policyVersion: deps.policy.policyVersion }));
  for (const name of Object.keys(Routes) as RouteName[]) {
    const route = Routes[name] as RouteDef;
    app.on(route.method, route.path, (c) => dispatch(c, name, route, handlers[name] as unknown as Handler<RouteName>, deps));
  }
  app.notFound((c) => c.json(envelope("NOT_FOUND", "no such route", uuidv7()), 404));
  app.onError((err, c) => {
    deps.log("error", "unhandled", { error: err.message });
    return c.json(envelope("INTERNAL", "internal error", uuidv7()), 500);
  });
  return app;
}

function envelope(code: ApiErrorCode, message: string, requestId: string, details?: unknown) {
  return { error: { code, message, ...(details === undefined ? {} : { details }), requestId } };
}

function clientIp(c: Context): string {
  const fwd = c.req.header("x-forwarded-for");
  if (fwd) return fwd.split(",")[0]!.trim();
  return c.req.header("x-real-ip") ?? "0.0.0.0";
}

async function dispatch(c: Context, name: RouteName, route: RouteDef, handler: Handler<RouteName>, deps: Deps): Promise<Response> {
  const requestId = uuidv7();
  const cookiesOut: string[] = [];
  // api.ts: every idempotent route may answer 422 IDEMPOTENCY_MISMATCH (header rule, not in each route's list).
  const allowed = new Set<ApiErrorCode>([
    ...route.errors,
    ...IMPLICIT[route.auth],
    ...(route.idempotent ? (["IDEMPOTENCY_MISMATCH"] as const) : []),
  ]);
  const respondError = (code: ApiErrorCode, message: string, details?: unknown) => {
    if (!allowed.has(code)) deps.onContractViolation?.(name, `returned ${code} (${message}), not listed in Routes.${name}.errors`);
    const res = c.json(envelope(code, message, requestId, details), HTTP_STATUS[code] as 400);
    for (const ck of cookiesOut) res.headers.append("set-cookie", ck);
    return res;
  };
  try {
    const rawBody = route.method === "GET" ? "" : await c.req.text();

    // ---- auth mode
    let caller: Caller | null = null;
    if (route.auth === "account" || route.auth === "contributor" || route.auth === "maintainer") {
      caller = await resolveCaller(c, deps);
      if (!caller) return respondError("UNAUTHENTICATED", "sign in first");
      if (caller.viaCookie && route.method !== "GET") {
        const header = c.req.header("x-wos-csrf") ?? "";
        const cookie = getCookie(c, "wos_csrf") ?? "";
        if (!header || !constantTimeEqual(header, cookie)) return respondError("FORBIDDEN", "missing or wrong X-wOS-Csrf header");
      }
      if (route.auth !== "account" && caller.githubUserId === null) {
        return respondError("GITHUB_REQUIRED", "link a GitHub account to contribute");
      }
      if (route.auth === "maintainer" && !caller.isMaintainer) return respondError("FORBIDDEN", "maintainer role required");
    } else if (route.auth === "cron") {
      const auth = c.req.header("authorization") ?? "";
      if (!deps.config.cronSecret || !constantTimeEqual(auth, `Bearer ${deps.config.cronSecret}`)) {
        return respondError("FORBIDDEN", "cron secret required");
      }
    } else if (route.auth === "github_webhook") {
      const sig = c.req.header("x-hub-signature-256") ?? "";
      if (!sig || !(await deps.github.verifyWebhookSignature(rawBody, sig))) return respondError("FORBIDDEN", "bad webhook signature");
    }

    // ---- input validation
    const params = route.params.safeParse(c.req.param());
    if (!params.success) return respondError("VALIDATION_FAILED", "invalid path parameters", params.error.issues);
    const query = route.query.safeParse(c.req.query());
    if (!query.success) return respondError("VALIDATION_FAILED", "invalid query", query.error.issues);
    let bodyJson: unknown = {};
    if (rawBody.trim().length > 0) {
      try {
        bodyJson = JSON.parse(rawBody);
      } catch {
        return respondError("VALIDATION_FAILED", "body is not JSON");
      }
    }
    const body = route.body.safeParse(bodyJson);
    if (!body.success) return respondError("VALIDATION_FAILED", "invalid body", body.error.issues);

    // ---- write rate limit (per account) and idempotency
    if (caller && route.method !== "GET") {
      const count = await bumpRateLimit(deps, `api:${caller.accountId}`, "minute");
      if (count > WRITE_LIMIT_PER_MINUTE) return respondError("RATE_LIMITED", "too many write requests; slow down");
    }
    let idem: { key: string; requestSha: string } | null = null;
    if (route.idempotent) {
      const key = c.req.header("idempotency-key") ?? "";
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(key) || !caller) {
        return respondError("VALIDATION_FAILED", "Idempotency-Key: <uuid> header is required on this route");
      }
      idem = { key: key.toLowerCase(), requestSha: sha256Of(rawBody) };
      const stored = await inTransaction(
        deps.sql,
        { kind: "contributor", accountId: caller.accountId },
        (tx) =>
          tx<{ request_sha256: string; response_status: number; response_body: unknown }[]>`
          select request_sha256, response_status, response_body from wos.idempotency_keys
           where account_id = ${caller!.accountId} and route = ${name} and key = ${idem!.key} and expires_at > now()`,
      );
      if (stored[0]) {
        if (stored[0].request_sha256 !== idem.requestSha) {
          return respondError("IDEMPOTENCY_MISMATCH", "this Idempotency-Key was used with a different body");
        }
        return c.json(stored[0].response_body as object, stored[0].response_status as 200);
      }
    }

    // ---- handler
    const ctx: HandlerCtx<RouteName> = {
      name,
      params: params.data as never,
      query: query.data as never,
      body: body.data as never,
      rawBody,
      caller,
      deps,
      requestId,
      ip: clientIp(c),
      header: (h) => c.req.header(h),
      cookie: (k) => getCookie(c, k),
      setCookie: (ck) =>
        cookiesOut.push(
          generateCookie(ck.name, ck.value, {
            httpOnly: ck.httpOnly,
            secure: deps.config.env !== "test" && deps.config.env !== "local",
            sameSite: "Lax",
            path: ck.path ?? "/",
            maxAge: ck.maxAgeSeconds,
            ...(deps.config.cookieDomain ? { domain: deps.config.cookieDomain } : {}),
          }),
        ),
      status: 200,
      redirectTo: null,
    };
    const result = await handler(ctx);
    const checked = route.response.safeParse(result);
    if (!checked.success) {
      deps.onContractViolation?.(name, `response does not match Routes.${name}.response: ${checked.error.message}`);
      deps.log("error", "response schema violation", { route: name, issues: checked.error.issues.slice(0, 5) });
      return respondError("INTERNAL", "response failed contract validation");
    }
    if (idem && caller && ctx.status < 300) {
      await inTransaction(
        deps.sql,
        { kind: "contributor", accountId: caller.accountId },
        (tx) =>
          tx`insert into wos.idempotency_keys (account_id, route, key, request_sha256, response_status, response_body)
           values (${caller!.accountId}, ${name}, ${idem!.key}, ${idem!.requestSha}, ${ctx.status}, ${checked.data === null || checked.data === undefined ? tx`'null'::jsonb` : tx.json(checked.data as never)})
           on conflict (account_id, route, key) do nothing`,
      );
    }
    const res = ctx.redirectTo
      ? c.json(checked.data as object, 302, { location: ctx.redirectTo })
      : c.json(checked.data as object, ctx.status as 200);
    if (route.auth === "public" && route.method === "GET")
      res.headers.set("cache-control", "public, s-maxage=30, stale-while-revalidate=300");
    else res.headers.set("cache-control", "no-store");
    for (const ck of cookiesOut) res.headers.append("set-cookie", ck);
    return res;
  } catch (err) {
    if (err instanceof ApiFailure) return respondError(err.code, err.message, err.details);
    if (isConflictPgError(err)) return respondError("CONFLICT", "a concurrent change won; re-read and decide");
    deps.log("error", "handler failed", { route: name, error: err instanceof Error ? err.message : String(err), requestId });
    return respondError("INTERNAL", "internal error");
  }
}

/** Increments a fixed-window counter and returns the new count (rate_limits table). */
export async function bumpRateLimit(deps: Deps, bucket: string, window: "minute" | "hour"): Promise<number> {
  const rows = await inTransaction(
    deps.sql,
    { kind: "system", accountId: null },
    (tx) =>
      tx<{ count: number }[]>`
      insert into wos.rate_limits (bucket, window_start, count) values (${bucket}, date_trunc(${window}, now()), 1)
      on conflict (bucket, window_start) do update set count = wos.rate_limits.count + 1
      returning count`,
  );
  return rows[0]!.count;
}

async function resolveCaller(c: Context, deps: Deps): Promise<Caller | null> {
  const auth = c.req.header("authorization");
  let token: string | null = null;
  let viaCookie = false;
  if (auth?.startsWith("Bearer ")) token = auth.slice(7).trim();
  else {
    const ck = getCookie(c, "wos_session");
    if (ck) {
      token = ck;
      viaCookie = true;
    }
  }
  if (!token) return null;
  const hash = tokenHash(deps.config.tokenPepper, token);
  const rows = await inTransaction(
    deps.sql,
    { kind: "system", accountId: null },
    (tx) =>
      tx<
        {
          id: string;
          family_id: string;
          account_id: string;
          client_kind: Caller["clientKind"];
          device_id: string | null;
          status: string;
          github_user_id: string | null;
          handle: string | null;
          is_maintainer: boolean;
        }[]
      >`
      select s.id, s.family_id, s.account_id, s.client_kind, s.device_id, a.status, a.github_user_id, a.handle,
             exists (select 1 from wos.account_roles r where r.account_id = a.id and r.role = 'maintainer') as is_maintainer
        from wos.sessions s join wos.accounts a on a.id = s.account_id
       where s.access_token_hash = ${hash} and s.revoked_at is null and s.rotated_at is null and s.access_expires_at > now()`,
  );
  const s = rows[0];
  if (s?.status !== "active") return null;
  return {
    accountId: s.account_id,
    sessionId: s.id,
    familyId: s.family_id,
    clientKind: s.client_kind,
    deviceId: s.device_id,
    isMaintainer: s.is_maintainer,
    githubUserId: s.github_user_id === null ? null : Number(s.github_user_id),
    handle: s.handle,
    viaCookie,
  };
}
