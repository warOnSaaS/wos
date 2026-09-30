/**
 * DRAFT — provider usage adapters (docs/protocol/USAGE-PROOF.md section 2). Pure functions from CLI output lines to
 * the canonical, mutually exclusive usage categories:
 *
 *   inputTokens            uncached input
 *   cachedInputTokens      input served from the provider's prompt cache (cache read)
 *   cacheWriteInputTokens  input written to the cache
 *   outputTokens           output INCLUDING reasoning/thinking tokens (billing semantics; never priced twice)
 *   reasoningOutputTokens  informational subset of outputTokens
 *
 * Events are deduplicated by provider response id (claude `message.id`, codex rollout `response_id`): a response that
 * appears several times (streamed partials, cumulative reports) counts once, with its LAST reported usage. Field
 * shapes marked OBSERVED were read from local session files on 2026-09-29 (no model call); the rest are UNVERIFIED
 * until the fixture suite records real output from each pinned CLI version.
 */
import type { ProviderUsage } from "./entities.js";

export interface AdapterResult {
  usage: ProviderUsage;
  /** Provider response ids seen, deduplicated (for usageEventIdsSha256 and cross-run duplicate detection). */
  eventIds: string[];
  modelsReported: string[];
  reasoningObserved: string | null;
  /** Usage attributed to sub-agents (claude events with parent_tool_use_id). Any value > 0 fails the run (policy). */
  subagentEvents: number;
  /** Lines that were JSON but did not parse as a known event (kept for diagnosis). */
  unknownEvents: number;
}

const zero = (): ProviderUsage => ({
  inputTokens: 0,
  cachedInputTokens: 0,
  cacheWriteInputTokens: 0,
  outputTokens: 0,
  reasoningOutputTokens: 0,
});

function n(v: unknown): number {
  return typeof v === "number" && Number.isSafeInteger(v) && v >= 0 ? v : 0;
}

function add(a: ProviderUsage, b: ProviderUsage): ProviderUsage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    cachedInputTokens: a.cachedInputTokens + b.cachedInputTokens,
    cacheWriteInputTokens: a.cacheWriteInputTokens + b.cacheWriteInputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    reasoningOutputTokens: a.reasoningOutputTokens + b.reasoningOutputTokens,
  };
}

function jsonLines(lines: string | readonly string[]): Record<string, unknown>[] {
  const all = typeof lines === "string" ? lines.split("\n") : lines;
  const out: Record<string, unknown>[] = [];
  for (const raw of all) {
    const t = raw.trim();
    if (!t.startsWith("{")) continue;
    try {
      const v = JSON.parse(t) as unknown;
      if (v && typeof v === "object" && !Array.isArray(v)) out.push(v as Record<string, unknown>);
    } catch {
      // not JSON: ignored (CLIs may print banners)
    }
  }
  return out;
}

/** Anthropic usage object -> canonical. OBSERVED fields: input_tokens, cache_creation_input_tokens, cache_read_input_tokens, output_tokens, output_tokens_details.thinking_tokens. */
export function claudeUsage(u: Record<string, unknown> | undefined): ProviderUsage {
  if (!u) return zero();
  const details = (u.output_tokens_details ?? {}) as Record<string, unknown>;
  return {
    inputTokens: n(u.input_tokens),
    cachedInputTokens: n(u.cache_read_input_tokens),
    cacheWriteInputTokens: n(u.cache_creation_input_tokens),
    outputTokens: n(u.output_tokens),
    reasoningOutputTokens: n(details.thinking_tokens),
  };
}

/** OpenAI/Codex usage object -> canonical. OBSERVED: input_tokens INCLUDES cached_input_tokens; reasoning is inside output. */
export function codexUsage(u: Record<string, unknown> | undefined): ProviderUsage {
  if (!u) return zero();
  const input = n(u.input_tokens);
  const cached = Math.min(n(u.cached_input_tokens), input);
  return {
    inputTokens: input - cached,
    cachedInputTokens: cached,
    cacheWriteInputTokens: n(u.cache_write_input_tokens),
    outputTokens: n(u.output_tokens),
    reasoningOutputTokens: n(u.reasoning_output_tokens),
  };
}

/**
 * `claude -p --output-format stream-json --verbose`: sums per-message usage of `assistant` events deduplicated by
 * message.id (last one wins). The `result` event's usage is returned separately as the cross-check source.
 */
