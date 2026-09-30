# WORKSTREAMS-PROTOCOL (DRAFT) — implementation plan after the Astra review

Nothing here starts before the review findings are resolved (REVIEW-PACKET.md) and the founder answers F1–F13 (ADR-001 §6) or accepts the defaults. Rules of WORKSTREAMS.md §1 apply (one worktree per workstream, contracts frozen, blockers for contract changes, no model calls in tests).

## 1. Contracts first (architect, wave P0)

Promote the drafts: `@waronsaas/contracts/protocol` → contracts **6.0.0** (MAJOR: `TaskKind` + `payout_audit`, `AgentRole` + `payout_auditor`, `TOKEN_DISCLAIMER` replaced, new events and routes in `api.ts`/`events.ts`), migration 0007 finalized (renumbered if needed), policy data activated as `draft → active` only for devnet. Owned paths: `packages/contracts/**`, `packages/db/migrations/**`, `docs/**`.

## 2. Workstreams

| Workstream | Owns | Builds | Needs Rust/Solana tooling? |
|---|---|---|---|
| **protocol-engine** | `packages/rewards/**` (new `src/protocol/*`), control-plane consumers `services/control-plane/src/protocol/**` | receipt issuance on merge (per acceptance table), epoch scheduler and transitions, manifest freeze, engine run + explanations + anomaly metrics, dispute gates and settlements, offsets, clips, pool accrual/payout, Genesis computation, policy activation + preview endpoint, governance tally (off chain) | no |
| **usage-proof** | `packages/orchestrator/src/usage/**`, `packages/verification` (plausibility) | provider adapters (from `protocol/usage.ts`), run-log builder + scrubber, cap stop, fixture suite recorded from real CLIs (one founder-run capture per CLI version, stored as fixtures, never in CI), response-id hashing | no |
| **protocol-review** | control-plane review routes, `packages/context-engine` (payout_auditor role) | ReviewPolicy evaluator (classes, rules, independence, related accounts), human review routes + context builder, qualification admin, eval cases, review audits, payout-audit packets with focus, duty assignment at claim, payout canary perturbator (model-free) | no |
| **protocol-chain** | `packages/settlement/**` (new), `scripts/solana/**` | `SettlementAdapter` implementations (`solana_wos` devnet push with blockhash-expiry retries, `in_app_credits`, `paused_accrual`), mint creation script (Token-2022 + metadata, no freeze), Memo anchoring, reconciliation, off-ramp migration tool | **yes, but only the Solana CLI and `@solana/web3.js`/`@solana/spl-token` (TypeScript)** — no Rust, no Anchor. `solana-test-validator` (from the Solana CLI release) for local E2E. Rust/Anchor only if mainnet picks M2 or a distributor we must build (avoidable) |
| **wallet** | web `app/wallet/**` (web workstream), Desktop openExternal allowlist, CLI `wos wallet` | binding with Wallet Standard, CLI `solana sign-offchain-message` flow, org wallets, cooldown + e-mail confirmation | Solana CLI on the user's side only |
| **protocol-ux** | `apps/web` (web workstream), `apps/desktop` Build app, `apps/cli` | epoch view, allocation permalinks, anomaly-ranked challenge list, dispute flow, claim flow with duty, admin panels, disclosure copy (SUPERSESSION §3) | no |
| **orgs** | control-plane org routes | sponsorship requests/approvals, beneficiary split on receipts, related-account checks in assignment | no |

## 3. Waves

- **P0** contracts 6.0.0 + migration (architect).
- **P1** (parallel): usage-proof, protocol-engine (receipts, epochs, engine, explanations, test epochs), protocol-review (ReviewPolicy evaluator, human review, bootstrap merge + provisional receipts), protocol-chain (devnet mint, push adapter, memo, reconciliation), wallet.
- **P2**: disputes + gates + duty + canaries + anomaly UI (protocol-review, protocol-engine, protocol-ux), orgs, governance rehearsal (off chain), off-ramp adapters and drill.
- **P3**: devnet E2E proof (section 4), 26 devnet epochs toward MAINNET-READINESS.

## 4. The devnet E2E test (automated)

`tests/e2e/proof-of-contribution.test.ts`, CI job with Postgres + `solana-test-validator` (or devnet behind a flag), fake `claude`/`codex` binaries that emit recorded usage fixtures (no model calls):

