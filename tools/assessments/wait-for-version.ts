/**
 * Waits until the live site serves the white paper version in this checkout. Used by
 * .github/workflows/self-assessment.yml before it runs the reference assessment: a run must read the DEPLOYED paper
 * (run-reference.ts records the version https://waronsaas.com/whitepaper.md serves), and Vercel deploys main a few
 * minutes after the push.
 *
 *   node tools/assessments/wait-for-version.ts                       # the repo's version, 20 min, every 20 s
 *   node tools/assessments/wait-for-version.ts --version 0.9 --timeout-min 30 --interval-s 15 --site http://…
 *
 * Exit 0 when the site serves exactly that version. Exit 1 on timeout, or at once when the site serves a NEWER version
 * than the checkout (main moved on; the newer push's own run assesses that version). Never calls a model.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { compareVersions, extractVersion } from "../../apps/web/scripts/wp-history-lib.mts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

export type WaitOptions = {
  want: string;
  /** Returns the version the site serves now, or null when it cannot tell (HTTP error, no Version row). */
  fetchServed: () => Promise<string | null>;
  timeoutMs: number;
  intervalMs: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  log?: (s: string) => void;
};

export type WaitResult =
  | { ok: true; served: string; attempts: number }
  | { ok: false; reason: "timeout" | "newer"; served: string | null; attempts: number; message: string };

/** Polls until the site serves `want`. Pure apart from the injected fetch, clock and sleep (tests fake all three). */
export async function waitForVersion(o: WaitOptions): Promise<WaitResult> {
  const now = o.now ?? Date.now;
  const sleep = o.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const log = o.log ?? (() => {});
  const deadline = now() + o.timeoutMs;
  let attempts = 0;
  let served: string | null = null;
  for (;;) {
    attempts++;
    try {
      served = await o.fetchServed();
    } catch (e) {
      served = null;
      log(`attempt ${attempts}: ${(e as Error).message}`);
    }
    if (served !== null) {
      const d = compareVersions(served, o.want);
      if (d === 0) return { ok: true, served, attempts };
      if (d > 0) {
        return {
          ok: false,
          reason: "newer",
          served,
          attempts,
          message: `the site serves v${served}, newer than this checkout's v${o.want}; that version's own run will assess it`,
        };
      }
      log(`attempt ${attempts}: the site serves v${served}, waiting for v${o.want}`);
    } else {
      log(`attempt ${attempts}: could not read the served version, waiting for v${o.want}`);
    }
    if (now() + o.intervalMs > deadline) {
      return {
        ok: false,
        reason: "timeout",
        served,
        attempts,
        message: `timed out after ${Math.round(o.timeoutMs / 1000)} s: the site still serves ${served ? `v${served}` : "no readable version"}, not v${o.want} (did the Vercel deploy fail? the version gate fails a build that supersedes an unassessed version)`,
      };
    }
    await sleep(o.intervalMs);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const argv = process.argv.slice(2);
  const get = (name: string) => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const want = get("--version") ?? extractVersion(readFileSync(join(ROOT, "docs/whitepaper/WHITEPAPER.md"), "utf8"));
  if (!want) {
    console.error("wait-for-version: docs/whitepaper/WHITEPAPER.md has no Version row");
    process.exit(1);
  }
  const site = (get("--site") ?? "https://waronsaas.com").replace(/\/$/, "");
  const res = await waitForVersion({
    want,
    fetchServed: async () => {
      // A query string defeats any cache between the runner and the CDN; the route ignores it.
      const r = await fetch(`${site}/whitepaper.md?wait=${Date.now()}`, { headers: { "cache-control": "no-cache" } });
      if (!r.ok) throw new Error(`GET ${site}/whitepaper.md: HTTP ${r.status}`);
      return extractVersion(await r.text());
    },
    timeoutMs: Number(get("--timeout-min") ?? 20) * 60_000,
    intervalMs: Number(get("--interval-s") ?? 20) * 1000,
    log: (s) => console.log(`wait-for-version: ${s}`),
  });
  if (!res.ok) {
    console.error(`wait-for-version: ${res.message}`);
    process.exit(1);
  }
  console.log(`wait-for-version: the site serves v${res.served} (after ${res.attempts} attempt(s))`);
}
