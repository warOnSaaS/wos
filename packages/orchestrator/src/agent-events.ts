/**
 * What an agent CLI's event stream says about a run (contracts 5.17.0): the structured output, the model as the CLI and
 * the endpoint declared it, token usage as reported, every web access (D70) and the sub-agents it started (D69).
 * Shapes, by provider:
 *  - claude `-p --output-format stream-json --verbose`: init `model`; assistant `message.model` and `tool_use` blocks
 *    (WebFetch input.url, WebSearch input.query, Agent/Task = a sub-agent); user `tool_result` blocks (fetched content,
 *    hashed as the agent received it); `result` (structured_output, usage). UNVERIFIED shapes beyond init/result.
 *  - codex `exec --json`: `web_search` items (query only; codex cannot report fetched URLs). UNVERIFIED.
 *  - opencode `run --format json` (1.18.31, from its source): one JSON object per line
 *    `{type, timestamp, sessionID, part}`; `tool_use` parts are `{type:"tool", tool, state:{status, input, output,
 *    time:{start,end}}}` (webfetch input.url, websearch input.query, task = a sub-agent); `step_finish` parts carry
 *    `tokens {input, output, reasoning, cache}`. Only the lead session's parts are printed.
 * Missing fields stay null: nothing is estimated.
 */
import type { AgentUsageDetail } from "@waronsaas/contracts";
import { sha256Of } from "@waronsaas/contracts/canonical";

export interface AgentFetch {
  kind: "fetch" | "search";
  target: string;
  at: string | null;
  contentSha256: string | null;
  tool: string;
}

export interface AgentEvents {
  output: unknown;
  /** `model` of the first event that has one (claude's init event): the model the CLI requested. */
  model: string | null;
  /** Distinct `message.model` values of claude assistant events: what the endpoint said it ran. */
  respondedModels: string[];
  usage: { inputTokens: number | null; outputTokens: number | null };
  fetches: AgentFetch[];
  subagents: { count: number; maxConcurrent: number | null };
  /** contracts 5.19.0: token accounting as reported (null when the CLI reported nothing). */
  usageDetail: AgentUsageDetail | null;
}

const SUBAGENT_TOOLS = new Set(["Agent", "Task", "task"]);
const iso = (ms: unknown): string | null => (typeof ms === "number" && Number.isFinite(ms) ? new Date(ms).toISOString() : null);
const text = (v: unknown): string =>
  typeof v === "string"
    ? v
    : Array.isArray(v)
      ? v.map((x) => (typeof x === "object" && x && "text" in x ? String((x as { text: unknown }).text) : JSON.stringify(x))).join("")
      : JSON.stringify(v ?? null);

/** The most intervals open at once. */
function maxOverlap(intervals: Array<{ start: number; end: number }>): number {
  const points = intervals.flatMap((i) => [
    { t: i.start, d: 1 },
    { t: i.end, d: -1 },
  ]);
  points.sort((a, b) => a.t - b.t || a.d - b.d);
  let cur = 0;
  let max = 0;
  for (const p of points) {
    cur += p.d;
    max = Math.max(max, cur);
  }
  return max;
}

