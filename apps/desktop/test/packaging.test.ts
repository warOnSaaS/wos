/**
 * DONE (4): electron-builder produces a macOS dmg and a Linux AppImage in CI; signing and notarisation
 * are wired to the `release` environment's secrets only (D7, S-8, S-30). The workflow lives in
 * apps/desktop/ci until the architect installs it under .github/workflows (B-0004-desktop).
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

const here = import.meta.dirname;
// biome-ignore lint/suspicious/noExplicitAny: parsed YAML, asserted field by field below.
type Yaml = any;
const builder = parse(readFileSync(join(here, "../electron-builder.yml"), "utf8")) as Record<string, Yaml>;
const wf = parse(readFileSync(join(here, "../../../.github/workflows/desktop-release.yml"), "utf8")) as {
  jobs: Record<string, Yaml>;
  permissions: unknown;
};
const wfText = readFileSync(join(here, "../../../.github/workflows/desktop-release.yml"), "utf8");

/** PNG width and height from the IHDR chunk. */
function pngSize(buf: Buffer): [number, number] {
  expect(buf.subarray(1, 4).toString("ascii")).toBe("PNG");
  return [buf.readUInt32BE(16), buf.readUInt32BE(20)];
}

describe("electron-builder config", () => {
  it("targets a macOS dmg, a Windows NSIS installer (D17) and a Linux AppImage", () => {
    expect(builder.mac.target.map((t: { target: string }) => t.target)).toEqual(["dmg"]);
    expect(builder.win.target.map((t: { target: string }) => t.target)).toEqual(["nsis"]);
    expect(builder.linux.target.map((t: { target: string }) => t.target)).toEqual(["AppImage"]);
    expect(builder.productName).toBe("wOS");
    expect(builder.appId).toBe("com.waronsaas.wos");
  });
  it("macOS: hardened runtime, notarisation on, minimal entitlements", () => {
    expect(builder.mac.hardenedRuntime).toBe(true);
    expect(builder.mac.notarize).toBe(true);
    const ent = readFileSync(join(here, "..", builder.mac.entitlements), "utf8");
    expect(ent).toContain("com.apple.security.cs.allow-jit");
    expect(ent).not.toMatch(/disable-library-validation|allow-unsigned-executable-memory|device\.camera|device\.audio-input/);
  });
  it("packages only the bundled app, never the fake control plane, and registers wos://", () => {
    expect(builder.directories.app).toBe("dist/app");
    expect(builder.files).toContain("!main-fake.mjs");
    // The main process is bundled; no node_modules ship (a local unsigned `--mac dir` build lists 11 entries in app.asar).
    expect(builder.files).toContain("!**/node_modules/**");
    expect(builder.protocols[0].schemes).toEqual(["wos"]);
    expect(builder.linux.mimeTypes).toContain("x-scheme-handler/wos");
    expect(builder.publish).toBeNull();
    expect(existsSync(join(here, "../build/icon.png"))).toBe(true);
  });
  it("carries no credential in the config", () => {
    const raw = readFileSync(join(here, "../electron-builder.yml"), "utf8");
    expect(raw).not.toMatch(/CSC_LINK:|password:|identity:\s*["']?[A-Z]/);
  });

  it("Windows: no signing here (the release job signs with Azure Trusted Signing, S-42); per-user NSIS, no elevation", () => {
    expect(builder.win.azureSignOptions).toBeUndefined();
    expect(builder.win.signtoolOptions).toBeUndefined();
    expect(builder.win.certificateFile).toBeUndefined();
    expect(builder.nsis).toMatchObject({ oneClick: false, perMachine: false, allowElevation: false });
    expect(builder.win.artifactName).toContain("win");
  });
});

describe("the wOS name and mark everywhere (founder request, 2026-09-30)", () => {
  it("the product is named wOS for the menu bar, About, Dock, taskbar, Start menu, installer and Linux desktop entry", () => {
    expect(builder.productName).toBe("wOS");
    expect(builder.appId).toBe("com.waronsaas.wos");
    // No top-level executableName: it would name the macOS bundle wos.app (Finder and Dock show the bundle's name).
    expect(builder.executableName).toBeUndefined();
    expect(builder.mac.executableName).toBeUndefined();
    expect(builder.win.executableName).toBe("wOS");
    expect(builder.linux.executableName).toBe("wos");
    expect(builder.nsis.shortcutName).toBe("wOS");
    expect(builder.nsis.uninstallDisplayName).toBe("wOS");
    expect(builder.linux.desktop.entry.Name).toBe("wOS");
    const pkg = JSON.parse(readFileSync(join(here, "../package.json"), "utf8"));
    expect(pkg.productName).toBe("wOS");
    const build = readFileSync(join(here, "../scripts/build.mjs"), "utf8");
    expect(build).toContain('productName: "wOS"');
    const start = readFileSync(join(here, "../src/main/start.ts"), "utf8");
    expect(start).toContain('export const PRODUCT_NAME = "wOS" as const;');
    expect(start).toContain("app.setName(PRODUCT_NAME)");
    expect(start).toContain("title: PRODUCT_NAME");
    // The Windows taskbar groups the window with its shortcut only when the AppUserModelID equals the appId.
    expect(start).toContain(`APP_USER_MODEL_ID = "${builder.appId}"`);
    expect(start).toContain("app.setAppUserModelId(APP_USER_MODEL_ID)");
    const html = readFileSync(join(here, "../src/renderer/index.html"), "utf8");
    expect(html).toContain("<title>wOS</title>");
  });

  it("app, window and installer icons come from build/, generated from one source by a committed script", () => {
    expect(builder.mac.icon).toBe("build/icon.icns");
    expect(builder.win.icon).toBe("build/icon.ico");
    expect(builder.nsis.installerIcon).toBe("build/icon.ico");
    expect(builder.nsis.uninstallerIcon).toBe("build/icon.ico");
    expect(builder.nsis.installerHeaderIcon).toBe("build/icon.ico");
    expect(builder.linux.icon).toBe("build/icons");
    expect(builder.files).toEqual(expect.arrayContaining(["icon.png", "module-preload.cjs"]));
    const build = readFileSync(join(here, "../scripts/build.mjs"), "utf8");
    expect(build).toContain('copyFileSync(join(here, "build/icons/512x512.png"), join(out, "icon.png"))');
    const start = readFileSync(join(here, "../src/main/start.ts"), "utf8");
    expect(start).toContain('icon: join(opts.appDir, "icon.png")');
    // One source: the site's mark font and the site's size rule.
    const script = readFileSync(join(here, "../scripts/render-icons.mjs"), "utf8");
    expect(script).toContain('join(here, "../web/assets/GeistMono-700.ttf")');
    expect(script).toContain("const share = (s) => (s <= 16 ? 0.94 : s <= 32 ? 0.84 : 0.66);");
    expect(script).toContain('const BG = "#0b0b0b";');
    expect(JSON.parse(readFileSync(join(here, "../package.json"), "utf8")).scripts.icons).toBe("electron scripts/render-icons.mjs");
  });

  it("the generated files are what the configs name: PNG set, .icns and .ico", () => {
    expect(pngSize(readFileSync(join(here, "../build/icon.png")))).toEqual([1024, 1024]);
    for (const n of [16, 32, 48, 64, 128, 256, 512, 1024])
      expect(pngSize(readFileSync(join(here, `../build/icons/${n}x${n}.png`))), String(n)).toEqual([n, n]);
    const icns = readFileSync(join(here, "../build/icon.icns"));
    expect(icns.subarray(0, 4).toString("ascii")).toBe("icns");
    expect(icns.readUInt32BE(4)).toBe(icns.length);
    const types: string[] = [];
    for (let o = 8; o < icns.length; o += icns.readUInt32BE(o + 4)) types.push(icns.subarray(o, o + 4).toString("ascii"));
    expect(types).toEqual(["icp4", "icp5", "icp6", "ic07", "ic08", "ic09", "ic10", "ic11", "ic12", "ic13", "ic14"]);
    const ico = readFileSync(join(here, "../build/icon.ico"));
    expect([ico.readUInt16LE(0), ico.readUInt16LE(2)]).toEqual([0, 1]);
    const sizes = Array.from({ length: ico.readUInt16LE(4) }, (_, i) => ico.readUInt8(6 + 16 * i) || 256);
    expect(sizes).toEqual([16, 24, 32, 48, 64, 128, 256]);
  });
});

describe("release workflow", () => {
  it("defaults to read-only permissions", () => {
    expect(wf.permissions).toEqual({ contents: "read" });
  });
  it("builds the AppImage and the dmg", () => {
    expect(JSON.stringify(wf.jobs.linux.steps)).toContain("--linux AppImage");
    expect(JSON.stringify(wf.jobs.mac.steps)).toContain("--mac dmg");
    expect(wf.jobs.mac["runs-on"]).toMatch(/^macos/);
  });
  it("signing secrets appear only in the macOS job, which runs in the protected `release` environment", () => {
    expect(wf.jobs.mac.environment).toBe("release");
    for (const [name, job] of Object.entries(wf.jobs)) {
      const s = JSON.stringify(job);
      if (name === "mac") {
        for (const k of ["CSC_LINK", "CSC_KEY_PASSWORD", "APPLE_API_KEY", "APPLE_API_KEY_ID", "APPLE_API_ISSUER"])
          expect(s).toContain(`secrets.${k}`);
      } else {
        expect(s, name).not.toMatch(/secrets\.(CSC_|APPLE_)/);
      }
    }
  });
  it("refuses to publish an unsigned or un-notarised macOS artefact (S-30)", () => {
    const steps = JSON.stringify(wf.jobs.mac.steps);
    expect(steps).toContain("refusing an unsigned macOS build");
    expect(steps).toContain("codesign --verify --deep --strict");
    expect(steps).toContain("xcrun stapler validate");
    // Upload comes after the verification step.
    const names = wf.jobs.mac.steps.map((x: { name?: string; uses?: string }) => x.name ?? x.uses);
    expect(names.indexOf("refuse an unsigned or un-notarised artefact (S-30)")).toBeLessThan(names.indexOf("actions/upload-artifact@v4"));
    expect(wf.jobs.release.needs).toEqual(["linux", "mac"]);
  });
  it("installs with lifecycle scripts off (S-7) and never signs outside Actions (D7)", () => {
    expect((wfText.match(/npm ci --ignore-scripts/g) ?? []).length).toBe(3);
    expect(wfText).not.toMatch(/npm (install|i) /);
  });
});
