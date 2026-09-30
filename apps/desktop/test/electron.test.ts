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

      // S-40, live: before sign-in no Build handler exists in main; after it, all of them.
      expect(r.buildHandlersBefore).toEqual([]);
      expect(r.buildWhileOff).toMatch(/No handler registered for 'wos:build'/);
      expect(r.gateOpen).toBe(true);
      expect((r.buildHandlersAfter as string[]).length).toBe(14);
      expect(r.navigation).toEqual(["build.targets", "build.work", "build.contributions", "sample.home"]);

      // S-37/S-38, live: the signed TEST module runs in its own sandboxed view under wos-module://, with no Node,
      // only window.wos.app, no network, and a bridge limited to its own app and API prefix.
      const m = r.moduleView as Record<string, unknown>;
      expect(m.loaded).toBe(true);
      expect(m.url).toBe("wos-module://sample/0.1.0/index.html#/sample");
      expect(m.origin).toBe("wos-module://sample");
      expect(m.heading).toBe("SAMPLE TEST MODULE 0.1.0");
      expect(m.ping).toBe('BRIDGE 200 {"ok":true,"environment":"FAKE wOS CLOUD"}');
      expect(m.require).toBe("undefined");
      expect(m.process).toBe("undefined");
      expect(m.wosKeys).toEqual(["app"]);
      expect(m.otherApp).toMatch(/FORBIDDEN/);
      expect(m.outsidePrefix).toMatch(/FORBIDDEN/);
      expect(m.fetch).toBe("blocked");
      expect(m.fetchOwnFile).toBe("blocked");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 120_000);
});
