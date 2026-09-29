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

describe("electron-builder config", () => {
  it("targets a macOS dmg and a Linux AppImage", () => {
    expect(builder.mac.target.map((t: { target: string }) => t.target)).toEqual(["dmg"]);
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