export function parseClaudeStream(lines: string | readonly string[]): AdapterResult & { resultUsage: ProviderUsage | null } {
  const byId = new Map<string, ProviderUsage>();
  const models = new Set<string>();
  let resultUsage: ProviderUsage | null = null;
  let subagentEvents = 0;
  let unknownEvents = 0;
  let reasoningObserved: string | null = null;
  for (const ev of jsonLines(lines)) {
    if (typeof ev.effort === "string") reasoningObserved = ev.effort;
    if (ev.type === "assistant") {
      const msg = (ev.message ?? {}) as Record<string, unknown>;
      const id = typeof msg.id === "string" ? msg.id : null;
      if (typeof msg.model === "string") models.add(msg.model);
      if (ev.parent_tool_use_id != null) subagentEvents++;
      if (id) byId.set(id, claudeUsage(msg.usage as Record<string, unknown> | undefined));
      else unknownEvents++;
    } else if (ev.type === "result") {
      resultUsage = claudeUsage(ev.usage as Record<string, unknown> | undefined);
    } else if (ev.type !== "system" && ev.type !== "user" && ev.type !== "stream_event") {
      unknownEvents++;
    }
  }
  let usage = zero();
  for (const u of byId.values()) usage = add(usage, u);
  return {
    usage,
    eventIds: [...byId.keys()].sort(),
    modelsReported: [...models].sort(),
    reasoningObserved,
    subagentEvents,
    unknownEvents,
    resultUsage,
  };
}

/** `codex exec --json`: sums `turn.completed` usage (UNVERIFIED shape; the repo's fake codex emits it). No response ids. */
export function parseCodexExecStream(lines: string | readonly string[]): AdapterResult {
  let usage = zero();
  let unknownEvents = 0;
  for (const ev of jsonLines(lines)) {
    if (ev.type === "turn.completed") usage = add(usage, codexUsage(ev.usage as Record<string, unknown> | undefined));
    else if (typeof ev.type !== "string") unknownEvents++;
  }
  return { usage, eventIds: [], modelsReported: [], reasoningObserved: null, subagentEvents: 0, unknownEvents };
}

/**
 * Codex session rollout (~/.codex/sessions/.../rollout-*.jsonl; OBSERVED): `token_usage_record` payloads carry
 * `response_id` and per-response `usage`; `token_count` payloads carry cumulative totals (ignored here, used only as a
 * cross-check by callers). Dedup by response_id.
 */
export function parseCodexRollout(lines: string | readonly string[]): AdapterResult & { cumulative: ProviderUsage | null } {
  const byId = new Map<string, ProviderUsage>();
  let cumulative: ProviderUsage | null = null;
  let reasoningObserved: string | null = null;
  const models = new Set<string>();
  for (const ev of jsonLines(lines)) {
    const payload = (ev.payload ?? {}) as Record<string, unknown>;
    if (ev.type === "token_usage_record" && typeof payload.response_id === "string") {
      byId.set(payload.response_id, codexUsage(payload.usage as Record<string, unknown> | undefined));
    } else if (ev.type === "event_msg" && payload.type === "token_count") {
      const info = (payload.info ?? {}) as Record<string, unknown>;
      cumulative = codexUsage(info.total_token_usage as Record<string, unknown> | undefined);
    } else if (ev.type === "turn_context") {
      if (typeof payload.effort === "string") reasoningObserved = payload.effort;
      if (typeof payload.model === "string") models.add(payload.model);
    }
  }
  let usage = zero();
  for (const u of byId.values()) usage = add(usage, u);
  return {
    usage,
    eventIds: [...byId.keys()].sort(),
    modelsReported: [...models].sort(),
    reasoningObserved,
    subagentEvents: 0,
    unknownEvents: 0,
    cumulative,
  };
}

/** Relative mismatch between two usage reports, in basis points of the larger total (0 when both are zero). */
export function usageMismatchBp(a: ProviderUsage, b: ProviderUsage): number {
  const keys = ["inputTokens", "cachedInputTokens", "cacheWriteInputTokens", "outputTokens"] as const;
  let worst = 0;
  for (const k of keys) {
    const hi = Math.max(a[k], b[k]);
    if (hi === 0) continue;
    worst = Math.max(worst, Math.round((Math.abs(a[k] - b[k]) * 10_000) / hi));
  }
  return worst;
}
