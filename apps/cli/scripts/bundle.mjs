// Bundles the wOS CLI into ONE file (B-0001-cli, contracts 4.4.0): every @waronsaas/* workspace package is
// inlined; third-party packages stay external and are listed as regular dependencies of @waronsaas/cli.
// Integration glue by the architect at the Wave 2 gate; owner: cli workstream.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const external = new Set();
const result = await build({
  entryPoints: [join(root, "dist/index.js")],
  outfile: join(root, "dist/wos.mjs"),
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  metafile: true,
  banner: { js: "import { createRequire as __wosCreateRequire } from 'node:module'; const require = __wosCreateRequire(import.meta.url);" },
  plugins: [
    {
      name: "external-third-party",
      setup(b) {
        b.onResolve({ filter: /^[^./]/ }, (args) => {
          if (args.path.startsWith("node:") || args.path.startsWith("@waronsaas/")) return undefined;
          const name = args.path.startsWith("@") ? args.path.split("/").slice(0, 2).join("/") : args.path.split("/")[0];
          external.add(name);
          return { path: args.path, external: true };
        });
      },
    },
  ],
});
if (result.errors.length) process.exit(1);
// Every external must be a declared dependency, or the installed CLI would crash at import time.
const missing = [...external].filter((n) => !(n in (pkg.dependencies ?? {})) && !n.startsWith("node:"));
const builtins = new Set((await import("node:module")).builtinModules);
const realMissing = missing.filter((n) => !builtins.has(n));
if (realMissing.length) {
  console.error(`wos bundle: add these to @waronsaas/cli dependencies: ${realMissing.join(", ")}`);
  process.exit(1);
}
const out = join(root, "dist/wos.mjs");
const src = readFileSync(out, "utf8");
if (!src.startsWith("#!")) writeFileSync(out, `#!/usr/bin/env node\n${src.replace(/^#!.*\n/m, "")}`);
console.log(`wos bundle: dist/wos.mjs, external: ${[...external].sort().join(", ") || "none"}`);
