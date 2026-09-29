/** SECURITY.md S-29 as unit tests: window preferences, CSP, openExternal allowlist, deep links, sender check, navigation. */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CONTENT_SECURITY_POLICY,
  deepLinkFromArgv,
  hardenContents,
  isAllowedExternalUrl,
  isTrustedSender,
  parseAuthDeepLink,
  WEB_PREFERENCES,
} from "../src/main/security.js";

const here = import.meta.dirname;

describe("BrowserWindow webPreferences", () => {
  it("isolates and sandboxes the renderer with no Node", () => {
    expect(WEB_PREFERENCES).toMatchObject({
      contextIsolation: true,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      nodeIntegrationInSubFrames: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: false,
    });
  });

  it("start.ts builds every window from WEB_PREFERENCES and never overrides them", () => {
    const src = readFileSync(join(here, "../src/main/start.ts"), "utf8");
    expect(src).toContain("webPreferences: { ...WEB_PREFERENCES, preload:");
    for (const bad of ["nodeIntegration: true", "contextIsolation: false", "sandbox: false", "webSecurity: false", "loadURL("]) {
      expect(src).not.toContain(bad);
    }
    // Every IPC handler checks the sender before doing anything.
    expect(src).toMatch(
      /ipcMain\.handle\(channel, async \(event: IpcMainInvokeEvent, payload: unknown\) => \{\s*if \(!win \|\| !isTrustedSender\(/,
    );
  });
});

describe("CSP", () => {
  it("the renderer's meta CSP is exactly the policy: no network, no inline script, no eval", () => {
    const html = readFileSync(join(here, "../src/renderer/index.html"), "utf8");
    const meta = /http-equiv="Content-Security-Policy"\s+content="([^"]+)"/.exec(html)?.[1];
    expect(meta).toBe(CONTENT_SECURITY_POLICY);
    expect(CONTENT_SECURITY_POLICY).toContain("connect-src 'none'");
    expect(CONTENT_SECURITY_POLICY).toContain("script-src 'self'");
    expect(CONTENT_SECURITY_POLICY).not.toMatch(/unsafe-(inline|eval)/);
  });
});

describe("openExternal allowlist", () => {
  const allowed = [
    "https://waronsaas.com",
    "https://waronsaas.com/",
    "https://waronsaas.com/targets/salesforce?x=1",
    "https://github.com/waronsaas",
    "https://github.com/waronsaas/wos/releases/latest",
    "https://github.com/waronsaas/product/pull/7",
  ];
  const refused = [
    "http://waronsaas.com/",
    "https://www.waronsaas.com/",
    "https://api.waronsaas.com/v1/me",
    "https://waronsaas.com.evil.example/",
    "https://evil.example/https://waronsaas.com/",
    "https://waronsaas.com:8443/",
    "https://user:pass@waronsaas.com/",
    "https://github.com/",
    "https://github.com/login/device",
    "https://github.com/waronsaasx/repo",
    "https://github.com/evil/waronsaas",
    "https://github.com.evil.example/waronsaas",
    "https://gist.github.com/waronsaas/x",
    "file:///etc/passwd",
    "javascript:alert(1)",
    "data:text/html,hi",
    "wos://auth?r=x&t=y",
    "",
    "not a url",
    42,
    null,
    { toString: () => "https://waronsaas.com/" },
    `https://waronsaas.com/${"a".repeat(3000)}`,
  ];
  it.each(allowed)("allows %s", (u) => expect(isAllowedExternalUrl(u)).toBe(true));
  it.each(refused.map((u) => [u]))("refuses %s", (u) => expect(isAllowedExternalUrl(u)).toBe(false));
});

describe("wos:// deep link handler accepts only auth with the expected parameters", () => {
  const R = "0192ab3c-0000-7000-8000-00000000beef";
  it("accepts wos://auth?r=<uuid>&t=<token> and normalises it", () => {
    expect(parseAuthDeepLink(`wos://auth?r=${R}&t=good-token`)).toEqual({
      requestId: R,
      linkToken: "good-token",
      url: `wos://auth?r=${R}&t=good-token`,
    });
    expect(parseAuthDeepLink(`wos://auth/?t=good-token&r=${R}`)?.requestId).toBe(R);
  });
  it.each([
    [`wos://open?r=${R}&t=good-token`],
    [`wos://auth?r=${R}`],
    [`wos://auth?r=${R}&t=good-token&x=1`],
    [`wos://auth?r=${R}&t=good-token&t=other`],
    [`wos://auth?r=not-a-uuid&t=good-token`],
    [`wos://auth?r=${R}&t=bad token`],
    [`wos://auth?r=${R}&t=<script>`],
    [`wos://auth/extra?r=${R}&t=good-token`],
    [`wos://auth?r=${R}&t=good-token#frag`],
    [`https://auth?r=${R}&t=good-token`],
    [`wos://user@auth?r=${R}&t=good-token`],
    ["wos://auth"],
    [""],
    [42],
  ])("refuses %s", (u) => expect(parseAuthDeepLink(u)).toBeNull());
  it("finds the link in a second instance's argv", () => {
    expect(deepLinkFromArgv(["/app/wos", "--flag", `wos://auth?r=${R}&t=good-token`])).toBe(`wos://auth?r=${R}&t=good-token`);
    expect(deepLinkFromArgv(["/app/wos"])).toBeNull();
  });
});

describe("IPC sender check", () => {
  const rendererUrl = "file:///Applications/wOS.app/Contents/Resources/app.asar/renderer/index.html";
  const main = { url: rendererUrl, parent: null };
  it("accepts only our window's top frame showing our renderer", () => {
    expect(isTrustedSender(main, main, rendererUrl)).toBe(true);
    expect(isTrustedSender({ ...main }, main, rendererUrl)).toBe(false); // another frame object
    expect(isTrustedSender(null, main, rendererUrl)).toBe(false);
    const child = { url: rendererUrl, parent: main };
    expect(isTrustedSender(child, child, rendererUrl)).toBe(false);
    const elsewhere = { url: "https://evil.example/", parent: null };
    expect(isTrustedSender(elsewhere, elsewhere, rendererUrl)).toBe(false);
    const otherFile = { url: "file:///tmp/evil.html", parent: null };
    expect(isTrustedSender(otherFile, otherFile, rendererUrl)).toBe(false);
  });
});

describe("navigation and window.open are denied", () => {
  it("hardenContents denies window.open, navigation, redirects and webviews", () => {
    const handlers = new Map<string, (event: { preventDefault(): void }, url?: string) => void>();
    let openHandler: ((d: { url: string }) => { action: "deny" }) | null = null;
    const fake = {
      setWindowOpenHandler(h: (d: { url: string }) => { action: "deny" }) {
        openHandler = h;
      },
      on(event: string, listener: (event: { preventDefault(): void }, url?: string) => void) {
        handlers.set(event, listener);
      },
    };
    const log: string[] = [];
    hardenContents(fake as never, (m) => log.push(m));
    expect(openHandler!({ url: "https://waronsaas.com/" })).toEqual({ action: "deny" });
    for (const ev of ["will-navigate", "will-redirect", "will-attach-webview"]) {
      let prevented = false;
      handlers.get(ev)!({ preventDefault: () => (prevented = true) }, "https://evil.example/");
      expect(prevented, ev).toBe(true);
    }
    expect(log.length).toBe(4);
  });
});