export function parseAgentEvents(provider: string, stdout: string): AgentEvents {
  const out: AgentEvents = {
    output: null,
    model: null,
    respondedModels: [],
    usage: { inputTokens: null, outputTokens: null },
    fetches: [],
    subagents: { count: 0, maxConcurrent: null },
    usageDetail: null,
  };
  const acc = {
    input: null as number | null,
    output: null as number | null,
    reasoning: null as number | null,
    cacheRead: null as number | null,
    cacheWrite: null as number | null,
    cost: null as number | null,
    steps: 0,
    reason: null as string | null,
  };
  const add = (k: "input" | "output" | "reasoning" | "cacheRead" | "cacheWrite" | "cost", v: unknown) => {
    if (typeof v === "number" && Number.isFinite(v)) acc[k] = (acc[k] ?? 0) + v;
  };
  const claudeFetches = new Map<string, number>(); // tool_use id -> index in fetches
  const spans: Array<{ start: number; end: number }> = [];
  let tokensIn: number | null = null;
  let tokensOut: number | null = null;
  for (const line of stdout.split("\n")) {
    const t = line.trim();
    if (!t.startsWith("{")) continue;
    let ev: Record<string, unknown>;
    try {
      ev = JSON.parse(t) as Record<string, unknown>;
    } catch {
      continue;
    }
    if (typeof ev.model === "string" && out.model === null) out.model = ev.model;
    const msg = ev.message as { model?: unknown; content?: unknown } | undefined;
    if (ev.type === "assistant" && msg) {
      if (typeof msg.model === "string" && !out.respondedModels.includes(msg.model)) out.respondedModels.push(msg.model);
      for (const b of Array.isArray(msg.content) ? (msg.content as Array<Record<string, unknown>>) : []) {
        if (b.type !== "tool_use") continue;
        const name = String(b.name ?? "");
        const input = (b.input ?? {}) as Record<string, unknown>;
        if (SUBAGENT_TOOLS.has(name)) out.subagents.count++;
        if (name === "WebFetch" && typeof input.url === "string") {
          claudeFetches.set(String(b.id ?? ""), out.fetches.length);
          out.fetches.push({ kind: "fetch", target: input.url, at: null, contentSha256: null, tool: name });
        }
        if (name === "WebSearch" && typeof input.query === "string")
          out.fetches.push({ kind: "search", target: input.query, at: null, contentSha256: null, tool: name });
      }
    }
    if (ev.type === "user" && msg && Array.isArray(msg.content)) {
      for (const b of msg.content as Array<Record<string, unknown>>) {
        const i = b.type === "tool_result" ? claudeFetches.get(String(b.tool_use_id ?? "")) : undefined;
        if (i !== undefined) out.fetches[i]!.contentSha256 = sha256Of(text(b.content));
      }
    }
    if (ev.type === "result") {
      if (ev.structured_output && typeof ev.structured_output === "object") out.output = ev.structured_output;
      else if (typeof ev.result === "string") {
        try {
          out.output = JSON.parse(ev.result);
        } catch {
          out.output = null;
        }
      }
      const u = ev.usage as
        | { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number }
        | undefined;
      if (u) out.usage = { inputTokens: u.input_tokens ?? null, outputTokens: u.output_tokens ?? null };
      if (u) {
        add("input", u.input_tokens);
        add("output", u.output_tokens);
        add("cacheRead", u.cache_read_input_tokens);
        add("cacheWrite", u.cache_creation_input_tokens);
      }
      add("cost", ev.total_cost_usd);
      if (typeof ev.num_turns === "number") acc.steps = ev.num_turns;
      if (typeof ev.subtype === "string") acc.reason = ev.subtype;
    }
    // codex: web_search items (query only).
    const item = ev.item as { type?: unknown; query?: unknown } | undefined;
    if (provider === "codex_cli" && item?.type === "web_search" && typeof item.query === "string")
      out.fetches.push({ kind: "search", target: item.query, at: null, contentSha256: null, tool: "web_search" });
    // opencode: lead-session parts.
    if (provider === "opencode_cli") {
      const part = ev.part as Record<string, unknown> | undefined;
      if (ev.type === "tool_use" && part?.type === "tool") {
        const tool = String(part.tool ?? "");
        const state = (part.state ?? {}) as { input?: Record<string, unknown>; output?: unknown; time?: { start?: number; end?: number } };
        if (SUBAGENT_TOOLS.has(tool)) {
          out.subagents.count++;
          if (typeof state.time?.start === "number" && typeof state.time.end === "number")
            spans.push({ start: state.time.start, end: state.time.end });
        }
        if (tool === "webfetch" && typeof state.input?.url === "string")
          out.fetches.push({
            kind: "fetch",
            target: state.input.url,
            at: iso(state.time?.start),
            contentSha256: state.output === undefined ? null : sha256Of(text(state.output)),
            tool,
          });
        if (tool === "websearch" && typeof state.input?.query === "string")
          out.fetches.push({ kind: "search", target: state.input.query, at: iso(state.time?.start), contentSha256: null, tool });
      }
      if (ev.type === "step_finish" && part) {
        const tk = part.tokens as
          | { input?: number; output?: number; reasoning?: number; cache?: { read?: number; write?: number } }
          | undefined;
        if (typeof tk?.input === "number") tokensIn = (tokensIn ?? 0) + tk.input;
        if (typeof tk?.output === "number") tokensOut = (tokensOut ?? 0) + tk.output;
        acc.steps++;
        add("input", tk?.input);
        add("output", tk?.output);
        add("reasoning", tk?.reasoning);
        add("cacheRead", tk?.cache?.read);
        add("cacheWrite", tk?.cache?.write);
        add("cost", part.cost);
        acc.reason = typeof part.reason === "string" ? part.reason : acc.reason;
      }
    }
  }
  if (acc.steps > 0 || acc.input !== null || acc.output !== null)
    out.usageDetail = {
      inputTokens: acc.input,
      outputTokens: acc.output,
      reasoningTokens: acc.reasoning,
      cacheReadTokens: acc.cacheRead,
      cacheWriteTokens: acc.cacheWrite,
      costUsd: acc.cost,
      steps: acc.steps,
      lastFinishReason: acc.reason,
    };
  if (provider === "opencode_cli") {
    out.usage = { inputTokens: tokensIn, outputTokens: tokensOut };
    out.subagents.maxConcurrent = out.subagents.count === 0 ? 0 : spans.length === out.subagents.count ? maxOverlap(spans) : null;
  }
  return out;
}

/** D70: web accesses off the plan's allowlist (fetches whose host is not one of `domains` or a subdomain). */
export function offAllowlist(fetches: readonly AgentFetch[], web: { domains: readonly string[]; search: boolean } | null): string[] {
  const bad: string[] = [];
  for (const f of fetches) {
    if (f.kind === "search") {
      if (!web?.search) bad.push(`search "${f.target}" (this plan has no web search)`);
      continue;
    }
    let host: string | null = null;
    try {
      const u = new URL(f.target);
      host = u.protocol === "https:" || u.protocol === "http:" ? u.hostname.toLowerCase() : null;
    } catch {
      host = null;
    }
    const ok = host !== null && (web?.domains ?? []).some((d) => host === d.toLowerCase() || host!.endsWith(`.${d.toLowerCase()}`));
    if (!ok) bad.push(f.target);
  }
  return bad;
}

/** One line for people: the run's token accounting as the CLI reported it (contracts 5.19.0). */
export function formatUsage(u: AgentUsageDetail): string {
  const n = (v: number | null) => (v === null ? "?" : v.toLocaleString("en-US"));
  return [
    `in ${n(u.inputTokens)}`,
    `out ${n(u.outputTokens)}`,
    `reasoning ${n(u.reasoningTokens)}`,
    `cache read ${n(u.cacheReadTokens)}`,
    `cache write ${n(u.cacheWriteTokens)}`,
    `cost ${u.costUsd === null ? "?" : `$${u.costUsd.toFixed(2)}`} (as reported)`,
    `${u.steps} step(s)`,
    `last finish ${u.lastFinishReason ?? "?"}`,
  ].join(", ");
}
