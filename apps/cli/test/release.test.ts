/**
 * The npm-free install path: .github/workflows/cli-release.yml, apps/cli/scripts/release-pack.mjs and the install
 * script waronsaas.com serves (apps/web/install/install.sh). Offline: the install script is run against a fake
 * release in a temporary directory (WOS_INSTALL_FROM), never against GitHub.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { parse } from "yaml";

const ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const INSTALL_SH = join(ROOT, "apps/web/install/install.sh");
const WORKFLOW = join(ROOT, ".github/workflows/cli-release.yml");

type Step = { run?: string; env?: Record<string, string>; uses?: string };
type Job = { permissions?: Record<string, string>; steps: Step[]; if?: string; needs?: string[] | string };

describe(".github/workflows/cli-release.yml", () => {
  const text = readFileSync(WORKFLOW, "utf8");
  const wf = parse(text) as { on: { push: { tags: string[] } }; permissions: Record<string, string>; jobs: Record<string, Job> };

  it("releases only on a cli@ tag, after every platform installed and ran the tarball", () => {
    expect(wf.on.push.tags).toEqual(["cli@*"]);
    expect(wf.jobs.release!.if).toBe("startsWith(github.ref, 'refs/tags/cli@')");
    expect(wf.jobs.release!.needs).toEqual(["pack", "smoke"]);
    expect(text).toMatch(/gh release create "\$TAG" out\/\*\.tar\.gz out\/SHA256SUMS/);
  });

  it("uses no secret but GITHUB_TOKEN, and only the release job can write", () => {
    expect([...text.matchAll(/secrets\.([A-Z_]+)/g)].map((m) => m[1])).toEqual([]);
    expect(text).not.toMatch(/environment:/);
    expect(wf.permissions).toEqual({ contents: "read" });
    for (const [name, job] of Object.entries(wf.jobs)) {
      if (name === "release") expect(job.permissions).toEqual({ contents: "write" });
      else expect(job.permissions).toBeUndefined();
    }
  });

  it("packs every target the install script accepts, with bindings pinned in the lockfile", async () => {
    const src = readFileSync(join(ROOT, "apps/cli/scripts/release-pack.mjs"), "utf8");
    const targets = [...src.matchAll(/^ {2}"([a-z0-9]+-[a-z0-9]+)": \[(.*)\],$/gm)].map((m) => ({
      target: m[1]!,
      pkgs: [...m[2]!.matchAll(/"([^"]+)"/g)].map((p) => p[1]!),
    }));
    expect(targets.map((t) => t.target)).toEqual(["darwin-arm64", "darwin-x64", "linux-x64", "linux-arm64", "win32-x64"]);
    const lock = JSON.parse(readFileSync(join(ROOT, "package-lock.json"), "utf8")) as {
      packages: Record<string, { integrity?: string; resolved?: string }>;
    };
    for (const t of targets) {
      for (const p of t.pkgs) {
        const entry = lock.packages[`node_modules/@napi-rs/keyring-${p}`];
        expect(entry?.integrity, p).toMatch(/^sha512-/);
        expect(entry?.resolved, p).toMatch(/^https:\/\/registry\.npmjs\.org\//);
      }
    }
    const sh = readFileSync(INSTALL_SH, "utf8");
    expect(sh).toMatch(/darwin-arm64 \| darwin-x64 \| linux-x64 \| linux-arm64\)/);
    const matrix = text.match(/target: ([a-z0-9-]+),/g)!.map((m) => m.slice(8, -1));
    expect(matrix).toEqual(targets.map((t) => t.target));
  });
});

describe.skipIf(process.platform === "win32")("apps/web/install/install.sh (offline, against a fake release)", () => {
  const dir = mkdtempSync(join(tmpdir(), "wos-install-test-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  const target = `${process.platform}-${process.arch}`;
  const version = "9.9.9-test";

  /** A release directory holding one tarball shaped like release-pack's, and its SHA256SUMS. */
  function fakeRelease(name: string, tamper = false): string {
    const rel = join(dir, name);
    const stage = join(dir, `${name}-stage`, `wos-${version}-${target}`);
    mkdirSync(join(stage, "dist"), { recursive: true });
    mkdirSync(rel, { recursive: true });
    writeFileSync(join(stage, "package.json"), JSON.stringify({ name: "@waronsaas/cli", version }));
    writeFileSync(
      join(stage, "dist/wos.mjs"),
      '#!/usr/bin/env node\nimport { readFileSync } from "node:fs";\nconst v = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version;\nconsole.log(v + " (contracts test)");\n',
    );
    const file = `wos-${version}-${target}.tar.gz`;
    execFileSync("tar", ["-czf", join(rel, file), "-C", join(dir, `${name}-stage`), `wos-${version}-${target}`], {
      env: { ...process.env, COPYFILE_DISABLE: "1" },
    });
    const sum = createHash("sha256")
      .update(readFileSync(join(rel, file)))
      .digest("hex");
    writeFileSync(join(rel, "SHA256SUMS"), `${sum}  ${file}\n`);
    if (tamper) writeFileSync(join(rel, file), Buffer.concat([readFileSync(join(rel, file)), Buffer.from("x")]));
    return rel;
  }

  const run = (home: string, from: string) =>
    spawnSync("sh", [INSTALL_SH], {
      encoding: "utf8",
      env: { PATH: process.env.PATH, HOME: home, WOS_INSTALL_FROM: from, WOS_VERSION: version },
    });

  it("installs into ~/.local/share/wos/<version>, links ~/.local/bin/wos, and the link runs", () => {
    const home = join(dir, "home-ok");
    const r = run(home, fakeRelease("ok"));
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toContain(`wOS CLI ${version} installed`);
    const bin = join(home, ".local/bin/wos");
    expect(realpathSync(bin)).toBe(realpathSync(join(home, ".local/share/wos", version, "dist/wos.mjs")));
    expect(execFileSync(bin, ["--version"], { encoding: "utf8" })).toBe(`${version} (contracts test)\n`);
  });

  it("refuses a tarball whose checksum does not match, and installs nothing", () => {
    const home = join(dir, "home-bad");
    const r = run(home, fakeRelease("bad", true));
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/checksum mismatch/);
    expect(existsSync(join(home, ".local"))).toBe(false);
  });
});
