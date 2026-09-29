/**
 * DONE (1) in the REAL renderer: starts the bundled app (dist/app/main-fake.mjs, the production main
 * process wired to the fake control plane) in Electron and inspects the sandboxed page:
 * `typeof require === "undefined"`, no process/module/Buffer, only `window.wos`, window.open and
 * navigation denied, network blocked by CSP, openExternal allowlisted, hostile IPC payloads refused.
 *
 * Needs the Electron binary and the bundle (`npm run bundle -w apps/desktop`); skipped without them
 * (root CI installs with --ignore-scripts, so no Electron binary). The desktop release workflow runs it
 * under xvfb.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const here = import.meta.dirname;
const bundle = join(here, "../dist/app/main-fake.mjs");
let electronBin: string | null = null;
try {
  const p = createRequire(import.meta.url)("electron") as unknown;
  electronBin = typeof p === "string" && existsSync(p) ? p : null;
} catch {
  electronBin = null;
}
const canRun = electronBin !== null && existsSync(bundle) && (process.platform === "darwin" || Boolean(process.env.DISPLAY));

describe.skipIf(!canRun)("Electron renderer security (S-29), live", () => {
  it("the renderer has no Node; only window.wos; window.open, navigation and network are denied", () => {
    const dir = mkdtempSync(join(tmpdir(), "wos-smoke-"));
    const out = join(dir, "smoke.json");
    try {
      const res = spawnSync(electronBin!, [bundle], {
        env: { ...process.env, WOS_SMOKE_OUT: out, ELECTRON_ENABLE_LOGGING: "0" },
        encoding: "utf8",
        timeout: 90_000,
      });
      expect(existsSync(out), res.stderr?.slice(-2000)).toBe(true);
      const r = JSON.parse(readFileSync(out, "utf8")) as Record<string, unknown>;
      expect(r.require).toBe("undefined");
      expect(r.process).toBe("undefined");
      expect(r.module).toBe("undefined");
      expect(r.global).toBe("undefined");
      expect(r.Buffer).toBe("undefined");
      expect(r.ipcRenderer).toBe("undefined");
      expect(r.electron).toBe("undefined");
      expect(r.wosIsFrozen).toBe(true);
      expect(r.wosKeys).toContain("build");
      expect(r.wosKeys).not.toContain("invoke");
      expect(r.windowOpen).toBe("denied");
      expect(r.windows).toBe(1);
      expect(r.fetch).toBe("blocked");
      expect(r.urlAfterNavigationAttempt).toBe(r.urlBefore);
      expect(String(r.urlBefore)).toMatch(/^file:\/\/.*\/renderer\/index\.html$/);
      expect(r.openExternalEvil).toMatch(/FORBIDDEN/);
      expect(r.openExternalLookalike).toMatch(/FORBIDDEN/);
      expect(r.openExternalAllowed).toBe("opened");
      expect(r.openedExternally).toEqual(["https://github.com/waronsaas/wos/releases/latest"]);
      expect(r.badPayload).toMatch(/VALIDATION_FAILED/);
      expect(r.badModel).toMatch(/VALIDATION_FAILED: fable is not a builder model/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 120_000);
});
