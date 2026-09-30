/**
 * D17, S-42: Windows path handling, tested on every OS through the explicit path flavour; and the wos-module://
 * protocol (S-38) as pure functions.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  MODULE_CONTENT_SECURITY_POLICY,
  MODULE_SCHEME_PRIVILEGES,
  moduleUrl,
  parseModuleUrl,
  serveModuleRequest,
} from "../src/main/module-protocol.js";
import { caseCollision, joinPackagePath, modulesRootFor, packagePathProblem, workspaceRootFor } from "../src/main/paths.js";

const here = import.meta.dirname;

describe("paths on Windows, macOS and Linux (D17, S-42)", () => {
  it("Build's workspace is a short per-user root on Windows, unchanged elsewhere", () => {
    expect(workspaceRootFor("win32", { userData: "C:\\Users\\ada\\AppData\\Roaming\\wOS", home: "C:\\Users\\ada" })).toBe(
      "C:\\Users\\ada\\wos-w",
    );
    expect(workspaceRootFor("darwin", { userData: "/Users/ada/Library/Application Support/wOS", home: "/Users/ada" })).toBe(
      "/Users/ada/Library/Application Support/wOS/workspace",
    );
    expect(workspaceRootFor("linux", { userData: "/home/ada/.config/wOS", home: "/home/ada" })).toBe("/home/ada/.config/wOS/workspace");
    expect(modulesRootFor("win32", "C:\\Users\\ada\\AppData\\Roaming\\wOS")).toBe("C:\\Users\\ada\\AppData\\Roaming\\wOS\\modules");
  });

  it("package paths are joined segment by segment in the platform's flavour", () => {
    expect(joinPackagePath("win32", "C:\\m\\sample\\0.1.0\\files", "assets/app.js")).toBe("C:\\m\\sample\\0.1.0\\files\\assets\\app.js");
    expect(joinPackagePath("linux", "/m/sample/0.1.0/files", "assets/app.js")).toBe("/m/sample/0.1.0/files/assets/app.js");
  });

  it("refuses paths that are not portable: traversal, absolute, backslash, reserved Windows names, trailing dots", () => {
    for (const p of [
      "../x.js",
      "a/../b.js",
      "/etc/passwd",
      "a\\b.js",
      "a//b.js",
      "./a.js",
      "CON",
      "aux.js",
      "Nul.txt",
      "com1.log",
      "lpt9",
      "dir./a.js",
      "a b.js",
      "x:y.js",
      "",
    ])
      expect(packagePathProblem(p), p).not.toBeNull();
    for (const p of ["index.html", "assets/app.js", "a.b-c_d.css", "console.js", "auxiliary.js"])
      expect(packagePathProblem(p), p).toBeNull();
    expect(() => joinPackagePath("win32", "C:\\m", "..\\x")).toThrow();
  });

  it("finds paths that collide on a case-insensitive volume", () => {
    expect(caseCollision(["app.js", "App.js"])).toEqual(["app.js", "App.js"]);
    expect(caseCollision(["a/app.js", "b/app.js"])).toBeNull();
  });

  it("the orchestrator gets the platform's workspace root from start.ts", () => {
    const src = readFileSync(join(here, "../src/main/start.ts"), "utf8");
    expect(src).toContain("workspaceRoot: workspaceRootFor(platform, { userData, home: homedir() })");
  });
});

describe("the wos-module:// protocol (S-38)", () => {
  const shown = { app: "sample", version: "0.1.0" };
  const files = new Map([["index.html", new TextEncoder().encode("<!doctype html>")]]);
  const installer = {
    readFile: (app: string, version: string, path: string) =>
      app === "sample" && version === "0.1.0" && files.has(path)
        ? { bytes: files.get(path)!, contentType: "text/html; charset=utf-8" }
        : null,
  };

  it("builds and parses wos-module://<app>/<version>/<path>", () => {
    expect(moduleUrl({ app: "sample", version: "0.1.0", entry: "index.html" }, "/sample")).toBe(
      "wos-module://sample/0.1.0/index.html#/sample",
    );
    expect(parseModuleUrl("wos-module://sample/0.1.0/assets/app.js")).toEqual({ app: "sample", version: "0.1.0", path: "assets/app.js" });
    for (const bad of [
      "https://sample/0.1.0/index.html",
      "wos-module://sample/latest/index.html",
      "wos-module://sample/0.1.0/",
      "wos-module://sample/0.1.0/index.html?x=1",
      "wos-module://u:p@sample/0.1.0/index.html",
      "wos-module://Sample/0.1.0/index.html/../../x",
      "file:///etc/passwd",
    ])
      expect(parseModuleUrl(bad), bad).toBeNull();
  });

  it("serves only the shown module's version, only its packaged files, always with the module CSP", () => {
    const ok = serveModuleRequest("wos-module://sample/0.1.0/index.html", shown, installer);
    expect(ok.status).toBe(200);
    expect(ok.headers["content-security-policy"]).toBe(MODULE_CONTENT_SECURITY_POLICY);
    expect(ok.headers["x-content-type-options"]).toBe("nosniff");
    for (const url of ["wos-module://sample/0.2.0/index.html", "wos-module://crm/0.1.0/index.html", "wos-module://sample/0.1.0/other.js"])
      expect(serveModuleRequest(url, shown, installer).status, url).toBe(404);
    expect(serveModuleRequest("wos-module://sample/0.1.0/index.html", null, installer).status).toBe(404);
  });

  it("the module CSP allows its own origin only: no eval, no inline or remote script, no network", () => {
    expect(MODULE_CONTENT_SECURITY_POLICY).toContain("script-src 'self'");
    expect(MODULE_CONTENT_SECURITY_POLICY).toContain("connect-src 'none'");
    expect(MODULE_CONTENT_SECURITY_POLICY).toContain("default-src 'none'");
    expect(MODULE_CONTENT_SECURITY_POLICY).not.toMatch(/unsafe-|https?:|\*/);
    expect(MODULE_SCHEME_PRIVILEGES).toMatchObject({
      standard: true,
      secure: true,
      bypassCSP: false,
      supportFetchAPI: false,
      corsEnabled: false,
    });
  });

  it("the module view loads only wos-module URLs, in its own partition, sandboxed, with the module preload", () => {
    const src = readFileSync(join(here, "../src/main/module-view.ts"), "utf8");
    const loads = [...src.matchAll(/loadURL\(([^)]*\))?/g)].map((m) => m[1]);
    expect(loads.length).toBeGreaterThan(0);
    for (const arg of loads) expect(arg).toMatch(/^moduleUrl\(m, route\)/);
    expect(src).toContain("webPreferences: { ...WEB_PREFERENCES, preload: opts.preload, session: moduleSession() }");
    expect(src).toContain("setPermissionRequestHandler((_wc, _permission, callback) => callback(false))");
    expect(src).not.toMatch(/nodeIntegration: true|sandbox: false|contextIsolation: false|executeJavaScript/);
  });

  it("the module preload exposes exactly window.wos.app(<id>) with manifest and request", () => {
    const src = readFileSync(join(here, "../src/preload/module.ts"), "utf8");
    expect([...src.matchAll(/exposeInMainWorld\(/g)].length).toBe(1);
    expect(src).toContain('contextBridge.exposeInMainWorld("wos", Object.freeze(bridge));');
    expect(src).toMatch(/MODULE_CHANNELS\.manifest/);
    expect(src).toMatch(/MODULE_CHANNELS\.request/);
    expect(src).not.toMatch(/IPC_CHANNELS|wos:build|ipcRenderer\.(send|on)\(/);
  });
});
