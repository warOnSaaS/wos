import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const REPO_ROOT = fileURLToPath(new URL("../../../../", import.meta.url));

/** git with the user's global/system config ignored (no signing hooks, no aliases) and a fixed identity. */
export const gitEnv = (extra: Record<string, string> = {}): NodeJS.ProcessEnv => ({
  ...process.env,
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_AUTHOR_NAME: "adventurini",
  GIT_AUTHOR_EMAIL: "anthonydventurini@gmail.com",
  GIT_COMMITTER_NAME: "adventurini",
  GIT_COMMITTER_EMAIL: "anthonydventurini@gmail.com",
  ...extra,
});

export class TempRepo {
  readonly dir: string;
  constructor(prefix: string, opts: { bare?: boolean; dir?: string } = {}) {
    this.dir = opts.dir ?? mkdtempSync(join(tmpdir(), `wos-${prefix}-`));
    this.git(opts.bare ? ["init", "-q", "--bare", "-b", "main"] : ["init", "-q", "-b", "main"]);
  }
  git(args: string[], env: Record<string, string> = {}): string {
    return execFileSync("git", args, { cwd: this.dir, env: gitEnv(env), encoding: "utf8" }).trim();
  }
  write(path: string, content: string | Buffer): this {
    const p = join(this.dir, path);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, content);
    return this;
  }
  symlink(path: string, target: string): this {
    const p = join(this.dir, path);
    mkdirSync(dirname(p), { recursive: true });
    symlinkSync(target, p);
    return this;
  }
  commit(message: string, env: Record<string, string> = {}): string {
    this.git(["add", "-A"]);
    this.git(["commit", "-q", "--no-verify", "-m", message], env);
    return this.git(["rev-parse", "HEAD"]);
  }
  run(cmd: string, args: string[], env: NodeJS.ProcessEnv = {}) {
    const r = spawnSync(cmd, args, { cwd: this.dir, env: { ...gitEnv(), ...env }, encoding: "utf8" });
    return { status: r.status, out: `${r.stdout}${r.stderr}` };
  }
  remove() {
    rmSync(this.dir, { recursive: true, force: true });
  }
}
