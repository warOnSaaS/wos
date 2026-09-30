// Shared esbuild settings for wOS Core (apps/api) and wOS Web (apps/web): one self-contained ESM file per entry,
// with `*.sql?raw` imports loaded as text (Vite does the same in tests).
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { build } from "esbuild";

const rawPlugin = {
  name: "raw",
  setup(b) {
    b.onResolve({ filter: /\?raw$/ }, (args) => ({ path: resolve(args.resolveDir, args.path.slice(0, -4)), namespace: "raw" }));
    b.onLoad({ filter: /.*/, namespace: "raw" }, (args) => ({
      contents: readFileSync(args.path, "utf8"),
      loader: "text",
      resolveDir: dirname(args.path),
    }));
  },
};

/** entries: { outName: sourcePath } relative to `root`. */
export async function bundle(root, entries) {
  await build({
    entryPoints: Object.fromEntries(Object.entries(entries).map(([k, v]) => [k, resolve(root, v)])),
    outdir: resolve(root, "dist"),
    outExtension: { ".js": ".mjs" },
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node22",
    // modules/** and applications/** resolve packages from the app's own node_modules too (product repo layout).
    nodePaths: [resolve(root, "node_modules")],
    plugins: [rawPlugin],
    banner: { js: "import{createRequire as __cr}from'module';const require=__cr(import.meta.url);" },
    logLevel: "info",
  });
}
