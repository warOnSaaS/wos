# REWARD-PROTOCOL

How accepted work earns WOS tokens, and how the ledger works. Part of the wOS constitution.

> WOS tokens are in-app credits with no cash value.

That sentence must appear verbatim wherever tokens appear (D3; `TOKEN_DISCLAIMER` in `packages/contracts/src/version.ts`). Its uppercase "WOS" conflicts with the naming rule; this is G-31 and the D3 wording is kept until the founder decides.

| Source of truth | What it fixes |
|---|---|
| `packages/contracts/src/rewards.ts` | `LedgerEntryKind`, `LedgerBucket`, `RewardCategory`, `LedgerEntryDraft`, `RewardSchedule`, `Balance` |
| `packages/contracts/src/data/reward-schedule.v1.json` | proposed amounts (status `proposal`) |
| `packages/contracts/src/state-machines.ts` | `ContributionMachine` |
| `packages/rewards` | pure rules: `computeLedgerDrafts(event, facts, schedule)`, `allocatePool(total, weights)` |
| `packages/db/migrations/0001_init.sql` | `contributions`, `reward_pools`, `ledger_entries` (sign rules, hash chain, append-only), `v_balances`, `v_leaderboard` |

## 1. Principles

1. One unit (D3): tokens and points are the same thing. The score is lifetime earned tokens.
2. One append-only ledger. Balances are derived by summing, never stored or updated.
3. Reward accepted useful output only. Nothing for opening a PR, claiming a lease or submitting a revision that is never accepted.
4. A unit of work is paid once (D10), not once per app it benefits.
5. Rewards belong to the account (D8), not the GitHub login; the contribution row records the GitHub identity that did the work.
6. Not cryptocurrency, not transferable, no cash value, no redemption. Transferability and redemption stay disabled behind future governance and legal activation (TOKEN-DISTRIBUTION.md).

## 2. Ledger

### Buckets and kinds

| Kind | Bucket | Sign | Required | Meaning |
|---|---|---|---|---|
| `award` | `held` | + | `category`, `release_after` | accepted contribution enters the hold window |
| `release` | `held` and `available` | - held, + available (two rows, same `pair_id`) | `related_entry_id` (the award), `pair_id` | hold window passed |
| `void` | `held` | - | `related_entry_id` | reversed before release |
| `clawback` | `available` | - | `related_entry_id` | reversed after release |
| `debit` | `available` | - | | future spending (none in V1) |
| `adjustment` | either | +/- | maintainer actor, memo >= 10 chars | public correction |

These rules are a CHECK constraint (`ledger_sign_rules`). Zero amounts are never written. Amounts are whole tokens (bigint).

### Derived values (`v_balances`)

- `held` = sum of amounts in the held bucket.
- `available` = sum in the available bucket.
- `score` = sum of `award`, `void`, `clawback` and `adjustment` amounts. Releases net to zero across buckets; debits never lower the score.

The leaderboard (`v_leaderboard`) ranks active, opted-in accounts with a handle and a positive score, by score then account age.

### Integrity

- Append-only: triggers reject UPDATE, DELETE and TRUNCATE for every role; the app role has only SELECT and INSERT.
- Idempotency: `idempotency_key` unique. Format `<rule>:<subject id>:<account id>[:<n>]`, e.g. `award:implementation:<attempt id>:<account id>`, `release:<award id>:held`, `release:<award id>:available`. Replaying an event writes nothing new.
- Hash chain: a BEFORE INSERT trigger takes `pg_advisory_xact_lock(7313371)`, assigns a gapless `entry_no`, sets `prev_hash` to the previous entry's hash (`\x00` for the first), `created_at` to the clock in milliseconds, and `entry_hash = sha256(prev_hash || canonical row text)`. The canonical text is the `|`-joined fields in the order defined in `wos.ledger_chain()` with UTC millisecond timestamps. Anyone can re-verify the chain from the public ledger API; the current head hash is published (TOKEN-DISTRIBUTION.md section 3).
- Every entry records `schedule_version` and who created it (`system` or `maintainer`).

## 3. Contributions

A `contributions` row is the unit of accepted work. States (`ContributionMachine`):

| From | Event | To | Actor | Guard |
|---|---|---|---|---|
| `pending` | `accept` | `accepted` | system, github | the category's acceptance condition below |
| `pending` | `reject` | `rejected` | system, maintainer | the subject ended without acceptance, or maintainer reason |
| `accepted` | `reverse` | `reversed` | maintainer, github | the merged change was reverted as defective within the hold window, or a public fraud finding |

`contributions.idempotency_key` is unique; the rewards consumer creates rows from events and never twice.

### Categories and acceptance

