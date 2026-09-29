/**
 * Drives `runCli` in-process against the REAL orchestrator (packages/orchestrator) wired to the
 * orchestrator's contract-faithful fake control plane and fake agent CLIs (its test harness).
 */
import type { Orchestrator } from "@waronsaas/contracts";
import { type CliIo, runCli } from "../src/cli.js";

export { type Harness, harness } from "../../../packages/orchestrator/test/support/harness.js";
export { ABU_KEY, FEATURE, TARGET } from "../../../packages/orchestrator/test/support/fake-control-plane.js";

export interface Run {
  code: number;
  out: string;
  err: string;
  asked: string[];
}

export interface RunOptions {
  /** stdin lines, answered in order; null (end of input) after the last. */
  lines?: string[];
  /** Or compute each answer when asked (e.g. read the emailed code once it exists). */
  answer?: (question: string) => string | null;
  isTTY?: boolean;
  env?: Record<string, string>;
}

export function testIo(lines: string[] = [], opts: RunOptions = {}) {
  const out: string[] = [];
  const err: string[] = [];
  const asked: string[] = [];
  const io: CliIo = {
    stdout: { write: (s: string) => out.push(s) },
    stderr: { write: (s: string) => err.push(s) },
    prompt: async (q) => {
      asked.push(q);
      if (opts.answer) return opts.answer(q);
      return lines.length ? lines.shift()! : null;
    },
    env: opts.env ?? {},
    isTTY: opts.isTTY ?? false,
  };
  return { io, out: () => out.join(""), err: () => err.join(""), asked };
}

export async function wos(make: () => Orchestrator, argv: string[], opts: RunOptions = {}): Promise<Run> {
  const t = testIo(opts.lines, opts);
  const code = await runCli(argv, t.io, { orchestrator: make, version: "0.0.0-test", hostname: "test-host" });
  return { code, out: t.out(), err: t.err(), asked: t.asked };
}

/** Replace machine-specific temp paths so goldens are stable. */
export function normalize(text: string, paths: Record<string, string[]>): string {
  const pairs = Object.entries(paths).flatMap(([name, ps]) => ps.map((p) => [name, p] as const));
  let s = text;
  for (const [name, p] of pairs.sort((a, b) => b[1].length - a[1].length)) s = s.split(p).join(name);
  return s;
}
