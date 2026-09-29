/**
 * DONE: `npm pack` produces @waronsaas/cli with the `wos` binary. Builds apps/cli (incremental), then
 * asks npm what the tarball would contain, without writing it.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const CLI_DIR = fileURLToPath(new URL("..", import.meta.url));
const ROOT = fileURLToPath(new URL("../../..", import.meta.url));

describe("npm pack", () => {
  // Wave 2 gate (B-0001-cli, 4.4.0): the package ships ONE bundled file, dist/wos.mjs (esbuild, @waronsaas/*
  // inlined, third-party packages external and declared as dependencies). The gate also installs the real
  // tarball into an empty directory and runs `wos --help` (docs/dogfood/integration.md).
  it("contains only the bundled wos binary with a node shebang, and no sources, maps or build info", () => {
    execFileSync(process.execPath, [`${ROOT}node_modules/typescript/bin/tsc`, "-b", "apps/cli"], { cwd: ROOT, stdio: "pipe" });
    execFileSync(process.execPath, [`${CLI_DIR}scripts/bundle.mjs`], { cwd: CLI_DIR, stdio: "pipe" });
    const [pack] = JSON.parse(
      execFileSync("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], {
        cwd: CLI_DIR,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      }),
    ) as Array<{ name: string; files: Array<{ path: string }> }>;
    expect(pack!.name).toBe("@waronsaas/cli");
    const pkg = JSON.parse(readFileSync(`${CLI_DIR}package.json`, "utf8")) as { bin: Record<string, string> };
    expect(pkg.bin).toEqual({ wos: "./dist/wos.mjs" });
    const files = pack!.files.map((f) => f.path).sort();
    expect(files).toEqual(["dist/wos.mjs", "package.json"]);
    const bundle = readFileSync(`${CLI_DIR}dist/wos.mjs`, "utf8");
    expect(bundle.startsWith("#!/usr/bin/env node\n")).toBe(true);
    expect(bundle).not.toMatch(/from ["']@waronsaas\//);
  });

  it("the bundled binary runs: wos --version prints the version and contracts", () => {
    const out = execFileSync(process.execPath, [`${CLI_DIR}dist/wos.mjs`, "--version"], { encoding: "utf8" });
    expect(out).toMatch(/^0\.0\.0 \(contracts 4\.4\.0\)\n$/);
  });
});
