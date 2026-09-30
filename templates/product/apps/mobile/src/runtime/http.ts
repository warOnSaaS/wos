/**
 * The one HTTP helper wOS Mobile uses. It takes an injected `fetch` so the runtime runs the same on a phone
 * (React Native's fetch), in unit tests (a fake) and against an in-process wOS Core (Hono's `app.request`).
 * Errors come back in the wOS `ApiError` envelope; anything else is a network or protocol failure.
 */
import { ApiError } from "../contracts.js";

export type HttpMethod = "GET" | "POST" | "PATCH" | "DELETE";

/** The subset of a fetch Response the runtime reads. */
export type HttpResponse = { status: number; json(): Promise<unknown> };
export type HttpFetch = (
  url: string,
  init: { method: HttpMethod; headers: Record<string, string>; body?: string },
) => Promise<HttpResponse>;

export class HttpError extends Error {
  constructor(
    readonly status: number,
    /** The `ApiError` code, or NETWORK when the server could not be reached, or PROTOCOL for an unexpected answer. */
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export type Call = {
  method: HttpMethod;
  url: string;
  bearer?: string | null;
  body?: unknown;
};

/** Sends one request and returns [status, parsed JSON or null]. Throws HttpError for non-2xx and network failures. */
export async function call(fetch: HttpFetch, c: Call): Promise<{ status: number; json: unknown }> {
  const headers: Record<string, string> = { accept: "application/json" };
  if (c.bearer) headers.authorization = `Bearer ${c.bearer}`;
  const init: { method: HttpMethod; headers: Record<string, string>; body?: string } = { method: c.method, headers };
  if (c.body !== undefined) {
    headers["content-type"] = "application/json";
    init.body = JSON.stringify(c.body);
  }
  let res: HttpResponse;
  try {
    res = await fetch(c.url, init);
  } catch (err) {
    throw new HttpError(0, "NETWORK", `could not reach ${hostOf(c.url)}: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (res.status === 204) return { status: 204, json: null };
  const json = await res.json().catch(() => null);
  if (res.status < 200 || res.status > 299) {
    const e = ApiError.safeParse(json);
    if (e.success) throw new HttpError(res.status, e.data.error.code, e.data.error.message);
    throw new HttpError(res.status, "PROTOCOL", `${hostOf(c.url)} answered ${res.status}`);
  }
  return { status: res.status, json };
}

/** `call` then validate the body with a schema; a body that does not match is a PROTOCOL error. */
export async function callParsed<T>(
  fetch: HttpFetch,
  c: Call,
  schema: { safeParse(v: unknown): { success: true; data: T } | { success: false } },
) {
  const r = await call(fetch, c);
  const parsed = schema.safeParse(r.json);
  if (!parsed.success) throw new HttpError(r.status, "PROTOCOL", `${hostOf(c.url)} sent an answer wOS Mobile does not understand`);
  return parsed.data;
}

export function hostOf(url: string): string {
  const m = /^https?:\/\/([^/?#]+)/i.exec(url);
  return m?.[1] ?? url;
}

/** Joins an API base ("https://core.example.com" or with a path) and an absolute path. */
export function joinUrl(base: string, path: string): string {
  return `${base.replace(/\/+$/, "")}${path}`;
}

/** Builds "?a=1&b=2" from defined, non-empty values (no URLSearchParams: React Native's is incomplete). */
export function queryString(params: Record<string, string | null | undefined>): string {
  const parts = Object.entries(params)
    .filter((e): e is [string, string] => typeof e[1] === "string" && e[1].length > 0)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`);
  return parts.length > 0 ? `?${parts.join("&")}` : "";
}
