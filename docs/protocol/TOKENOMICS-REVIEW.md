# TOKENOMICS-REVIEW (DRAFT)

Scope: supply, emissions, allocation (revised for A6/A7), incentives and gaming, and governance lock mechanics. Numbers are provisional policy data (D33); evidence is in TOKENOMICS-SIMULATION.md (tables S1–S10, A–L). wOS never sells WOS, provides liquidity or promotes a price (A5); nothing here is a price model.

## 1. Supply

- **Maximum supply: 1,000,000,000 WOS** (Part B's working figure; not sacred). 6 decimals.
- **Emission reserve: 995,000,000 WOS (99.5%)**, emitted only through epochs to contributors and rules-bound pools.
- **Genesis cap: 5,000,000 WOS (0.5%)**, the only other bucket; minted at mainnet only for approved historical credit; the unused part is never minted (GENESIS-POLICY.md).
- Nothing else exists: no founder bucket, no investor bucket, no premine, no pre-funded treasury, no reserve for sale.

## 2. Allocation: Part B's working split vs this design

| Part B bucket | Part B | This design | Why |
|---|---|---|---|
| Agent/contributor emissions | 60% | execution 60%, planning 10%, human review 5%, outcomes 5% **of each epoch budget** | contribution types have their own slices |
| Completion pools | 15% | 15% of each epoch budget, accrued with utilisation | funded by emissions, not a premine |
| Protocol/community treasury | 10% | **none up front**; security reserve 5% of each epoch budget | A7: only a rules-bound pool, and it fills only as work happens |
| Founding/core contributors | 7.5% | **none** | A6: contributor zero + Genesis (≤ 0.5%) |
| Security/research/review | 5% | security reserve (5%) + human-review slice (5%) + audit rewards (execution) | inside epochs |
| Reserve | 2.5% | none | nothing unassigned |

Every WOS therefore enters circulation because an epoch allocated it to a person or organization for recorded contribution, or because Genesis credited recorded pre-protocol output.

## 3. Emission options compared

| Option | Mechanism | Pros | Cons |
|---|---|---|---|
| **(1) Asymptotic from a fixed reserve (chosen)** | budget = 3,327 ppm of the remaining reserve per weekly epoch (≈ 4-year half-life), rate ceiling, unused budget stays in the reserve | hard cap forever; strong early, declining, no cliff; participation-driven (S6 emits almost nothing when almost nobody works) | issuance never reaches zero exactly; late contributors earn little per ACU (S2 year 10: 1.8 WOS/ACU) |
| (2) Fixed bootstrap pool, then a fee economy | e.g. 40% over 4 years, then rewards from fees | ties rewards to real usage | a fee economy needs WOS to be *bought* or accepted as payment; buybacks by wOS would be price support (forbidden by A5); accepting WOS for wOS Cloud sets a price (legal checkpoint) |
| (3) Bootstrap + low perpetual tail | (1) plus e.g. 1%/year inflation forever | contributors are always rewarded | breaks the max supply; needs governance and a legal read |

**Recommendation:** (1) for V1 and mainnet. Revisit (3) only by a structural governance vote after years of data. "Eventual support from real network usage" is best served without wOS touching the token: WOS spendable in-app on wOS Cloud (the ledger already supports debits) is a founder + legal decision at the checkpoint (F8), not a V1 feature.

## 4. Incentives

- **Early vs late:** WOS per ACU falls with time (ceiling decay, budget decay) and with participation (pro rata). At 1,000 contributors a median contributor receives ~1,442 WOS/week in week 1 and ~258 in year 10 (S1); at 10,000, ~145 and ~26 (S2).
- **Low participation:** the ceiling holds the rate at ≤ 100 WOS/ACU and returns ~99% of the budget (S6, S9). No windfall for early solitude.
- **Growth:** in extreme growth (S5, 10 → 1,000,000 in two years) the rate drops by three orders of magnitude within a year; early contributors are rewarded more per ACU, as Part B prefers, without a cliff.
- **Inference cost decline:** if the oracle tracks falling prices, the same work yields fewer ACU and, once the ceiling binds, fewer WOS (S7: 95% of the year-10 budget returned). Re-basing the ceiling with each oracle version is required.
- **Provider prices:** a cut in one provider's list price moves shares away from its users (S8). Damping (≤ 30% per oracle version) limits the jump; it does not remove it.
- **Completion pools** reward finishing: every feature's pool pays implementers, authors, reviewers and the finder when the whole frozen definition is met on every surface.

## 5. Gaming (summary; full list in ABUSE-MODEL.md)

The dominant economic attack on a usage-weighted reward is inflation up to the cap. With V1 caps, inflation can pay +22% to +56% receipt by receipt (A). Countermeasures that make the expected gain ≈ 0: exact-total run logs (bare numbers halved), anomaly ranking and total-excess bounties (disputes become rational, C), sampled audits, and a 13-epoch pattern lookback with offsets. The simplest structural fix remains the founder's option to weight mainnet by accepted output (ADR 3.4, F1).

## 6. Governance locks on Solana (D34)

Governance counts WOS locked for ≥ 12 months (GOVERNANCE.md). Options:

| Option | What it is | For | Against |
|---|---|---|---|
| **SPL Governance (Realms) with a voter-stake-registry (VSR) plugin** | Solana's governance program; VSR adds time-locked deposits with vote weight by lock duration | existing, used in production by several DAOs; supports lockups | Token-2022 support in the VSR plugin: UNVERIFIED; the program and plugin upgrade authorities must be checked; Realms counts votes on chain, while V1 counts off chain |
| A vesting/escrow program (e.g. Streamflow or Bonfida token vesting) as the "lock" | tokens escrowed with a release date | simple, audited vendors (audit status UNVERIFIED by us) | vote weight must be read off chain from escrow accounts |
| Custom vote-escrow program | ve-style locks | exactly our rule | new Rust, audit required |

**Recommendation:** V1 runs governance **off chain** (signed votes, deterministic tally, weights snapshotted by wOS) with **devnet** locks for rehearsal using an existing escrow/vesting program; the snapshot reads lock accounts at a declared slot. Choose between VSR and an escrow program at the mainnet gate after verifying Token-2022 support, audits and upgrade authorities (MAINNET-READINESS G-8). Do not write a custom lock program.

## 7. Open numbers (founder decisions F2, F3, F4)

Budget ppm, ceiling (100 WOS/ACU, decay), slices (60/10/5/5/15/5), Genesis cap (0.5%), unclaimed carry (52 epochs), completion splits (75/10/5/8/2), stakes and bounties. Each can be previewed with `tools/tokenomics-sim/preview.ts` before activation.
