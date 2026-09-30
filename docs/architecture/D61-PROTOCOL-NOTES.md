# D61 protocol needs: a note for the protocol architect

Written by the Lead Architect on 2026-09-30. The planning and build side of D61 is contracts 5.7.0 (`packages/contracts/src/bugs.ts`, `WorkHoldMachine`, `BugMachine`, `AbuSpec.fix`, planning `validateFixUnit`). `ws/protocol` was NOT edited. The economy side (task types, budgets, outcomes) is yours; bind to these records, never to their prose.

**Task types to price** (names fixed by `BugTaskKind`; they join `TaskKind` when the control plane serves them):
1. **`bug_triage`**
   - Output: a `TriageDecision`. Bind the reward to `canonicalSha256(decision)`, published as `bug.triaged.decisionSha256`.
   - Suggested outcome rule: accepted when the decision is confirmed later, so a reproduction is never paid on the agent's word alone.
     - fix or contract_revision: confirmed by the fix's red-then-green evidence, or by the maintainer;
     - duplicate: confirmed when the named duplicate exists and is open or fixed;
     - not_reproducible or not_a_bug: confirmed by maintainer ratification or the challenge window.
   - A severity inflated to critical is a gaming vector: a maintainer confirms critical before holds open (`bugs-policy.v1` `triage.maintainerConfirmsCritical`). You may also want a penalty-free "severity corrected" outcome.
2. **`bug_sweep`**
   - Output: a `SweepOutput` (bug reports only, `sweepOutputRefusals`).
   - Recommendation: pay per report later confirmed (triage outcome fix or contract_revision, not a duplicate of an earlier report), plus at most a small base for the journeys run. Otherwise sweeps become report spam.
3. **Fix builds**
   - These are ordinary `abu_build` (and `abu_revision`) tasks on an ABU with `fix` set. Acceptance additionally requires `redGreenRefusals` empty (CI evidence).
   - Budget by size points as usual, optionally times a severity factor. Say whether the severity boost affects only ranking (as the contracts assume) or price too.
4. **Reporters**
   - A `BugReport` filed by `wos bug` has an author. Decide whether a confirmed report earns anything.
   - Recommendation: a small fixed amount per report confirmed as fix or contract_revision, first reporter only (the duplicate chain decides who was first).

**Self-dealing and attribution:**
- A contributor who introduced the divergence (the triage mapping names the divergent ABUs) and then reports, triages or fixes it: recommend that the same contributor cannot both triage and fix one bug, and cannot triage their own report. Independence rules as for reviews.
- Introducing a bug: recommend NO clawback or reputation effect in V1, since the ABU passed two independent reviews. Record the mapping only, so a later policy could use it.

**Holds** (same mechanism as D60; see D60-PROTOCOL-DELTA.md items 1, 3 and 4):
- A critical bug holds the unstarted feature ABUs of its feature. Their budgets are released as `cancelled`, with no admin action because nothing is leased or submitted, and reissued when the fix merges. There is no penalty.
- The build-next filter and the "first-generation issue epoch" continuity apply unchanged, with a bug source (`WorkHoldSource`).

**Ranking:**
- Add a `bugSeverity` term to `build-next-ranking`: `bugs-policy.v1` `severityBoost`, where low is 0, medium 150, high 1000 and critical 200000. Critical deliberately outranks the D60 migration boost (100000).
- The reference behaviour is contracts `rankBuildNext`: base score (D56) plus migration boost plus severity boost, held units filtered, ties by unit id.

**Events** to consume: `bug.reported`, `bug.triaged` (carries `decisionSha256` and `fixAbu`), `bug.fixed`, `bug.hold_changed`, `sweep.completed`.
