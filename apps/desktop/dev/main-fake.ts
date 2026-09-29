/**
 * DEVELOPMENT ONLY (bundled to dist/app/main-fake.mjs, never packaged): wOS Desktop's real main process
 * wired to the fake control plane (dev/fake-backend.ts) and fake agent CLIs. Everything else is the
 * production code path: the same orchestrator, IPC, validation, sandbox and CSP.
 *
 *   electron dist/app/main-fake.mjs                     interactive
 *   WOS_SMOKE_OUT=out.json electron dist/app/main-fake.mjs   S-29 checks inside the real renderer, then quit
 *   WOS_SHOTS_DIR=dir electron dist/app/main-fake.mjs        drive the spec's flow and save screenshots, then quit
 */
import { writeFileSync } from "node:fs";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { BrowserWindow } from "electron";
import { app } from "electron";
import { appDirOf, startDesktop } from "../src/main/start.js";
import { createFakeBackend, FAKE_API } from "./fake-backend.js";

const smokeOut = process.env.WOS_SMOKE_OUT;
const shotsDir = process.env.WOS_SHOTS_DIR;
const backend = createFakeBackend({ delayMs: smokeOut ? 0 : 450 });
const opened: string[] = [];

// Keep development state out of the real profile.
app.setPath("userData", join(app.getPath("temp"), `wos-desktop-fake-${process.pid}`));
app.on("quit", () => backend.dispose());

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function js<T>(win: BrowserWindow, code: string): Promise<T> {
  return (await win.webContents.executeJavaScript(code, true)) as T;
}

async function waitFor(win: BrowserWindow, selector: string, timeoutMs = 20_000): Promise<void> {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    if (await js<boolean>(win, `!!document.querySelector(${JSON.stringify(selector)})`)) return;
    await pause(100);
  }
  throw new Error(`timed out waiting for ${selector}`);
}

async function waitText(win: BrowserWindow, selector: string, text: string, timeoutMs = 30_000): Promise<void> {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    const got = await js<string>(win, `(document.querySelector(${JSON.stringify(selector)})?.textContent ?? "")`);
    if (got.includes(text)) return;
    await pause(150);
  }
  throw new Error(`timed out waiting for "${text}" in ${selector}`);
}

const click = (win: BrowserWindow, selector: string) => js(win, `document.querySelector(${JSON.stringify(selector)}).click(); true`);
const type = (win: BrowserWindow, selector: string, value: string) =>
  js(
    win,
    `(() => { const el = document.querySelector(${JSON.stringify(selector)});
      const set = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), "value").set;
      set.call(el, ${JSON.stringify(value)}); el.dispatchEvent(new Event("input", { bubbles: true })); return true; })()`,
  );

async function shot(win: BrowserWindow, name: string): Promise<void> {
  await pause(250);
  const image = await win.webContents.capturePage();
  writeFileSync(join(shotsDir!, `${name}.png`), image.toPNG());
}

async function smoke(win: BrowserWindow): Promise<void> {
  const inPage = await js<Record<string, unknown>>(
    win,
    `(async () => ({
      require: typeof require,
      process: typeof process,
      module: typeof module,
      global: typeof global,
      Buffer: typeof Buffer,
      ipcRenderer: typeof window.ipcRenderer,
      electron: typeof window.electron,
      wosKeys: Object.keys(window.wos).sort(),
      wosIsFrozen: Object.isFrozen(window.wos),
      windowOpen: window.open("https://example.com/") === null ? "denied" : "opened",
      fetch: await fetch("https://api.waronsaas.com/v1/public/status").then(() => "allowed", () => "blocked"),
      csp: document.querySelector('meta[http-equiv="Content-Security-Policy"]')?.getAttribute("content") ?? null,
      openExternalEvil: await window.wos.openExternal("https://evil.example/").then(() => "opened", (e) => String(e.message)),
      openExternalLookalike: await window.wos.openExternal("https://github.com.evil.example/waronsaas").then(() => "opened", (e) => String(e.message)),
      openExternalAllowed: await window.wos.openExternal("https://github.com/waronsaas/wos/releases/latest").then(() => "opened", (e) => String(e.message)),
      badPayload: await window.wos.build("../../etc/passwd", "opus").then(() => "accepted", (e) => String(e.message)),
      badModel: await window.wos.build("salesforce/contacts#04", "fable").then(() => "accepted", (e) => String(e.message)),
    }))()`,
  );
  const before = win.webContents.getURL();
  await js(win, `location.href = "https://example.com/"; true`).catch(() => undefined);
  await pause(600);
  const after = win.webContents.getURL();
  const result = {
    ...inPage,
    urlBefore: before,
    urlAfterNavigationAttempt: after,
    openedExternally: opened,
    windows: (await import("electron")).BrowserWindow.getAllWindows().length,
  };
  writeFileSync(smokeOut!, `${JSON.stringify(result, null, 2)}\n`);
}

