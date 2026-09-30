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
  /**
   * M15: explicit evidence failures (malformed JSON line, non-integer or negative counter, cached > input, reasoning >
   * output, unsafe sum, missing ids where required). Any error makes the run UNVERIFIED: zero is never a silent default.
   */
  errors: string[];
  ok: boolean;
}

const zero = (): ProviderUsage => ({
  inputTokens: 0,
  cachedInputTokens: 0,
  cacheWriteInputTokens: 0,
  outputTokens: 0,
  reasoningOutputTokens: 0,
});

/** Reads a counter; absent is 0, anything present but not a non-negative safe integer is an error. */
function n(v: unknown, field: string, errors: string[]): number {
  if (v === undefined || v === null) return 0;
  if (typeof v === "number" && Number.isSafeInteger(v) && v >= 0) return v;
  errors.push(`invalid counter ${field}: ${JSON.stringify(v)}`);
  return 0;
}

/** A3-11: checked accumulation — an aggregate outside the safe-integer range is an error, never a silent float. */
function add(a: ProviderUsage, b: ProviderUsage, errors: string[]): ProviderUsage {
  const out = {
    inputTokens: a.inputTokens + b.inputTokens,
    cachedInputTokens: a.cachedInputTokens + b.cachedInputTokens,
    cacheWriteInputTokens: a.cacheWriteInputTokens + b.cacheWriteInputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    reasoningOutputTokens: a.reasoningOutputTokens + b.reasoningOutputTokens,
  };
  const total = out.inputTokens + out.cachedInputTokens + out.cacheWriteInputTokens + out.outputTokens;
  if (Object.values(out).some((v) => !Number.isSafeInteger(v)) || !Number.isSafeInteger(total))
    errors.push("aggregate usage exceeds the safe-integer range");
  return out;
}

/** A3-11: a stream with no usage-bearing event is a parse failure, not a legitimate zero-usage session. */
function requireUsage(seen: number, errors: string[], what: string): void {
  if (seen === 0) errors.push(`no usage-bearing ${what} events: the log is empty or not this provider's format`);
}

function jsonLines(lines: string | readonly string[], errors: string[]): Record<string, unknown>[] {
  const all = typeof lines === "string" ? lines.split("\n") : lines;
  const out: Record<string, unknown>[] = [];
  for (const raw of all) {
    const t = raw.trim();
    if (!t.startsWith("{")) continue; // banners and blank lines are not events
    try {
      const v = JSON.parse(t) as unknown;
      if (v && typeof v === "object" && !Array.isArray(v)) out.push(v as Record<string, unknown>);
      else errors.push("event line is not a JSON object");
    } catch {
      errors.push(`malformed JSON event line: ${t.slice(0, 60)}`);
    }
  }
  return out;
}

function checkUsage(u: ProviderUsage, errors: string[], where: string): ProviderUsage {
  if (u.reasoningOutputTokens > u.outputTokens) errors.push(`${where}: reasoning tokens exceed output tokens`);
  const total = u.inputTokens + u.cachedInputTokens + u.cacheWriteInputTokens + u.outputTokens;
  if (!Number.isSafeInteger(total)) errors.push(`${where}: unsafe token sum`);
  return u;
}

function finish<T extends { errors: string[] }>(r: T): T & { ok: boolean } {
  return { ...r, ok: r.errors.length === 0 };
}

/** Anthropic usage object -> canonical. OBSERVED fields: input_tokens, cache_creation_input_tokens, cache_read_input_tokens, output_tokens, output_tokens_details.thinking_tokens. */
export function claudeUsage(u: Record<string, unknown> | undefined, errors: string[] = []): ProviderUsage {
  if (!u) return zero();
  const details = (u.output_tokens_details ?? {}) as Record<string, unknown>;
  return checkUsage(
    {
      inputTokens: n(u.input_tokens, "input_tokens", errors),
      cachedInputTokens: n(u.cache_read_input_tokens, "cache_read_input_tokens", errors),
      cacheWriteInputTokens: n(u.cache_creation_input_tokens, "cache_creation_input_tokens", errors),
      outputTokens: n(u.output_tokens, "output_tokens", errors),
      reasoningOutputTokens: n(details.thinking_tokens, "thinking_tokens", errors),
    },
    errors,
    "claude usage",
  );
}

/** OpenAI/Codex usage object -> canonical. OBSERVED: input_tokens INCLUDES cached_input_tokens (cached > input is an error). */
export function codexUsage(u: Record<string, unknown> | undefined, errors: string[] = []): ProviderUsage {
  if (!u) return zero();
  const input = n(u.input_tokens, "input_tokens", errors);
  const cachedRaw = n(u.cached_input_tokens, "cached_input_tokens", errors);
  if (cachedRaw > input) errors.push("codex usage: cached_input_tokens exceeds input_tokens");
  const cached = Math.min(cachedRaw, input);
  return checkUsage(
    {
      inputTokens: input - cached,
      cachedInputTokens: cached,
      cacheWriteInputTokens: n(u.cache_write_input_tokens, "cache_write_input_tokens", errors),
      outputTokens: n(u.output_tokens, "output_tokens", errors),
      reasoningOutputTokens: n(u.reasoning_output_tokens, "reasoning_output_tokens", errors),
    },
    errors,
    "codex usage",
  );
}

/**
 * `claude -p --output-format stream-json --verbose`: sums per-message usage of `assistant` events deduplicated by
 * message.id (last one wins). The `result` event's usage is returned separately as the cross-check source.
 */
