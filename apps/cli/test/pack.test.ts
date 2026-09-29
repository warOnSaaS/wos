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
  it("contains the wos binary with a node shebang, and no sources, maps or build info", () => {
    execFileSync(process.execPath, [`${ROOT}node_modules/typescript/bin/tsc`, "-b", "apps/cli"], { cwd: ROOT, stdio: "pipe" });
    const [pack] = JSON.parse(
      execFileSync("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], {
        cwd: CLI_DIR,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      }),
    ) as Array<{ name: string; files: Array<{ path: string }> }>;
    expect(pack!.name).toBe("@waronsaas/cli");
    const pkg = JSON.parse(readFileSync(`${CLI_DIR}package.json`, "utf8")) as { bin: Record<string, string> };
    expect(pkg.bin).toEqual({ wos: "./dist/index.js" });
    const files = pack!.files.map((f) => f.path).sort();
    expect(files).toEqual(expect.arrayContaining(["dist/index.js", "dist/cli.js", "dist/keychain.js", "dist/render.js", "package.json"]));
    expect(files.filter((f) => !f.startsWith("dist/") && f !== "package.json")).toEqual([]);
    expect(files.filter((f) => f.endsWith(".map") || f.endsWith(".tsbuildinfo"))).toEqual([]);
    expect(readFileSync(`${CLI_DIR}dist/index.js`, "utf8").startsWith("#!/usr/bin/env node\n")).toBe(true);
  });

  it("the built binary runs: wos --version prints the version and contracts", () => {
    const out = execFileSync(process.execPath, [`${CLI_DIR}dist/index.js`, "--version"], { encoding: "utf8" });
    expect(out).toMatch(/^0\.0\.0 \(contracts \d+\.\d+\.\d+\)\n$/);
  });
});
