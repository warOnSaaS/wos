/**
 * The FAKE control plane Desktop runs against in development, screenshots and tests (WORKSTREAMS 3
 * desktop DONE 2). Workflow routes are served by the orchestrator package's own FakeControlPlane (the
 * same one the orchestrator's tests use); public routes by dev/fixtures.ts. Candidate commits are real
 * git commits in a temporary upstream. Never shipped: electron-builder packages dist/app/main.mjs only.
 *
 * The fake world: sign in with code ABCD-EFGH (or the deep link wos://auth?r=<request>&t=good-token);
 * the account has no GitHub until the device flow's second poll; Salesforce > CRM > Contacts has one
 * claimable unit, contacts#04.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { configureLocalGit } from "@waronsaas/github/local";
import type { SecretStore } from "@waronsaas/orchestrator";
import { FakeControlPlane, makeUpstream, SIGNIN_REQUEST_ID } from "../../../packages/orchestrator/test/support/fake-control-plane.js";
import { DemoProcesses } from "./demo-processes.js";
import { FAKE_CORE, FakeApps } from "./fake-apps.js";
import { featureDetail, targetDetail, targets } from "./fixtures.js";

export { SIGNIN_REQUEST_ID };
export { FAKE_CORE };
export const FAKE_CODE = "ABCD-EFGH";
export const FAKE_LINK = `wos://auth?r=${SIGNIN_REQUEST_ID}&t=good-token`;
export const FAKE_API = "https://api.waronsaas.test";

export class MemorySecrets implements SecretStore {
  readonly map = new Map<string, string>();
  async get(k: string) {
    return this.map.get(k) ?? null;
  }
  async set(k: string, v: string) {
    this.map.set(k, v);
  }
  async delete(k: string) {
    this.map.delete(k);
  }
}

export interface FakeBackend {
  server: FakeControlPlane;
  /** Organizations, entitlements, the registry and the fake environments (dev/fake-apps.ts). */
  apps: FakeApps;
  processes: DemoProcesses;
  secrets: MemorySecrets;
  fetch: typeof fetch;
  /** Paths of every request the fake served, in order (tests assert what the Desktop called). */
  calls: string[];
  upstreamDir: string;
  dispose(): void;
}

function json(status: number, data: unknown): Response {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
}

export function createFakeBackend(
  opts: { delayMs?: number; githubLinked?: boolean; now?: () => Date; buildEnabled?: boolean } = {},
): FakeBackend {
  const upstream = makeUpstream();
  configureLocalGit({ remoteUrl: () => upstream.dir });
  const server = new FakeControlPlane(upstream, opts.now ?? (() => new Date()));
  // D8: an account starts with an email only; GitHub is linked afterwards.
  if (!opts.githubLinked) server.meOverride = { github: null, handle: null, canContribute: false };
  server.githubLinkScript = ["pending", "linked"];
  const calls: string[] = [];
  const machine = process.platform === "darwin" ? "macos" : "linux";
  const processes = new DemoProcesses(machine, opts.delayMs ?? 0);
  const secrets = new MemorySecrets();
  const apps = new FakeApps(opts.now ?? (() => new Date()), { buildEnabled: opts.buildEnabled ?? true });

  const fetchImpl: typeof fetch = async (input, init) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    calls.push(`${init?.method ?? "GET"} ${url.pathname}`);
    const owned = apps.handle(url, init);
    if (owned) return owned;
    const p = url.pathname;
    if (p === "/v1/public/targets") return json(200, { items: targets() });
    let m = /^\/v1\/public\/targets\/([^/]+)$/.exec(p);
    if (m) {
      const t = targetDetail(decodeURIComponent(m[1]!));
      return t ? json(200, t) : json(404, { error: { code: "NOT_FOUND", message: "no such target", requestId: "fake" } });
    }
    m = /^\/v1\/public\/targets\/([^/]+)\/features\/([^/]+)$/.exec(p);
    if (m) {
      const abu = {
        id: server.abuId,
        key: "contacts#04",
        title: "Contact list endpoint",
        state: "ready" as const,
        sizePoints: 3,
        dependsOn: [],
        requirements: ["R-001"],
        relevantTo: ["salesforce", "hubspot"],
        claimable: null,
        repo: "waronsaas/product",
        pr: null,
      };
      const f = featureDetail(decodeURIComponent(m[1]!), decodeURIComponent(m[2]!), abu);
      return f ? json(200, f) : json(404, { error: { code: "NOT_FOUND", message: "no such feature", requestId: "fake" } });
    }
    m = /^\/v1\/public\/contributors\/([^/]+)(\/ledger)?$/.exec(p);
    if (m) {
      // A new contributor: no public profile until the first accepted contribution (honest empty state).
      return json(404, { error: { code: "NOT_FOUND", message: "no public profile", requestId: "fake" } });
    }
    const clock = opts.now ?? (() => new Date());
    if (p === "/v1/auth/refresh") {
      // The fake's redeem answers with fixed timestamps; a real clock makes the orchestrator refresh.
      return json(200, {
        accessToken: "test-access",
        accessExpiresAt: new Date(clock().getTime() + 3_600_000).toISOString(),
        refreshToken: "test-refresh",
        refreshExpiresAt: new Date(clock().getTime() + 30 * 86_400_000).toISOString(),
      });
    }
    if (p === "/v1/me/events") {
      if (new Headers(init?.headers).get("authorization") !== "Bearer test-access") {
        return json(401, { error: { code: "UNAUTHENTICATED", message: "bad token", requestId: "fake" } });
      }
      return json(200, { items: [], lastId: Number(url.searchParams.get("after") ?? 0) });
    }
    if (p === "/v1/me/github/link/poll" && server.githubLinkScript[0] === "linked") server.meOverride = null;
    return server.fetch(input, init);
  };

  return {
    server,
    apps,
    processes,
    secrets,
    fetch: fetchImpl,
    calls,
    upstreamDir: upstream.dir,
    dispose() {
      configureLocalGit({});
      rmSync(upstream.dir, { recursive: true, force: true });
    },
  };
}

export function tempWorkspace(): { dir: string; dispose(): void } {
  const dir = mkdtempSync(join(tmpdir(), "wos-desktop-ws-"));
  return { dir, dispose: () => rmSync(dir, { recursive: true, force: true }) };
}