async function screenshots(win: BrowserWindow): Promise<void> {
  mkdirSync(shotsDir!, { recursive: true });
  await waitFor(win, "[data-testid=email]");
  await shot(win, "01-sign-in");
  await type(win, "[data-testid=email]", "dev@example.com");
  await click(win, "[data-testid=send]");
  await waitFor(win, "[data-testid=code]");
  await type(win, "[data-testid=code]", "ABCD-EFGH");
  await shot(win, "02-sign-in-code");
  await click(win, "[data-testid=verify]");
  await waitFor(win, "[data-testid=link-github]");
  await shot(win, "03-link-github");
  await click(win, "[data-testid=link-github]");
  await waitFor(win, "[data-testid=github-code]");
  await shot(win, "04-github-device-code");
  await waitFor(win, "[data-testid=targets]", 30_000);
  await shot(win, "05-sniper-list");
  await click(win, "[data-testid=target-salesforce]");
  await waitFor(win, "[data-testid=capability-crm]");
  await shot(win, "06-target-salesforce");
  await click(win, "[data-testid=feature-contacts]");
  await waitFor(win, "[data-testid=model-opus]");
  await waitText(win, "[data-testid=build]", "BUILD WITH");
  await shot(win, "07-feature-model-picker");
  await click(win, "[data-testid=build]");
  await waitFor(win, "[data-testid=run-1]");
  // D15: a second build on the other provider runs beside the first.
  await click(win, "[data-testid=model-astra] input");
  await pause(200);
  await click(win, "[data-testid=build]");
  await waitFor(win, "[data-testid=run-2]");
  await pause(1800);
  await click(win, "[data-testid=activity] .runs button");
  await shot(win, "08-two-builds-streaming");
  await waitText(win, "[data-testid=run-1]", "PASSED", 60_000);
  await waitText(win, "[data-testid=run-2]", "PASSED", 60_000);
  await click(win, "[data-testid=run-1]");
  await shot(win, "09-build-submitted");
  await click(win, "[data-testid=tab-work]");
  await waitFor(win, "[data-testid=attempts]");
  await shot(win, "10-my-work");
  await click(win, "[data-testid=tab-contributions]");
  await waitText(win, "main", "CONTRIBUTION HISTORY");
  await shot(win, "11-contributions-empty");
  await click(win, "[data-testid=tab-profile]");
  await waitFor(win, "[data-testid=providers]");
  await js(win, `document.querySelector("[data-testid=providers]").scrollIntoView({ block: "start" }); true`);
  await shot(win, "12-profile-toolchain");
  await click(win, "[data-testid=tab-settings]");
  await waitText(win, "main", "SESSION AND BUILD");
  await shot(win, "13-settings");
}

startDesktop({
  appDir: appDirOf(import.meta.url),
  fakeControlPlane: true,
  show: !smokeOut,
  windowSize: { width: 1440, height: 900 },
  openExternal: async (url) => {
    opened.push(url);
  },
  backend: {
    fetch: backend.fetch,
    secrets: backend.secrets,
    processes: backend.processes,
    apiBaseUrl: FAKE_API,
    pollIntervalMs: 600,
    sleep: (ms) => new Promise((r) => setTimeout(r, Math.min(ms, 700))),
  },
  onReady: async ({ window }) => {
    if (!smokeOut && !shotsDir) return;
    try {
      if (smokeOut) await smoke(window);
      if (shotsDir) await screenshots(window);
    } catch (e) {
      console.error(e);
      process.exitCode = 1;
    } finally {
      app.quit();
    }
  },
});
