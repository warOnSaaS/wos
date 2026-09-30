/** Test helpers: throwaway Ed25519 keys, environment tokens, and Cores wired with in-memory stores. */
import { generateKeyPairSync, type KeyObject } from "node:crypto";
import { BUNDLED_APPS } from "../../../applications/registry.js";
import {
  CoreRoutes,
  ENVIRONMENT_TOKEN_TTL_SECONDS,
  type EnvironmentTokenClaims,
  encodeDevicePublicKey,
  signEnvironmentToken,
  WOS_CLOUD_ENVIRONMENT_ID,
} from "../../../modules/core-contracts/src/index.js";
import { type Bundle, loadBundle } from "../../../modules/core/src/bundle.js";
import type { Fetch } from "../../../modules/core/src/env-token.js";
import { createCoreApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { type Mailer, MemoryMailer } from "../src/mail.js";
import { MemoryStore } from "../src/store.js";

export const SECRET = "test-secret-0123456789abcdef0123456789";
export const CONTROL_PLANE = "https://control-plane.test";
export const T0 = new Date("2026-10-01T12:00:00Z");

export type TestKey = { kid: string; privateKey: KeyObject; publicKey: string };
export function testKey(kid = "wos-env-2026"): TestKey {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  return { kid, privateKey, publicKey: encodeDevicePublicKey(publicKey) };
}

export function mint(key: TestKey, over: Partial<EnvironmentTokenClaims> & { apps: string[] }, now: Date = T0): string {
  const iat = Math.floor(now.getTime() / 1000);
  return signEnvironmentToken(
    {
      iss: CONTROL_PLANE,
      aud: WOS_CLOUD_ENVIRONMENT_ID,
      sub: "0192f000-0000-7000-8000-000000000001",
      org: "0192f000-0000-7000-8000-000000000002",
      role: "member",
      iat,
      exp: iat + ENVIRONMENT_TOKEN_TTL_SECONDS,
      ...over,
    },
    key.kid,
    key.privateKey,
  );
}

export class Clock {
  constructor(public now: Date = new Date(T0)) {}
  advance(seconds: number) {
    this.now = new Date(this.now.getTime() + seconds * 1000);
  }
}

/** A fetch that fails the test if anything is fetched: the self-hosted proof that nothing calls out. */
export function forbiddenFetch(calls: string[]): Fetch {
  return async (input) => {
    calls.push(String(input));
    throw new Error(`unexpected network call to ${String(input)}`);
  };
}

/** A fetch serving only the control plane's environment keys. */
export function keysFetch(keys: () => TestKey[], calls: string[] = []): Fetch {
  return async (input) => {
    calls.push(String(input));
    if (String(input) !== `${CONTROL_PLANE}/v1/public/environment-keys`) return new Response("{}", { status: 404 });
    return Response.json({ keys: keys().map((k) => ({ kid: k.kid, alg: "EdDSA", publicKey: k.publicKey })) });
  };
}

export function selfHostedCore(
  opts: {
    apps?: string;
    bundle?: Bundle;
    env?: Record<string, string>;
    fetchCalls?: string[];
    mailer?: Mailer;
    log?: (msg: string, fields?: Record<string, unknown>) => void;
  } = {},
) {
  const bundle = opts.bundle ?? loadBundle(BUNDLED_APPS);
  const config = loadConfig(
    {
      WOS_MODE: "self_hosted",
      WOS_PUBLIC_URL: "https://wos.example.test",
      WOS_CORE_SECRET: SECRET,
      WOS_OWNER_EMAIL: "owner@example.test",
      WOS_ALLOWED_EMAILS: "*@example.test",
      WOS_APPS: opts.apps ?? "crm",
      ...opts.env,
    },
    bundle,
  );
  const mailer = new MemoryMailer();
  const store = new MemoryStore();
  const clock = new Clock();
  const fetchCalls = opts.fetchCalls ?? [];
  const app = createCoreApp({
    config,
    bundle,
    store,
    mailer: opts.mailer ?? mailer,
    fetch: forbiddenFetch(fetchCalls),
    now: () => clock.now,
    log: opts.log ?? (() => {}),
  });
  return { app, mailer, store, clock, config, fetchCalls };
}

export function cloudCore(opts: { keys: () => TestKey[]; clock?: Clock; bundle?: Bundle; fetch?: Fetch; fetchCalls?: string[] }) {
  const bundle = opts.bundle ?? loadBundle(BUNDLED_APPS);
  const config = loadConfig(
    { WOS_MODE: "cloud", WOS_PUBLIC_URL: "https://core.example.test", WOS_CORE_SECRET: SECRET, WOS_CONTROL_PLANE_URL: CONTROL_PLANE },
    bundle,
  );
  const clock = opts.clock ?? new Clock();
  const fetchCalls = opts.fetchCalls ?? [];
  const app = createCoreApp({
    config,
    bundle,
    store: null,
    mailer: null,
    fetch: opts.fetch ?? keysFetch(opts.keys, fetchCalls),
    now: () => clock.now,
    log: () => {},
  });
  return { app, clock, config, fetchCalls };
}

type AppLike = { request: (path: string, init?: RequestInit) => Response | Promise<Response> };
export const bearer = (token: string) => ({ headers: { authorization: `Bearer ${token}` } });
export const post = (body: unknown, headers: Record<string, string> = {}) => ({
  method: "POST",
  headers: { "content-type": "application/json", ...headers },
  body: JSON.stringify(body),
});

/** Local sign-in through the contracted routes (CoreRoutes, contracts 5.6.0), reading the code the mailer captured. */
export async function signInLocal(app: AppLike, mailer: MemoryMailer, email: string): Promise<{ token: string; role: string }> {
  const start = await app.request(CoreRoutes.localSignInStart.path, post({ email }));
  if (start.status !== CoreRoutes.localSignInStart.status) throw new Error(`start: ${start.status}`);
  const { requestId } = CoreRoutes.localSignInStart.response.parse(await start.json());
  const mail = mailer.sent.find((m) => m.requestId === requestId);
  if (!mail) throw new Error("no code was sent");
  const res = await app.request(CoreRoutes.localSignInRedeem.path, post({ requestId, code: mail.code }));
  if (res.status !== 200) throw new Error(`redeem: ${res.status}`);
  return CoreRoutes.localSignInRedeem.response.parse(await res.json());
}