export function parseClaudeStream(lines: string | readonly string[]): AdapterResult & { resultUsage: ProviderUsage | null } {
  const errors: string[] = [];
  const byId = new Map<string, ProviderUsage>();
  const models = new Set<string>();
  let resultUsage: ProviderUsage | null = null;
  let subagentEvents = 0;
  let unknownEvents = 0;
  let reasoningObserved: string | null = null;
  for (const ev of jsonLines(lines, errors)) {
    if (typeof ev.effort === "string") reasoningObserved = ev.effort;
    if (ev.type === "assistant") {
      const msg = (ev.message ?? {}) as Record<string, unknown>;
      const id = typeof msg.id === "string" ? msg.id : null;
      if (typeof msg.model === "string") models.add(msg.model);
      if (ev.parent_tool_use_id != null) subagentEvents++;
      if (id) byId.set(id, claudeUsage(msg.usage as Record<string, unknown> | undefined, errors));
      else errors.push("assistant event without message.id (usage cannot be deduplicated)");
    } else if (ev.type === "result") {
      resultUsage = claudeUsage(ev.usage as Record<string, unknown> | undefined, errors);
    } else if (ev.type !== "system" && ev.type !== "user" && ev.type !== "stream_event") {
      unknownEvents++;
    }
  }
  let usage = zero();
  for (const u of byId.values()) usage = add(usage, u, errors);
  requireUsage(byId.size + (resultUsage ? 1 : 0), errors, "assistant/result");
  if (subagentEvents > 0) errors.push(`${subagentEvents} sub-agent events (outside the context manifest)`);
  return finish({
    usage,
    eventIds: [...byId.keys()].sort(),
    modelsReported: [...models].sort(),
    reasoningObserved,
    subagentEvents,
    unknownEvents,
    resultUsage,
    errors,
  });
}

/** `codex exec --json`: sums `turn.completed` usage (UNVERIFIED shape; the repo's fake codex emits it). No response ids. */
export function parseCodexExecStream(lines: string | readonly string[]): AdapterResult {
  const errors: string[] = [];
  let usage = zero();
  let unknownEvents = 0;
  let turns = 0;
  for (const ev of jsonLines(lines, errors)) {
    if (ev.type === "turn.completed") {
      turns++;
      usage = add(usage, codexUsage(ev.usage as Record<string, unknown> | undefined, errors), errors);
    } else if (typeof ev.type !== "string") unknownEvents++;
  }
  requireUsage(turns, errors, "turn.completed");
  // The exec stream carries no response ids: it is a cross-check source only, never the authoritative one (M15).
  return finish({ usage, eventIds: [], modelsReported: [], reasoningObserved: null, subagentEvents: 0, unknownEvents, errors });
}

/**
 * Codex session rollout (~/.codex/sessions/.../rollout-*.jsonl; OBSERVED): `token_usage_record` payloads carry
 * `response_id` and per-response `usage`; `token_count` payloads carry cumulative totals (ignored here, used only as a
 * cross-check by callers). Dedup by response_id.
 */
export function parseCodexRollout(lines: string | readonly string[]): AdapterResult & { cumulative: ProviderUsage | null } {
  const errors: string[] = [];
  const byId = new Map<string, ProviderUsage>();
  let cumulative: ProviderUsage | null = null;
  const threads = new Set<string>();
  let reasoningObserved: string | null = null;
  const models = new Set<string>();
  for (const ev of jsonLines(lines, errors)) {
    const payload = (ev.payload ?? {}) as Record<string, unknown>;
    if (typeof payload.thread_id === "string") threads.add(payload.thread_id);
    if (ev.type === "token_usage_record") {
      // A3-11: a usage-bearing record without its response id cannot be deduplicated: an error, never skipped.
      if (typeof payload.response_id === "string" && payload.response_id.length > 0)
        byId.set(payload.response_id, codexUsage(payload.usage as Record<string, unknown> | undefined, errors));
      else errors.push("token_usage_record without response_id (usage cannot be deduplicated)");
    } else if (ev.type === "event_msg" && payload.type === "token_count") {
      const info = (payload.info ?? {}) as Record<string, unknown>;
      cumulative = codexUsage(info.total_token_usage as Record<string, unknown> | undefined, errors);
    } else if (ev.type === "turn_context") {
      if (typeof payload.effort === "string") reasoningObserved = payload.effort;
      if (typeof payload.model === "string") models.add(payload.model);
    }
  }
  let usage = zero();
  for (const u of byId.values()) usage = add(usage, u, errors);
  requireUsage(byId.size, errors, "token_usage_record");
  // Sub-agent detection for codex is not demonstrated (M15): the policy forbids `ultra`; a rollout with more than
  // one thread id is reported as an error rather than counted.
  if (threads.size > 1) errors.push(`rollout contains ${threads.size} threads (possible sub-agents)`);
  return finish({
    usage,
    eventIds: [...byId.keys()].sort(),
    modelsReported: [...models].sort(),
    reasoningObserved,
    subagentEvents: Math.max(0, threads.size - 1),
    unknownEvents: 0,
    cumulative,
    errors,
  });
}

/**
 * Relative mismatch between two usage reports, in basis points of the larger total (0 when both are zero). A telemetry
 * integrity signal only (D49; review 05 obsolete item 4): never an input to a payout or a qualification.
 */
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
