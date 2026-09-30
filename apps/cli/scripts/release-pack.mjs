// Packs the wOS CLI for a GitHub Release (no npm needed to install). One tarball per platform:
//
//   wos-<version>-<target>/
//     package.json            name + version (the CLI reads its version from ../package.json)
//     dist/wos.mjs            every JS dependency inlined, except the native keychain binding
//     node_modules/@napi-rs/keyring[-<platform>]/   the OS keychain binding (SECURITY.md S-4)
//     LICENSE
//
// @napi-rs/keyring is a native addon, so it cannot be inlined: each tarball carries the binding for its
// platform, fetched from the registry URL pinned in package-lock.json and checked against the lockfile's
// integrity hash. Writes release/*.tar.gz and release/SHA256SUMS. Needs no secret.
//
// Usage: node apps/cli/scripts/release-pack.mjs --version 0.1.0 [--out apps/cli/release] [--target darwin-arm64]
// Run `npm run build -w apps/cli` first (it bundles dist/index.js).
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { build } from "esbuild";

const here = dirname(fileURLToPath(import.meta.url));
const cliRoot = join(here, "..");
const repoRoot = join(cliRoot, "../..");

/** Release targets and the keyring platform packages each one carries (Linux: glibc and musl). */
export const TARGETS = {
  "darwin-arm64": ["darwin-arm64"],
  "darwin-x64": ["darwin-x64"],
  "linux-x64": ["linux-x64-gnu", "linux-x64-musl"],
  "linux-arm64": ["linux-arm64-gnu", "linux-arm64-musl"],
  "win32-x64": ["win32-x64-msvc"],
};

const { values } = parseArgs({
  options: {
    version: { type: "string" },
    out: { type: "string", default: join(cliRoot, "release") },
    target: { type: "string", multiple: true },
  },
});
const version = values.version;
if (!version || !/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(version)) {
  console.error("release-pack: --version <semver> is required (the tag cli@<version> without the prefix)");
  process.exit(2);
}
const targets = values.target?.length ? values.target : Object.keys(TARGETS);
for (const t of targets) if (!(t in TARGETS)) throw new Error(`unknown target ${t}; one of ${Object.keys(TARGETS).join(", ")}`);

// 1. One bundle for every target: all JS inlined, only the native binding stays external.
const workDir = mkdtempSync(join(tmpdir(), "wos-release-"));
const bundlePath = join(workDir, "wos.mjs");
const result = await build({
  entryPoints: [join(cliRoot, "dist/index.js")],
  outfile: bundlePath,
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  external: ["@napi-rs/keyring"],
  legalComments: "none",
  banner: { js: "import { createRequire as __wosCreateRequire } from 'node:module'; const require = __wosCreateRequire(import.meta.url);" },
  logLevel: "warning",
});
if (result.errors.length) process.exit(1);
const src = readFileSync(bundlePath, "utf8");
writeFileSync(bundlePath, `#!/usr/bin/env node\n${src.replace(/^#!.*\n/m, "")}`, { mode: 0o755 });

// 2. The keyring packages exactly as the lockfile pins them.
const lock = JSON.parse(readFileSync(join(repoRoot, "package-lock.json"), "utf8"));
function locked(name) {
  const entry = lock.packages[`node_modules/${name}`];
  if (!entry?.resolved || !entry.integrity) throw new Error(`${name} is not pinned in package-lock.json`);
  return entry;
}
async function fetchPackage(name, dest) {
  const { resolved, integrity } = locked(name);
  const res = await fetch(resolved);
  if (!res.ok) throw new Error(`${name}: GET ${resolved} -> ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const [algo, expected] = integrity.split("-", 2);
  const actual = createHash(algo).update(buf).digest("base64");
  if (actual !== expected) throw new Error(`${name}: integrity mismatch against package-lock.json`);
  const tgz = join(workDir, `${name.replace("/", "__")}.tgz`);
  writeFileSync(tgz, buf);
  mkdirSync(dest, { recursive: true });
  execFileSync("tar", ["-xzf", tgz, "-C", dest, "--strip-components=1"]);
}

// 3. One staged directory and tarball per target, then SHA256SUMS over the tarballs.
mkdirSync(values.out, { recursive: true });
const license = readFileSync(join(repoRoot, "LICENSE"), "utf8");
const keyringVersion = locked("@napi-rs/keyring").version;
const written = [];
for (const target of targets) {
  const name = `wos-${version}-${target}`;
  const stage = join(workDir, name);
  mkdirSync(join(stage, "dist"), { recursive: true });
  cpSync(bundlePath, join(stage, "dist/wos.mjs"));
  writeFileSync(
    join(stage, "package.json"),
    `${JSON.stringify(
      {
        name: "@waronsaas/cli",
        version,
        type: "module",
        private: true,
        license: "Apache-2.0",
        bin: { wos: "./dist/wos.mjs" },
        engines: { node: ">=22.12" },
      },
      null,
      2,
    )}\n`,
  );
  writeFileSync(join(stage, "LICENSE"), license);
  await fetchPackage("@napi-rs/keyring", join(stage, "node_modules/@napi-rs/keyring"));
  for (const p of TARGETS[target]) {
    const pkg = `@napi-rs/keyring-${p}`;
    if (locked(pkg).version !== keyringVersion) throw new Error(`${pkg} version differs from @napi-rs/keyring`);
    await fetchPackage(pkg, join(stage, "node_modules", pkg));
  }
  const tarball = `${name}.tar.gz`;
  // COPYFILE_DISABLE: no macOS extended attributes in the archive when packed on a Mac.
  execFileSync("tar", ["-czf", join(values.out, tarball), "-C", workDir, name], { env: { ...process.env, COPYFILE_DISABLE: "1" } });
  written.push(tarball);
}
const sums = readdirSync(values.out)
  .filter((f) => f.endsWith(".tar.gz") && f.startsWith(`wos-${version}-`))
  .sort()
  .map(
    (f) =>
      `${createHash("sha256")
        .update(readFileSync(join(values.out, f)))
        .digest("hex")}  ${f}`,
  );
writeFileSync(join(values.out, "SHA256SUMS"), `${sums.join("\n")}\n`);
rmSync(workDir, { recursive: true, force: true });
if (!existsSync(join(values.out, "SHA256SUMS"))) process.exit(1);
console.log(`release-pack: ${written.join(", ")} + SHA256SUMS in ${values.out}`);
