# USAGE-PROOF (DRAFT) — what we can and cannot know about agent usage

Contracts: `UsageReceipt`, `RunLog`, `ProviderUsage` (`protocol/entities.ts`), adapters (`protocol/usage.ts`), `UsageProofPolicy` (`usage-proof-policy.v1.json`). Decisions: D1, D24, D27; Astra-01 items 1 and 6.

## 1. The honest position

wOS launches the contributor's own `claude` and `codex` CLIs on the contributor's machine, on the contributor's subscription (D1, D24). The client, the CLI binaries, the machine and the network path are all contributor-controlled. Therefore:

- **Usage is ATTESTED at best.** A modified client can report any numbers and can fabricate a consistent transcript and run log. Signing with the device key makes the claim attributable to an account; it does not make it true.
- **No check inside the client is proof.** Asking the agent "was this tampered with?" is answered by whatever runs; a fake `claude` script says "no". Binary hashes and integrity checks are speed bumps, not evidence.
- **No provider issues signed usage for subscriptions** to our knowledge. Provider response ids (`msg_…`, `req_…`, `resp_…`) are real server identifiers, but wOS cannot query them without the contributor's credentials, which it never touches.
- **What protects the protocol** is not measurement but economics and review: tight caps (the most a lie can gain), exact-total run logs, deterministic anomaly ranking, disputes with bounties, sampled audits, payout canaries, the pattern lookback, offsets, and — at mainnet — the fail-closed eligibility decision (F1).

Future evidence source (listed so it is not forgotten): ask Anthropic and OpenAI for signed usage or response attestations usable by third parties with the user's consent. If they ever exist, they become `VERIFIED` and the policy can prefer them.

## 2. What each CLI reports (checked locally, 2026-09-29, no model calls)

Versions on the founder's machine: `claude` 2.1.285, `codex-cli` 0.155.0.

### 2.1 claude (`claude -p --output-format stream-json --verbose`)

- Flags verified in `claude --help`: `--output-format stream-json`, `--verbose`, `--json-schema`, `--effort <low|medium|high|xhigh|max>`, `--max-budget-usd <amount>` ("maximum dollar amount to spend on API calls", print mode only; whether it applies under subscription auth is UNVERIFIED), `--no-session-persistence`, `--session-id`, `--include-partial-messages`.
- **Per-message usage (OBSERVED in local Claude Code session files):** assistant messages carry `message.id` (`msg_…`), `message.model` (e.g. `claude-opus-5`), `requestId` (`req_…`), and `message.usage` with `input_tokens` (uncached), `cache_creation_input_tokens`, `cache_read_input_tokens`, `output_tokens`, `output_tokens_details.thinking_tokens`, `cache_creation.{ephemeral_5m_input_tokens, ephemeral_1h_input_tokens}`, `service_tier`, `speed`. The transcript entries also carry `effort` (the requested effort as recorded by the CLI).
- **Stream events:** the stream-json `assistant` events embed the same `message` object; the final `result` event carries run totals (`usage`) and, per the Agent SDK documentation, `total_cost_usd`, `modelUsage` per model, `num_turns`, `duration_ms`. The exact stream-json shapes at 2.1.285 are UNVERIFIED until the fixture suite records a real run.
- **Semantics used:** thinking tokens are inside `output_tokens` (billing semantics; `reasoningOutputTokens` is informational). A streamed message can appear several times with the same `message.id`; the adapter keeps the last usage per id. Events with `parent_tool_use_id` are sub-agent usage and fail the run (sub-agents run outside the context manifest).

### 2.2 codex (`codex exec --json`)