| Category | Who | Created when | Accepted when | Amount (rewards.v1 proposal) |
|---|---|---|---|---|
| `implementation` | builder of the attempt | attempt `pr_open` | its PR merged (`attempt.merged`) | 20 x ABU size points |
| `review` | each reviewer of each round of an accepted subject | verdict sealed | the subject is accepted (PR merged or document merged) and the review was not invalidated | roadmap review 40; contract review 20; implementation review 4 x size points |
| `review_finding` | reviewer who raised a material finding | finding revealed | the finding became `resolved` after an author `fixed` answer, or `upheld` by a ruling | 5 each, max 5 paid per review |
| `roadmap_work` | authors of accepted revisions of a merged roadmap version | revision committed | roadmap version merged | pool of 1000 per merged version, split by `allocatePool` pro-rata to accepted revisions authored |
| `feature_contract_work` | authors of accepted revisions of a merged contract version | revision committed | contract version merged | pool of 200 per merged version, split the same way |
| `architecture_resolution` | resolver | ruling submitted | ruling confirmed by a maintainer | 30 |
| `security` | reporter | maintainer `award_security` | at creation (maintainer decision with public reference) | low 25, medium 100, high 300, critical 1000 |
| `feature_completion_pool` | implementers of the relevant ABUs | app feature complete | at creation | see section 4 |
| `application_completion_pool` | contributors to the app | app BUILT reaches 10000 | at creation | see section 4 |

Contributions whose subject is a shared feature have `target_id` null (paid once). Reviews of rounds that did not lead to acceptance earn nothing (they were not accepted useful output); findings that were overruled earn nothing.

Rubber-stamp risk: the flat review reward pays a reviewer who always answers `NO_MATERIAL_GAPS`. Mitigations in V1: payment only when the subject is accepted, the other slot is independent, and a reviewer whose passed subjects are later reverted loses those review awards (void/clawback). Stronger measures (seeded-defect audits) are future work; see GAPS.md.

## 4. Pools (D10)

- **Feature completion pool, per app feature.** When an app's profile of a feature becomes complete (`profile_complete`), one `reward_pools` row (`feature_completion`, `app_feature_id`, unique) is created with amount = 10% (`featureCompletionPercentOfImplementation`) of the implementation tokens awarded on ABUs relevant to that app's profile. It is split by `allocatePool` pro-rata to each implementer's implementation tokens on those ABUs, then distributed as awards (category `feature_completion_pool`). Completing HubSpot's profile of a shared feature does not fire Salesforce's pool; each app's pool fires when its own profile completes, so shared ABUs can contribute to several apps' pools while the ABU itself is paid once.
- **Application completion pool, per app.** When the app's BUILT reaches 10000 (every capability mapped, every feature complete), one `application_completion` pool (unique per target) of 10000 tokens is split pro-rata to each account's lifetime tokens earned on that app's features, reviews and roadmap.
- `allocatePool`: largest-remainder method on integers; ties broken by account id ascending; the result always sums exactly to the pool.
- Pools are created once (unique indexes) and distributed once (`state open -> distributed`).

## 5. Holds, releases, reversals

| Step | Rule |
|---|---|
| Hold | Every award has `release_after = created_at + 14 days` (`holdDays`). |
| Release | The sweeper (`GET /v1/cron/sweep`) writes the release pair for every award past `release_after` that has no release, void or clawback, unless the award is blocked (below). Idempotent by key. |
| Blocked: bootstrap self-review | Awards whose acceptance relied on a `bootstrap_self` review (the contribution's `independence`) are not released until an independent re-review passes (REVIEW-PROTOCOL.md section 9). If it fails, they are voided. |
| Void | Before release: a revert of the merged change as defective (a maintainer-labelled revert PR, `github` actor) or a fraud finding reverses the contribution and writes a `void` for the award. |
| Clawback | After release: same triggers, `clawback` from available. Available may go negative; it is a derived number. |
| Adjustment | Maintainer only (`ledger_adjustment` action), public memo, event `ledger.entry_written`. |

## 6. Amounts are a founder decision

`reward-schedule.v1.json` has `status: "proposal"`. The numbers above are the architect's proposal to make the system testable; the founder must set them before launch (G-12). A schedule change is a new file (`rewards.v2`) activated through `platform_settings.active_reward_schedule`; entries always record the schedule version they were computed under; past entries are never recomputed.

## 7. What the rewards workstream builds

- `computeLedgerDrafts(event, facts, schedule)`: pure; given one domain event and loaded facts, returns the contribution transitions and ledger entry drafts. Must be deterministic and idempotent by key.
- `allocatePool(total, weights)`: pure.
- The `rewards` event consumer in the control plane calls them and persists everything in one transaction per event (`event_consumptions` PK makes the consumer at-least-once safe).
- Public views: reward history per contributor (only if opted in), leaderboard with the disclaimer.
