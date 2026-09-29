/**
 * Presentation only: OrchestratorEvents and results as terse, monochrome lines (or JSON lines with
 * --json). No workflow decisions are made here. Emphasis is bold/dim only, and only on a TTY without
 * NO_COLOR.
 */
import type { LocalStatus, OrchestratorEvent, RunResult } from "@waronsaas/contracts";

export interface Writer {
  write(chunk: string): unknown;
}

export interface Style {
  bold(s: string): string;
  dim(s: string): string;
}

const PLAIN: Style = { bold: (s) => s, dim: (s) => s };
const ANSI: Style = { bold: (s) => `\u001b[1m${s}\u001b[22m`, dim: (s) => `\u001b[2m${s}\u001b[22m` };

/** Bold/dim only when writing to a terminal, NO_COLOR is unset (any value disables, per no-color.org) and TERM is not dumb. */
export function styleFor(opts: { isTTY: boolean; env: Record<string, string | undefined>; json: boolean }): Style {
  if (opts.json || !opts.isTTY) return PLAIN;
  if (opts.env.NO_COLOR !== undefined && opts.env.NO_COLOR !== "") return PLAIN;
  if (opts.env.TERM === "dumb") return PLAIN;
  return ANSI;
}

const COL = 9;
const tag = (s: string) => (s.length >= COL ? `${s} ` : s.padEnd(COL));
const short = (sha: string | null | undefined) => (sha ? sha.replace(/^sha256:/, "").slice(0, 12) : "-");

function indent(text: string, prefix = "  "): string {
  return text
    .replace(/\s+$/, "")
    .split("\n")
    .map((l) => `${prefix}${l}`)
    .join("\n");
}

/**
 * Streams events. Human mode prints one line per event, drops repeated identical waits and attempt
 * states (the orchestrator re-emits them on every poll), and shows raw agent output only with --verbose.
 * JSON mode prints every event unchanged, one object per line.
 */
export class EventPrinter {
  private lastAttempt = "";
  private lastWaiting = "";

  constructor(
    private readonly out: Writer,
    private readonly err: Writer,
    private readonly opts: { json: boolean; verbose: boolean; style: Style },
  ) {}

  readonly observe = (e: OrchestratorEvent): void => {
    if (this.opts.json) {
      this.out.write(`${JSON.stringify(e)}\n`);
      return;
    }
    const line = this.human(e);
    if (line === null) return;
    (e.type === "error" || e.type === "warning" ? this.err : this.out).write(`${line}\n`);
  };

  private human(e: OrchestratorEvent): string | null {
    const { bold, dim } = this.opts.style;
    switch (e.type) {
      case "sign_in":
        return `${tag("sign-in")}${tag(e.status)}${e.detail}`;
      case "github_link":
        return `${tag("github")}${tag(e.status)}${e.detail}`;
      case "step":
        return `${bold(tag(e.step))}${tag(e.status)}${e.detail}`;
      case "lease":
        return `${tag("lease")}${tag(e.lease.state)}${e.lease.id} expires ${e.lease.expiresAt}`;
      case "worktree":
        return `${tag("worktree")}${tag("ready")}${e.path} @ ${short(e.baseSha)}`;
      case "context": {
        const m = e.manifest;
        return `${tag("context")}${tag("built")}${m.artifacts.length} artifacts, ${m.budget.estimatedTokens}/${m.budget.limitTokens} tokens, manifest ${short(m.manifestSha256)}`;
      }
      case "agent_started":
        return `${tag("agent")}${tag("started")}${e.role} on ${e.model} (${e.provider}, reasoning ${e.reasoning}) pid ${e.pid}`;
      case "agent_output":
        return this.opts.verbose ? dim(indent(e.chunk, "| ")) : null;
      case "agent_exited":
        return `${tag("agent")}${tag("exited")}code ${e.exitCode} after ${formatMs(e.durationMs)}`;
      case "verify": {
        const head = `${tag("verify")}${tag(e.status)}${e.checkId}${e.exitCode === null ? "" : ` exit ${e.exitCode}`}`;
        return e.status === "failed" && e.outputTail.trim() ? `${head}\n${dim(indent(e.outputTail))}` : head;
      }
      case "scope": {
        const v = e.validation;
        if (v.ok) return `${tag("scope")}${tag("ok")}changeset within scope`;
        const lines = v.errors.map((x) => `  ${x.code}${x.path ? ` ${x.path}` : ""}: ${x.message}`);
        return [`${tag("scope")}${tag("failed")}${v.errors.length} error${v.errors.length === 1 ? "" : "s"}`, ...lines].join("\n");
      }
      case "attempt": {
        const a = e.attempt;
        const key = `${a.id}:${a.state}:${a.pr?.number ?? ""}`;
        if (key === this.lastAttempt) return null;
        this.lastAttempt = key;
        const pr = a.pr ? ` PR #${a.pr.number} ${a.pr.url}` : "";
        const why = a.failureReason ? ` (${a.failureReason})` : "";
        return `${tag("attempt")}${tag(a.state)}${a.abu} ${a.id}${pr}${why}`;
      }
      case "waiting": {
        if (e.reason === this.lastWaiting) return null;
        this.lastWaiting = e.reason;
        return `${tag("waiting")}${tag(e.reason)}since ${e.since}`;
      }
      case "warning":
        return `${tag("warning")}${e.code}: ${e.message}`;
      case "error":
        return `${bold(tag("error"))}${e.code}: ${e.message}${e.recoverable ? " (recoverable)" : ""}`;
    }
  }
}

