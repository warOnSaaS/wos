#!/usr/bin/env node
/**
 * wOS CLI binary (`wos`, npm @waronsaas/cli; owner: cli workstream). Wires the real dependencies
 * (OS keychain, node child processes, fetch) into the orchestrator and hands argv to runCli.
 * Environment: WOS_HOME (workspace, default ~/.wos), WOS_API_URL (default https://api.waronsaas.com).
 */
import { readFileSync } from "node:fs";
import { homedir, hostname } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { HOSTS } from "@waronsaas/contracts";
import { createNodeProcessRunner, createOrchestrator } from "@waronsaas/orchestrator";
import { createAppsApi } from "./apps.js";
import { runCli } from "./cli.js";
import { createKeychainSecretStore } from "./keychain.js";

const version = (JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string }).version;

/** One readline over stdin for every prompt; prompts go to stderr so --json stdout stays clean. */
function stdinPrompter() {
  let rl: ReturnType<typeof createInterface> | null = null;
  const queue: string[] = [];
  const waiting: Array<(line: string | null) => void> = [];
  let closed = false;
  const open = () => {
    if (rl) return;
    rl = createInterface({ input: process.stdin, terminal: false });
    rl.on("line", (l) => {
      const w = waiting.shift();
      if (w) w(l);
      else queue.push(l);
    });
    rl.on("close", () => {
      closed = true;
      for (const w of waiting.splice(0)) w(null);
    });
  };
  return {
    prompt(question: string): Promise<string | null> {
      open();
      if (question) process.stderr.write(question);
      if (queue.length) return Promise.resolve(queue.shift()!);
      if (closed) return Promise.resolve(null);
      return new Promise((resolve) => waiting.push(resolve));
    },
    close: () => rl?.close(),
  };
}

const controller = new AbortController();
process.once("SIGINT", () => {
  process.stderr.write("\ninterrupted: stopping (Ctrl-C again to force)\n");
  controller.abort();
  process.once("SIGINT", () => process.exit(130));
});

const prompter = stdinPrompter();
const apiBaseUrl = process.env.WOS_API_URL ?? HOSTS.api;
const secrets = createKeychainSecretStore();
const code = await runCli(
  process.argv.slice(2),
  {
    stdout: process.stdout,
    stderr: process.stderr,
    prompt: prompter.prompt,
    env: process.env,
    isTTY: process.stdout.isTTY === true,
  },
  {
    version,
    hostname: hostname(),
    signal: controller.signal,
    orchestrator: () =>
      createOrchestrator({
        apiBaseUrl,
        workspaceRoot: process.env.WOS_HOME ?? join(homedir(), ".wos"),
        secrets,
        processes: createNodeProcessRunner(),
        fetch: globalThis.fetch,
        clientKind: "cli",
        clientVersion: version,
      }),
    apps: () => createAppsApi({ baseUrl: apiBaseUrl, fetch: globalThis.fetch, secrets, clientVersion: version }),
  },
);
prompter.close();
process.exitCode = code;
