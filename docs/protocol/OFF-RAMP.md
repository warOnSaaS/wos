# OFF-RAMP (DRAFT) — if WOS fails, the record survives

Decision D35. Contracts: `SettlementAdapter` (interface), `SettlementAdapterKind`, `SettlementAdapterEvent`, `MigrationSnapshot`, `OFFRAMP_DISCLOSURE` (`protocol/governance.ts`). DB: `settlement_adapter_events`, `migration_snapshots`.

## 1. Token-agnostic accounting

The canonical record is off chain: receipts, allocations, claim leaves, admin actions (hash-chained) and the epoch roots. WOS on Solana is one **settlement adapter**. Adapters implement `settle(leaf)`, `status(epoch, leaf)`, `reconcile(epoch)`; they are idempotent by (epoch, leaf index) and never the source of truth.

| Adapter | Settles a final leaf by | When |
|---|---|---|
| `solana_wos` | an SPL Token-2022 transfer (V1 devnet: claim-triggered push) | normal operation |
| `in_app_credits` | a non-transferable credit balance derived from the same allocations (the D3 model) | chosen fallback |
| `paused_accrual` | nothing: allocations keep accruing as claimable entitlements | during a pause |
| `successor` | a future token or chain defined by a migration | after a migration |

## 2. Triggers and who acts

| Trigger | Immediate action | Who | Then |
|---|---|---|---|
| security incident / exploit | pause settlement (`paused_accrual`) | emergency multisig (3-of-5; devnet 2-of-3) | expires ≤ 14 days; governance must ratify (simple majority) or it resumes |
| chain failure or deprecation | pause | emergency multisig | adapter switch or migration by structural vote |
| legal or regulatory order | pause (or as the order requires) | emergency multisig + founder | legal checkpoint; structural vote |
| program bug | pause | emergency multisig | fix or migrate by structural vote |
| governance decision | adapter switch / migration | structural-tier vote + timelock | — |

**A falling price is never a trigger** (the DB trigger list has no such value). Accrual continues through every pause: epochs keep closing, allocations keep being proposed and finalized; only settlement stops.

## 3. Migration procedure

1. **Declare** the snapshot epoch E (structural vote, or an emergency declaration ratified later).
2. **Freeze** settlement at the end of E. Publish a `MigrationSnapshot`: admin-actions head, every epoch's allocations root, a balances root with, per beneficiary, settled-so-far and final-but-unclaimed amounts, and the total unclaimed.
3. **Map deterministically**: default rule "1:1 base units of unclaimed entitlements under the new adapter". Any other rule (e.g. also mirroring settled balances onto a successor mint) must be published before the snapshot and passed at the structural tier. The mapping rule itself makes no one better or worse off.
4. **Verify**: anyone recomputes the snapshot from public receipts and allocations and checks it against the anchored roots.
5. **Claim window**: unclaimed entitlements remain claimable under the new mechanism for 365 days (policy data), then follow the ordinary unbound-carry rule.
6. Governance weight continues on contribution weight (GOVERNANCE §6).

## 4. Authorities

No retained mint authority is needed (TOKEN-AUTHORITIES §4): migration uses a new mint or credits against the snapshot. Evaluated and rejected: keeping mint authority in a timelocked multisig "for migrations" — it is an unlimited mint held by people.

## 5. Independence

The open-source code, wOS Cloud, contribution receipts, reputation data and governance contribution weight do not depend on WOS's value or existence. Self-hosting and rewards are separate; rewards are never DRM (S-41).

## 6. Disclosure and drill

Disclosure on every token surface (web, Desktop, CLI claim output): **"WOS may become worthless or be replaced. Your verified contribution records are permanent, and they are what any future settlement is based on."** (`OFFRAMP_DISCLOSURE`).

The devnet E2E test includes the drill (MAINNET-READINESS G-17): pause (auto-expiry checked) → an epoch accrues under `paused_accrual` → migrate to `in_app_credits` from a snapshot → every claimant's credits equal their unclaimed entitlements → reconciliation passes.