export function formatMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m${String(s % 60).padStart(2, "0")}s`;
}

/** The final line of a long operation. */
export function describeResult(r: RunResult): string {
  if (!r.ok) return `${tag("result")}${tag("failed")}${r.code}`;
  const parts: string[] = [];
  if (r.task) parts.push(r.task.kind);
  if (r.attempt) parts.push(`attempt ${r.attempt.state}`);
  if (r.attempt?.pr) parts.push(`PR #${r.attempt.pr.number} ${r.attempt.pr.url}`);
  const o = r.output;
  if (o) {
    if (o.schema === "review-verdict.v1") parts.push(`${o.verdict}, ${o.findings.length} finding${o.findings.length === 1 ? "" : "s"}`);
    else if (o.schema === "ruling.v1") parts.push(`ruling: ${o.proposedChange ?? `${o.rulings.length} rulings`}`);
    else parts.push(o.summary);
  }
  return `${tag("result")}${tag("ok")}${parts.join(" | ")}`;
}

// ------------------------------------------------------------------------------------------ status

const PROVIDER_LABEL: Record<string, string> = { claude_cli: "claude", codex_cli: "codex" };

export function renderStatus(s: LocalStatus, work: { leases: number; tasks: number; attempts: string[] } | null, style: Style): string {
  const { bold } = style;
  const rows: Array<[string, string]> = [];
  if (!s.signedIn || !s.me) rows.push(["account", "signed out (wos login)"]);
  else {
    const gh = s.me.github ? `github ${s.me.github.login}` : "github not linked (wos link-github)";
    const who = s.me.handle ? `${s.me.email} (${s.me.handle})` : s.me.email;
    rows.push(["account", `${who}, ${gh}${s.me.canContribute ? "" : ", cannot contribute yet"}`]);
  }
  rows.push(["git", s.git.installed ? (s.git.version ?? "installed") : "not installed"]);
  for (const p of s.providers) {
    const label = PROVIDER_LABEL[p.provider] ?? p.provider;
    const state = !p.installed
      ? "not installed"
      : `${p.cliVersion ?? "?"}, ${p.signedIn ? `signed in${p.authMethod ? ` (${p.authMethod})` : ""}` : "not signed in"}`;
    rows.push([label, `${state}${p.installed ? `, models ${p.models.join(" ") || "none"}` : ""}`]);
  }
  if (s.toolchain) {
    const tools = s.toolchain.tools.map((t) => `${t.name} ${t.version}`).join(", ") || "no tools detected";
    rows.push(["toolchain", `${s.toolchain.os} ${s.toolchain.osVersion}, ${tools}${s.me?.canContribute ? " (attested)" : ""}`]);
  } else rows.push(["toolchain", "not collected"]);
  rows.push(["roles", s.eligibleRoles.length ? s.eligibleRoles.join(" ") : "none (install and sign in to claude or codex)"]);
  rows.push(["leases", s.activeLeases.length ? s.activeLeases.map((l) => `${l.id} until ${l.expiresAt}`).join("; ") : "none active"]);
  if (work) {
    rows.push(["work", `${work.leases} leases, ${work.tasks} tasks, ${work.attempts.length} attempts`]);
    for (const a of work.attempts) rows.push(["", a]);
  }
  rows.push(["workspace", s.workspaceRoot]);
  const problems = s.providers.flatMap((p) => p.problems);
  if (!s.git.installed) problems.unshift("git not installed");
  const body = rows.map(([k, v]) => `${bold(k.padEnd(11))}${v}`).join("\n");
  return `${bold("wOS status")}\n${body}${problems.length ? `\n${bold("problems".padEnd(11))}${problems.join("; ")}` : ""}\n`;
}

/** Fixed-width table for the read commands. */
export function table(headers: string[], rows: string[][], style: Style): string {
  const widths = headers.map((h, i) => Math.max(h.length, ...rows.map((r) => (r[i] ?? "").length)));
  const fmt = (r: string[]) =>
    r
      .map((c, i) => (i === r.length - 1 ? c : c.padEnd(widths[i]! + 2)))
      .join("")
      .trimEnd();
  return `${style.bold(fmt(headers))}\n${rows.map(fmt).join("\n")}\n`;
}
