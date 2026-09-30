# SUPERSESSION (DRAFT) — which old rules survive

Astra-01 asked for a table so an implementation never has to guess. "Kept" rules stay in force; "replaced" rules are superseded by the named document when the protocol is activated; "removed" rules end. Until activation, the old documents describe what is deployed.

## 1. REWARD-PROTOCOL v1 (`docs/architecture/REWARD-PROTOCOL.md`)

| v1 rule | Status | Replacement |
|---|---|---|
| "WOS tokens are in-app credits with no cash value" | **replaced** (D18) | real Solana token; devnet "has no monetary value"; OFF-RAMP disclosure |
| One unit, tokens = points, score = lifetime earned | replaced | WOS allocations; score = lifetime allocated WOS (live epochs only), leaderboard opt-in kept |
| One append-only ledger, derived balances | **kept** (principle) | receipts/allocations/leaves/settlements are append-only; `ledger_entries` stays for the never-activated `rewards.v1` credits and receives no protocol rows |
| Reward accepted useful output only | kept | per-type acceptance events (PROTOCOL §3) |
| A unit is paid once (D10) | kept | shared dedup keys; per-(target, feature) pools |
| Rewards belong to the account | **modified** (D38) | the beneficiary may be an organization; the contributor stays accountable |
| Not transferable, no redemption | replaced | transferability decided at the legal checkpoint (F8) |
| Ledger kinds award/release/void/clawback/debit/adjustment | replaced | allocations, settlement records, offsets, clips, admin actions |
| Fixed amounts (20 per size point, 4 per review size point, 40/20 per document review, pools 1000/200, ruling 30) | **removed** | usage-weighted and ACU-equivalent weights inside epoch slices |
| Upheld finding bonus 5 (max 5) | replaced | +10% of the reviewer's own capped ACU per upheld finding (max 5) |
| Security ladder 25/100/300/1000 credits | **removed** as fixed amounts (Astra-01 item 4) | the same numbers as ACU-equivalent weights, paid from the security reserve, ≤ 25% per payout |
| Feature completion pool = 10% of implementation tokens | replaced | 15% completion accrual per epoch, utilisation-scaled, per-(target, feature) pools |
| Application completion pool 10,000 | replaced | application pools (1/3 of completion accrual) |
| 14-day hold, release sweeper | replaced | CALCULATING (48 h) + PROPOSED challenge (48 h) + finalization |
| Void before release, clawback after | replaced | exclusion before finalization; after it: holdback confiscation, unclaimed entitlements, offsets (no on-chain reversal, D39, D40) |
| Bootstrap-self awards held until re-review | **removed** (D23) | PROVISIONAL receipts, test epochs, ratification |
| Maintainer adjustments with memo | replaced | AdminActions (hash-chained, two-person where listed) |
| Schedule versions, never recomputed | kept | policy versions, forward-only (D33) |
| The eight Wave 2a rulings (§8) | kept for `packages/rewards` v1 code; superseded by the engine for protocol epochs | — |

## 2. TOKEN-DISTRIBUTION (`docs/architecture/TOKEN-DISTRIBUTION.md`)

| Rule | Status | Replacement |
|---|---|---|
| "Never deploy, mint or announce a transferable token" in V1 | **replaced** (A5, D18) | devnet WOS in V1; mainnet behind MAINNET-READINESS |
| Never let accounts send tokens to each other | replaced | devnet transferable; mainnet F8 |
| Never sell tokens or accept payment | **kept, strengthened** (A5) | wOS never sells, runs no presale/ICO, provides no liquidity, promotes no price |
| No investment language, no conversion ratio | **kept** (A1) | "contribution, receipt, allocation"; no ratio from devnet to mainnet |
| Never store wallet addresses | replaced | wallet bindings (signed, per cluster, public only as needed for transparency) |
| Disclaimer wherever tokens appear | replaced | devnet no-value notice + OFF-RAMP disclosure |
| Activation path: legal review, governance, snapshot, eligibility, opt-in claim, flag | **modified** | one legal checkpoint (A8); governance per GOVERNANCE.md; claims per SOLANA-ARCHITECTURE |
| Allocation principles: earned not bought, contributors first, reversals respected, transparency, no retroactive changes | kept | TOKENOMICS-REVIEW; no founder or investor bucket at all |

## 3. D3 and every statement that must change (D18)

Code and docs (architect-owned, change with contracts 6.0.0 when the protocol is activated):
- `packages/contracts/src/version.ts` `TOKEN_DISCLAIMER`; `packages/contracts/src/rewards.ts` header; `packages/contracts/src/api.ts` leaderboard `disclaimer` literal; tests `packages/contracts/test/policy.test.ts`, `packages/rewards/test/leaderboard.test.ts`, `services/control-plane/test/mail-and-profile.test.ts`, `apps/desktop/test/renderer.test.tsx`, `apps/desktop/test/support.ts`.
- `packages/rewards/src/index.ts`, `packages/rewards/src/balances.ts` headers; `services/control-plane/src/handlers/public.ts` (leaderboard disclaimer); `apps/desktop/src/main/start.ts` (`tokenDisclaimer`).
- `docs/DECISIONS.md` D3 (marked superseded by D18); `docs/architecture/ARCHITECTURE.md` §8 conventions; `REWARD-PROTOCOL.md`; `TOKEN-DISTRIBUTION.md`; `SECURITY.md` S-24; `GAPS.md` G-11, G-31; `WORKSTREAMS.md` web "Honours" line; `docs/roadmap/waronsaas.roadmap.json` (ledger summary "in-app credits").

Website (web workstream; the architect does not edit `apps/web`): `apps/web/lib/site.ts` `TOKEN_DISCLAIMER`; `apps/web/lib/content.ts` (5 statements incl. "not cryptocurrency", FAQ "Are WOS tokens cryptocurrency? No"); `apps/web/lib/briefing.ts`; `apps/web/lib/llms.ts` (2); `apps/web/components/Footer.tsx`; `apps/web/app/leaderboard/page.tsx`; `apps/web/app/tokens/page.tsx`; `apps/web/app/download/page.tsx`; `apps/web/app/targets/[slug]/page.tsx`; `apps/web/SITE-SYNC.md`; `apps/web/generated/waronsaas.roadmap.json`.

New wording (proposal): devnet — "WOS on devnet is a test token with no monetary value." Everywhere tokens appear — the OFF-RAMP disclosure. Never "earn", "pay", "investment", "price".

## 3b. Wording superseded inside this design (Astra-02 pass)

- "No silent confiscation" → **"no SILENT or ARBITRARY confiscation"** (D39): proven cheating is confiscated from protocol-held amounts after due process; released tokens are never seized.
- "Bounty on the total excess" → bounty on the total **recovered** excess (D41).
- "Stake forfeited only if nothing is clipped" → stake forfeited **per rejected item** (D43).
- "One confirmed row makes settlement exactly once" → persisted signed transactions, one active attempt, historical resolution, finalized confirmation (H3).
- "Expected gain ≈ 0 with the pattern lookback" → withdrawn; see TOKENOMICS-SIMULATION A2.

## 4. REVIEW-PROTOCOL, AGENT-POLICY, SECURITY

Listed in HUMAN-REVIEW.md §8 (review), POLICIES §4 (capability classes over the brand lists, which remain the argv source), ABUSE-MODEL §1 (S-24).
