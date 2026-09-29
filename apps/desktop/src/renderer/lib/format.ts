/**
 * Pure formatting for the renderer (unit-tested). Honest numbers: basis points are shown to two
 * decimals and 0 is "0.00%", never hidden, rounded up or replaced by a dash.
 */
import type { DesktopEvent } from "../../shared/ipc.js";

type OrchestratorEvent = Extract<DesktopEvent, { kind: "orchestrator" }>["event"];

export function pct(bp: number | null | undefined): string {
  if (bp === null || bp === undefined || !Number.isFinite(bp)) return "0.00%";
  const v = Math.max(0, Math.min(10_000, Math.trunc(bp)));
  return `${Math.floor(v / 100)}.${String(v % 100).padStart(2, "0")}%`;
}

/** Text bar like the site's: [##........]. Decorative; the number next to it is the value. */
export function bar(bp: number | null | undefined, cells = 10): string {
  const v = Math.max(0, Math.min(10_000, bp ?? 0));
  // Never shows a filled cell for less than one cell's worth: 0.5% is not "some progress" on a 10-cell bar.
  const filled = Math.floor((v / 10_000) * cells);
  return `[${"#".repeat(filled)}${".".repeat(cells - filled)}]`;
}

export function clock(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "--:--:--";
  return d.toISOString().slice(11, 19);
}

export function date(iso: string | null | undefined): string {
  if (!iso) return "NONE";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "NONE" : d.toISOString().slice(0, 10);
}

export function upper(s: string): string {
  return s.replace(/_/g, " ").toUpperCase();
}

export interface LogLine {
  tag: string;
  text: string;
  /** Emphasis by weight only (the look has no colour): failures and outcomes are bold. */
  strong: boolean;
}

/** One agent_output chunk may hold several lines of claude stream-json / codex --json; show the words. */
export function agentLines(chunk: string): string[] {
  const out: string[] = [];
  for (const raw of chunk.split("\n")) {
    const line = raw.trimEnd();
    if (!line) continue;
    if (!line.startsWith("{")) {
      out.push(line);
      continue;
    }
    try {
      const ev = JSON.parse(line) as Record<string, unknown>;
      const t = ev.type;
      if (t === "assistant") {
        const content = (ev.message as { content?: Array<{ type?: string; text?: string }> } | undefined)?.content ?? [];
        for (const c of content) if (c.type === "text" && c.text) out.push(c.text);
      } else if (t === "item.completed") {
        const item = ev.item as { type?: string; text?: string } | undefined;
        if (item?.text) out.push(item.text);
      } else if (t === "system" && typeof ev.model === "string") out.push(`session started, model ${ev.model}`);
      else if (t === "thread.started" && typeof ev.model === "string") out.push(`session started, model ${ev.model}`);
      else if (t === "result") out.push(`result: ${String(ev.subtype ?? "done")}`);
      else if (t === "turn.completed") out.push("turn completed");
    } catch {
      out.push(line);
    }
  }
  return out;
}

export function eventLines(e: OrchestratorEvent): LogLine[] {
  switch (e.type) {
    case "sign_in":
      return [{ tag: "SIGN-IN", text: `${upper(e.status)} ${e.detail}`, strong: e.status === "failed" }];
    case "github_link":
      return [{ tag: "GITHUB", text: `${upper(e.status)} ${e.detail}`, strong: e.status !== "waiting_for_user" }];
    case "step":
      return [{ tag: e.step, text: `${upper(e.status)} ${e.detail}`, strong: e.status === "failed" || e.status === "passed" }];
    case "lease":
      return [{ tag: "LEASE", text: `${e.lease.id} ${upper(e.lease.state)} UNTIL ${e.lease.expiresAt}`, strong: false }];
    case "worktree":
      return [{ tag: "WORKTREE", text: `${e.path} @ ${e.baseSha.slice(0, 12)}`, strong: false }];
    case "context":
      return [
        {
          tag: "CONTEXT",
          text: `MANIFEST ${e.manifest.manifestSha256.slice(0, 12)}, ${e.manifest.artifacts.length} ARTIFACTS`,
          strong: false,
        },
      ];
    case "agent_started":
      return [
        { tag: "AGENT", text: `STARTED ${e.role} ${e.model} (${e.provider}) REASONING ${upper(e.reasoning)} PID ${e.pid}`, strong: false },
      ];
    case "agent_output":
      return agentLines(e.chunk).map((text) => ({ tag: e.stream === "stderr" ? "STDERR" : "AGENT", text, strong: false }));
    case "agent_exited":
      return [{ tag: "AGENT", text: `EXITED ${e.exitCode} AFTER ${(e.durationMs / 1000).toFixed(1)}S`, strong: e.exitCode !== 0 }];
    case "verify":
      return [
        {
          tag: "VERIFY",
          text: `${e.checkId} ${upper(e.status)}${e.exitCode === null ? "" : ` EXIT ${e.exitCode}`}`,
          strong: e.status === "failed",
        },
        ...(e.status !== "running" && e.outputTail.trim()
          ? e.outputTail
              .trim()
              .split("\n")
              .slice(-3)
              .map((text) => ({ tag: "VERIFY", text: `  ${text}`, strong: false }))
          : []),
      ];
    case "scope":
      return [
        {
          tag: "SCOPE",
          text: e.validation.ok ? "IN SCOPE" : `REFUSED ${e.validation.errors.map((x) => x.code).join(", ")}`,
          strong: !e.validation.ok,
        },
      ];
    case "attempt":
      return [
        {
          tag: "ATTEMPT",
          text: `${e.attempt.abu} ${upper(e.attempt.state)}${e.attempt.pr ? ` PR #${e.attempt.pr.number}` : ""}`,
          strong: true,
        },
      ];
    case "waiting":
      return [{ tag: "WAITING", text: `FOR ${upper(e.reason)} SINCE ${clock(e.since)}`, strong: false }];
    case "warning":
      return [{ tag: "WARNING", text: `${e.code} ${e.message}`, strong: true }];
    case "error":
      return [{ tag: "ERROR", text: `${e.code} ${e.message}${e.recoverable ? " (RECOVERABLE)" : ""}`, strong: true }];
    default:
      return [];
  }
}