1. two contributors + one authorized human + founder; wallets bound (keypairs generated in the test);
2. lease → fake Opus build with a usage fixture → run log → verification → fake Astra/Fable reviews by the other contributors → human PASS → qualify → PR (GitHub App mocked at the HTTP boundary as today) → merge webhook → ACTIVE receipt;
3. founder's own ABU merged under `bootstrap_merge` → PROVISIONAL receipt; a test epoch counts it, the live epoch does not; a ratification quorum RATIFIES it;
4. epoch close → CALCULATING (clock injected) → PROPOSED with explanations and anomaly metrics → one dispute on one allocation → reply → gate CLIPS it → bounty → FINALIZED → Memo anchor → DISTRIBUTABLE;
5. `wos claim`: duty audit offered and run (fake auditor), one payout canary answered "plausible" → signal raised and credit lost; push transfers confirmed; a forced expired-blockhash retry settles exactly once;
6. reconciliation → CLOSED; profile, opt-in leaderboard, Sniper List progress and dependent ABU unlock asserted;
6b. **proven-cheating drill** (D39): an inflated receipt is disputed, clipped, then a pattern finding leads to notice, reply, appeal and confiscation of holdback, pending and unclaimed amounts; exclusion; a recovered-only bounty; the engine's conservation check passes;
7. **off-ramp drill**: pause (expiry checked) → next epoch accrues under `paused_accrual` → migration snapshot → `in_app_credits` → claims reconcile to the snapshot;
8. the engine re-computes every allocation from public data and the roots match the Memo.

## 5. Claim and dispute UX (acceptance criteria for protocol-ux)

**Claim (Desktop Build app, CLI `wos claim`, web read-only):**
0. Before the first contribution or wallet binding: the **publication disclosure** screen (what becomes public, when, for how long, who is responsible); accepting it is recorded (D47).
1. "Epoch 18 — PROPOSED — challenge window closes 2026-10-06 14:00 UTC". Your allocations with the explanation sentence ("14,023 WOS = 312,004 attested tokens on claude-opus-5-5 → 4.1 ACU × 3,420 WOS/ACU"), labels ATTESTED/ESTIMATED as stored, never upgraded.
1b. Each allocation shows **released now / held back until epoch 31** (D40) and, when relevant, `unaudited` (D42) or `released after dispute (withheld N epochs)` (D43).
2. After FINALIZED: **Claim**. The client shows "Claiming runs up to 3 payout audits on your subscription (Astra or Fable as assigned)". It runs them sealed (progress, tokens used), submits verdicts, then requests settlement and shows the transaction signatures. Unmet duty: "withheld, not lost (7 epochs left)".
3. Disclosures: devnet no-value notice; OFF-RAMP disclosure.

**Challenge list (all surfaces):** every allocation of the epoch, sorted by `rankScore`, with pseudonym, beneficiary org, model, usage (after finalization only the explanation shows usage), run-log summary, peer comparison, cap saturation, consistency; per-org concentration; a checkbox per row, **Dispute selected**, and a **Dispute** button per row. Each allocation has a permalink (`/epochs/18/allocations/<id>`).

**Dispute form:** the stake preview is per item (floor 1 WOS) and shows which part is refunded for each valid item (D43); related parties are told they cannot take bounty priority. Per selected allocation a reason (inflated usage, padded repairs, context inflation, misreported model, misattribution, duplicate work, split gaming, other), evidence auto-attached from the anomaly view and editable (run-log turns, diff, peer baseline), optional proposed amount; shared evidence; a note ("shown to auditors as untrusted text"); **stake preview** and **bounty preview**; submit. CLI: `wos dispute <id> [<id>…] --reason inflated_usage --note "…"`, or `--from-file dispute.json`. On submit each allocation shows DISPUTED on its permalink, linked to the dispute; the accused gets a notification and a 24 h **Reply** form; the outcome, verdicts, recovered amount and resulting amount appear on the permalink with an immutable history; either the accused or the priority disputer can **Appeal** once within 72 h. A confiscation (D39) shows its notice, reply window, appeal and executed sources on the receipt and allocation permalinks. Accept is one click and optional (silence accepts).

**Org admin:** sponsorship requests (approve/deny, split), org wallet binding (multisig recommended), org members' receipts and allocations, per-org concentration.

**Admin (maintainer):** reviewer qualifications, batch human-review queue, flagged runs and signals, holds and invalidations (two-person), epoch control, policy proposals with preview, adapter pause/resume, Genesis computation review — every action an AdminAction with reason.

## 6. What needs Rust/Solana tooling, and can it be avoided?

- **V1 devnet: no Rust.** Token-2022 mint creation, transfers, ATAs and Memo are all available from TypeScript (`@solana/spl-token`, `@solana/web3.js`) and the Solana CLI. Squads can be used from its TypeScript SDK or UI.
- **Solana CLI** (for `solana-test-validator`, keypairs, `sign-offchain-message`): needed by protocol-chain and CI; not installed on the founder's machine yet (founder or CI installs; this design pass did not).
- **Rust/Anchor:** only if mainnet chooses M2 (emission controller) or a distributor must be built/rebuilt from source (verifiable builds). Avoidable with M1 + push or an existing audited distributor deployed from a verifiable build (the build step itself needs the Rust toolchain in CI, once).
