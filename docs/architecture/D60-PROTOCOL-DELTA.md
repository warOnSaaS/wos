# D60 protocol delta: a note for the protocol architect

Written by the Lead Architect on 2026-09-30 for Proof of Contribution (`ws/protocol`, currently with Astra as bundle 08). `ws/protocol` was NOT edited. Apply these at the protocol architect's discretion, as ordinary changes to the draft.

**Answer: D60 needs a small, additive protocol change. No change to accounting, budgets or R06-4/R07-4.**

What needs NO change:
- **Releasing held budgets.** Held work is unstarted: it has no active lease and no submission. `budgetReleaseRefusals` already lets such a reservation be released with reason `cancelled`, with no admin action.
- **Re-issue.** `reissueRefusals` already covers the new generation, created when the hold ends and priced at the current rate.
- **In-flight work.** It is not held. It finishes and is reviewed. Submitted work keeps R06-4/R07-4 protection unchanged: nothing submitted is released by a hold.
- **Revisions after the record merges** are ordinary `abu_revision` tasks with their own budgets.
- **"No penalty".** There is no reputation state in the protocol that a `cancelled` release touches. Failed-attempt counting (`maxFailedAttemptsPerAbu`) is on the ABU and a hold creates no attempt.

What needs a change (additive):
1. **Build next filters held units.** Add to `nextUnitEligibilityRefusals` a refusal "held by an architecture record (ADR-nnn)". The input is whether the unit's ABU has an active `architecture_hold` (contracts `abuOffered`). Self-pick refuses it too; the claim guard in contracts 5.5.0 already says so.
2. **The migration boost is a ranking term.** Add `architectureMigration` to the published `build-next-ranking` weights, currently 100000 in `architecture-policy.v1` `migrationBoost`. Either reference that file or copy the value, and bump the ranking version. `rankNextUnits` adds it when the unit belongs to a record whose migration is in progress. Contracts `rankWithArchitecture` is the reference behaviour.
3. **Ranking continuity after a hold.** A reissued task restarts `issuedEpoch`, so held work would lose its ageing and return lower than before, which contradicts D60 "held work returns in its prior order".
   - Proposal: the ranking input uses the FIRST generation's issue epoch (follow `reissueOf` to the root) when the release reason is an architecture hold.
   - Alternative: freeze ageing while held.
4. **A release label for transparency (optional).** A release caused by a hold is recorded as `cancelled` with a public label `architecture_hold:ADR-nnn`, so the public record shows it was not the builder's failure. No new operation kind is needed because no admin action is required, but the label must be derivable from the hold row.

Contracts references (main, 5.5.0): `architecture.ts` (`computeArchitectureImpact`, `abuOffered`, `holdOutcome`, `rankWithArchitecture`, `ArchitecturePolicy`), `ArchitectureHoldMachine` in `state-machines.ts`, events `architecture.impact_computed` and `architecture.hold_changed`, and `data/architecture-policy.v1.json`.
