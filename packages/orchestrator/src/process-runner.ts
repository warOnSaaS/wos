/** Default ProcessRunner for the CLI and the Desktop main process: node child_process, no shell. */
import { spawn } from "node:child_process";
import type { ProcessRunner } from "./index.js";

export function createNodeProcessRunner(): ProcessRunner {
  return {
    run(input) {
      return new Promise((resolve, reject) => {
        const started = Date.now();
        const child = spawn(input.binary, input.argv, {
          cwd: input.cwd,
          env: input.env,
          shell: false,
          stdio: ["pipe", "pipe", "pipe"],
          signal: input.signal,
        });
        let timedOut = false;
        const timer = setTimeout(() => {
          timedOut = true;
          child.kill("SIGKILL");
        }, input.timeoutMs);
        if (child.pid !== undefined) input.onSpawn?.(child.pid);
        child.stdout.setEncoding("utf8").on("data", (c: string) => input.onStdout(c));
        child.stderr.setEncoding("utf8").on("data", (c: string) => input.onStderr(c));
        child.stdin.on("error", () => undefined);
        child.stdin.end(input.stdin);
        child.on("error", (e) => {
          clearTimeout(timer);
          reject(e);
        });
        child.on("close", (code, sig) => {
          clearTimeout(timer);
          const exitCode = timedOut ? 124 : (code ?? (sig ? 128 : 1));
          resolve({ exitCode, durationMs: Date.now() - started });
        });
      });
    },
  };
}
