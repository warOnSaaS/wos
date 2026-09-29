/**
 * Bundles wOS Desktop with vite into dist/app (run after the root `tsc -b`, which builds the workspace
 * packages the main process bundles):
 *   dist/app/main.mjs       production main process (every workspace package inlined; electron external)
 *   dist/app/preload.cjs    sandboxed preload (CommonJS: sandboxed preloads cannot be ES modules)
 *   dist/app/renderer/      the React renderer (file:// bundle, strict CSP)
 *   dist/app/main-fake.mjs  DEVELOPMENT ONLY: the same main wired to the fake control plane; never packaged
 *
 * Usage: node scripts/build.mjs [--no-fake]
 */
import { copyFileSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { builtinModules } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { build } from "vite";

const here = dirname(dirname(fileURLToPath(import.meta.url)));
const out = join(here, "dist", "app");
const withFake = !process.argv.includes("--no-fake");
const external = ["electron", ...builtinModules, ...builtinModules.map((m) => `node:${m}`)];

rmSync(out, { recursive: true, force: true });

// Renderer.
await build({
  configFile: false,
  logLevel: "warn",
  root: join(here, "src", "renderer"),
  base: "./",
  plugins: [react()],
  build: {
    outDir: join(out, "renderer"),
    emptyOutDir: true,
    assetsInlineLimit: 0,
    modulePreload: false,
    target: "chrome140",
    sourcemap: false,
  },
});

// The font's licence travels with the font (SIL OFL 1.1).
copyFileSync(join(here, "src/renderer/fonts/OFL-JetBrainsMono.txt"), join(out, "renderer", "OFL-JetBrainsMono.txt"));

// Main process (and the development fake entry).
await build({
  configFile: false,
  logLevel: "warn",
  root: here,
  build: {
    outDir: out,
    emptyOutDir: false,
    target: "node22",
    minify: false,
    sourcemap: false,
    ssr: true,
    rollupOptions: {
      input: { main: join(here, "src/main/index.ts"), ...(withFake ? { "main-fake": join(here, "dev/main-fake.ts") } : {}) },
      external,
      output: { format: "es", entryFileNames: "[name].mjs", chunkFileNames: "chunks/[name]-[hash].mjs" },
    },
  },
  ssr: { noExternal: true, target: "node" },
});

// Preload.
await build({
  configFile: false,
  logLevel: "warn",
  root: here,
  build: {
    outDir: out,
    emptyOutDir: false,
    target: "node22",
    minify: false,
    sourcemap: false,
    ssr: true,
    rollupOptions: {
      input: { preload: join(here, "src/preload/index.ts") },
      external,
      output: { format: "cjs", entryFileNames: "[name].cjs" },
    },
  },
  ssr: { noExternal: true, target: "node" },
});

// The packaged app is dist/app alone (electron-builder `directories.app`): a manifest with no dependencies,
// because everything the main process needs is already inlined above.
const pkg = JSON.parse(readFileSync(join(here, "package.json"), "utf8"));
writeFileSync(
  join(out, "package.json"),
  `${JSON.stringify(
    {
      name: "wos-desktop",
      productName: "wOS",
      version: process.env.WOS_DESKTOP_VERSION ?? pkg.version,
      description: pkg.description,
      author: pkg.author,
      homepage: pkg.homepage,
      license: pkg.license,
      type: "module",
      main: "main.mjs",
    },
    null,
    2,
  )}\n`,
);

console.log(`wOS Desktop bundled into ${out}${withFake ? " (with the fake control plane entry)" : ""}`);
