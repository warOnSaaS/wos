/**
 * Publishes Build's registry release through `AppRoutes.publishAppRelease` (B-0007-control-plane, migration 0008).
 * Build is bundled in wOS Desktop (D16, S-40): its release has no desktop package, source waronsaas/wos, and the
 * manifest committed at apps/desktop/src/apps/build/wos-app.json. A maintainer runs this once 0008 (and 0009) are
 * applied in production, and again whenever that manifest's version changes. It is never run by CI or by tests
 * against production.
 *
 *   npm run build -w @waronsaas/contracts
 *   node tools/registry/publish-build-release.mjs --email <maintainer email> --dry-run   # shows the request only
 *   node tools/registry/publish-build-release.mjs --email <maintainer email>             # signs in, publishes
 *
 * Options: --commit <40-hex sha> (default: `git rev-parse HEAD`, which must be on origin/main), --api <origin>
 * (default https://api.waronsaas.com).
 *
 * What it does, in order (it stops at the first failure):
 *   1. Reads and validates the manifest (WosAppManifest) and the commit.
 *   2. Asks the registry whether build@<version> exists; if it does, prints it and stops (nothing to do).
 *   3. With --dry-run, prints the publish body and stops.
 *   4. Signs the maintainer in with an email code (clientKind cli, no device key): you type the code from the email.
 *   5. POSTs /v1/admin/app-releases with an Idempotency-Key, prints the registry entry, and logs the session out.
 * It prints no token.
 */
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { AppRoutes, BUILD_APP_ID, HOSTS, PLATFORM_REPO, Routes, WosAppManifest } from "@waronsaas/contracts";

export const BUILD_MANIFEST_PATH = fileURLToPath(new URL("../../apps/desktop/src/apps/build/wos-app.json", import.meta.url));

/** The publishAppRelease body for Build at `commit` (validated against the route's schema). */
export function buildReleaseBody(manifestJson, commit) {
  const manifest = WosAppManifest.parse(manifestJson);
  if (manifest.app.id !== BUILD_APP_ID) throw new Error(`the manifest is ${manifest.app.id}, not ${BUILD_APP_ID}`);
  return AppRoutes.publishAppRelease.body.parse({
    manifest,
    desktopPackage: null,
    desktopPackageUrl: null,
    source: { repo: PLATFORM_REPO, tag: `${BUILD_APP_ID}@${manifest.app.version}`, commit },
  });
}

class ApiError extends Error {
  constructor(status, body) {
    super(`HTTP ${status}: ${body?.error ? `${body.error.code}: ${body.error.message}` : JSON.stringify(body)}`);
    this.status = status;
    this.body = body;
  }
}

/**
 * Steps 2-5. `fetch` is any fetch-compatible function (tests pass the control plane in process); `readCode` returns
 * the emailed code; `log` prints progress. Returns { status: "exists" | "dry-run" | "published", ... }.
 */
export async function publishBuildRelease({ api, email, body, fetch, readCode, log, dryRun = false }) {
  const call = async (method, path, { json, token, headers = {} } = {}) => {
    const res = await fetch(new URL(path, api).toString(), {
      method,
      headers: {
        accept: "application/json",
        ...(json === undefined ? {} : { "content-type": "application/json" }),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...headers,
      },
      body: json === undefined ? undefined : JSON.stringify(json),
    });
    const text = await res.text();
    const parsed = text ? JSON.parse(text) : null;
    if (!res.ok) throw new ApiError(res.status, parsed);
    return parsed;
  };
  const version = body.manifest.app.version;
  const releasePath = AppRoutes.getAppRelease.path.replace(":app", BUILD_APP_ID).replace(":version", version);
  try {
    const existing = await call("GET", releasePath);
    log(`${BUILD_APP_ID}@${version} is already published (${existing.state}, source ${existing.source.repo}@${existing.source.commit}).`);
    return { status: "exists", release: existing };
  } catch (err) {
    if (!(err instanceof ApiError) || err.status !== 404) throw err;
  }
  if (dryRun) {
    log(`would POST ${AppRoutes.publishAppRelease.path} to ${api}:`);
    log(JSON.stringify({ ...body, manifest: `<${BUILD_MANIFEST_PATH.split("/apps/").pop()} version ${version}>` }, null, 2));
    return { status: "dry-run", body };
  }
  const started = await call(Routes.startEmailSignIn.method, Routes.startEmailSignIn.path, {
    json: { email, clientKind: "cli", deviceName: "publish-build-release", devicePublicKey: null },
  });
  const code = (await readCode()).trim().toUpperCase();
  const session = await call(Routes.redeemEmailSignIn.method, Routes.redeemEmailSignIn.path, {
    json: { requestId: started.requestId, pollSecret: started.pollSecret, linkToken: null, code },
  });
  try {
    const entry = await call(AppRoutes.publishAppRelease.method, AppRoutes.publishAppRelease.path, {
      json: body,
      token: session.accessToken,
      headers: { "idempotency-key": randomUUID() },
    });
    log(
      `published ${entry.id}@${entry.currentVersion}: desktop available ${entry.surfaces.desktop.available}, package ${entry.surfaces.desktop.package}.`,
    );
    return { status: "published", entry };
  } finally {
    await call(Routes.logout.method, Routes.logout.path, { token: session.accessToken }).catch(() => undefined);
  }
}

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i < 0 ? null : (process.argv[i + 1] ?? null);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const email = arg("email");
  if (!email) {
    console.error(
      "usage: node tools/registry/publish-build-release.mjs --email <maintainer email> [--commit <sha>] [--api <origin>] [--dry-run]",
    );
    process.exit(2);
  }
  const git = (...a) => execFileSync("git", a, { encoding: "utf8" }).trim();
  const commit = arg("commit") ?? git("rev-parse", "HEAD");
  if (!/^[0-9a-f]{40}$/.test(commit)) {
    console.error(`--commit must be a full 40-hex sha, got ${commit}`);
    process.exit(2);
  }
  try {
    git("merge-base", "--is-ancestor", commit, "origin/main");
  } catch {
    console.error(`${commit} is not on origin/main: publish Build only from a commit on main (git fetch first).`);
    process.exit(2);
  }
  const body = buildReleaseBody(JSON.parse(readFileSync(BUILD_MANIFEST_PATH, "utf8")), commit);
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    await publishBuildRelease({
      api: arg("api") ?? HOSTS.api,
      email,
      body,
      fetch: globalThis.fetch,
      readCode: () => rl.question(`Code emailed to ${email} (XXXX-XXXX): `),
      log: (line) => console.log(line),
      dryRun: process.argv.includes("--dry-run"),
    });
  } catch (err) {
    console.error(`publish failed: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  } finally {
    rl.close();
  }
}