- Flags verified in `codex exec --help`: `--json` ("print events to stdout as JSONL"), `--output-schema`, `-o/--output-last-message`, `-m/--model`, `-c key=value` (reasoning via `model_reasoning_effort`), `--sandbox`, `--ephemeral`, `--ignore-user-config`, `--ignore-rules`.
- **Session rollout (OBSERVED in `~/.codex/sessions/…/rollout-*.jsonl`):** `token_usage_record` payloads carry `response_id` (`resp_…`), `turn_id`, and per-response `usage` with `input_tokens`, `cached_input_tokens`, `cache_write_input_tokens`, `output_tokens`, `reasoning_output_tokens`, `total_tokens` (= input + output, so **input includes cached**). `event_msg`/`token_count` payloads carry cumulative `total_token_usage` and `last_token_usage`, `model_context_window`, and `rate_limits` including `plan_type` and `used_percent`. `turn_context` entries carry the model and effort (field names UNVERIFIED for effort).
- **`--json` stream:** `turn.completed` events with `usage` (the repo's fake codex emits `{input_tokens, output_tokens}`; the real shape, including `cached_input_tokens`, is UNVERIFIED until recorded). No per-response ids in the exec stream as far as we know.
- **Semantics used:** canonical uncached input = `input_tokens − cached_input_tokens`. `--ephemeral` disables the rollout file; wOS therefore does **not** pass `--ephemeral` for build runs, and reads the rollout of the run's own session as the cross-check source. Cumulative counters are never summed (only per-response records, deduplicated by `response_id`).

## 3. Verification levels (never upgraded in any UI)

| Level | Meaning | V1 sources | Reward (devnet / mainnet) |
|---|---|---|---|
| VERIFIED | provider-signed or provider-queried by wOS | none exist for subscription CLIs | yes / F1 |
| ATTESTED | reported by the official client from the CLI's own usage fields, device-signed, every plausibility check passed, run log totals equal | claude stream + transcript; codex exec stream + rollout | yes / fail closed until F1 |
| ESTIMATED | computed by the server from what it can see (manifest size, output size, turns) | server estimator | no (never `attested_usage` weight) |
| UNVERIFIED | missing, malformed, inconsistent, sub-agent usage, model mismatch | — | no |

The DB refuses an `attested_usage` receipt resting on ESTIMATED or UNVERIFIED usage (`check_contribution_receipt`). The receipt stores its `lowestVerificationLevel` and `evidenceClass` permanently.

## 3b. Adapters fail loudly (M15)

The adapters (`protocol/usage.ts`) return `errors[]` and `ok`. Malformed JSON lines, non-integer or negative counters, cached input above total input (codex), reasoning above output, unsafe sums, claude assistant events without a message id, sub-agent events, and codex rollouts with more than one thread id are all reported; any error makes the run UNVERIFIED. Zero is never a silent default for bad evidence. v3 (Astra-03 M11): aggregates are accumulated with a check (a sum outside the safe-integer range is an error even when every event is safe), a codex `token_usage_record` without a `response_id` is an error rather than skipped, and a stream with no usage-bearing event at all (empty, or another provider's format) is a parse failure — distinct from a real session whose usage events report zero. In the database, attested ACU must come from usage receipts of the contribution's own lease at the epoch's pinned oracle, each usage receipt backs at most one contribution, a run without a log counts 50% (applied by the DB) and a run whose log totals do not match is refused (Astra-03 H5). The codex exec stream has no response ids and is a cross-check source only; the rollout (response-id deduplicated) is authoritative. Pinned CLI versions without recorded fixtures stay ineligible until a founder-run capture establishes their shapes.

## 4. Canonical accounting (Astra-01 item 6)

- **Categories** (exclusive): uncached input, cache read, cache write, output (reasoning included). Integers; no floats anywhere.
- **Event identity:** one usage event per provider response id; duplicates within a run keep the last report; across runs the hashed id is unique (`usage_event_ids` primary key), so a replayed transcript collides.
- **Retries:** a provider call that returned no usage counts nothing; a retried call has its own response id.
- **Tools:** tool execution consumes no tokens; tool results are input to the next call and counted there.
- **Child agents:** forbidden by policy (no Task tool for claude, `ultra` forbidden for codex); any sub-agent usage makes the run UNVERIFIED.
- **Frozen rates:** the oracle version in the run-policy snapshot at lease issue.
- **Reservation:** each lease reserves the subject's remaining cap; runs on one lease are sequential; concurrent leases of one contributor are on different subjects.
- **Overshoot:** the response that crosses the reservation is not eligible (clipped).

## 5. Run logs (D27)

Every AgentRun whose usage carries weight submits a `RunLog`:

- per turn: index, start/end timestamps, hashed provider response id, the four usage numbers, tool calls (tool name, repo-relative path or null, sha256 of the arguments, exit code), sha256 of the transcript chunk; repair loops with reason and turn range;
- **scrubbed by construction:** no prompt or response text, no tool arguments, no environment values, no paths outside the worktree, secret patterns (SECURITY.md) removed from anything textual; the scrubber version is recorded;
- **bounds:** ≤ 1 MiB, ≤ 2,000 turns, ≤ 200 tool calls per turn;
- **retention (M17):** the commitment (`run_log_commitments`: log hash, turns, repairs, tool calls, totals match, expiry) is kept forever; the body (`run_log_bodies`) is deleted after 365 days — the DB refuses deletion before expiry and any edit; raw transcripts stay on the contributor's machine and may be requested by an audit by chunk hash (5% of receipts, 60-day retention obligation on the contributor);
- **privacy:** logs are private until the run's epoch finalizes, then public (RLS `published_or_own`).

**Mismatch means:** no log at all → bare numbers, weighted 50%; a log present but with per-turn totals ≠ usage receipt → the run is UNVERIFIED (fail closed, 0); impossible timings (output faster than 400 tokens/s sustained, or total throughput above 200,000 tokens/s) → `impossible_throughput` (high); log vs diff implausible (many turns and tokens, tiny diff) → shown to auditors, not automatic. Log-consistent ATTESTED usage ranks above bare numbers: a run with no consistent log is weighted at 50%.

## 6. Plausibility checks at receipt time

| Check | Fails when | Effect |
|---|---|---|
| exact totals | run log totals ≠ receipt | UNVERIFIED |
| source cross-check | primary vs cross-check source differ by > 2% in any category | `usage_fields_inconsistent` (medium) |
| model match | reported model ≠ the capability class's qualified model id (aliases mapped) | UNVERIFIED + `model_mismatch` (high) |
| effort | observed effort (when reported) ≠ required | UNVERIFIED; unsupported settings block the run before it starts |
| throughput | above the policy limits | `impossible_throughput` (high) |
| duplicate ids | any hashed response id seen before | receipt refused + `duplicate_provider_ids` (high) |
| sub-agents | any sub-agent event | UNVERIFIED |
| cap | weight above cap | clipped (not a signal) |

## 7. Detection after the fact

Peer baselines per comparable key (task kind, capability class, model, size points) feed the anomaly metrics (REWARD-PROTOCOL §9). Random third-contributor audits and payout canaries (REVIEW-PROTOCOL changes in HUMAN-REVIEW.md §7; ABUSE-MODEL §5) and disputes (PROTOCOL §4.4) act on the published explanations. A re-run of a build from the same manifest can judge output and plausibility; it cannot prove what an earlier run consumed (Astra-01 item 5), so V1 does no build re-runs (`randomRerunBp: 0`).
