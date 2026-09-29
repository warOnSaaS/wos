```json
{
  "id": "B-0001-context-policy",
  "status": "accepted",
  "raisedBy": "context-policy",
  "raisedAt": "2026-09-29T18:07:31Z",
  "affectedContract": "packages/contracts/src/agent-io.ts ContextPlan (no task kind); packages/agent-policy/src/index.ts EligibilityInput (no clock, no task exclusions); CONTEXT-PROTOCOL.md (no verdict ref form); WORKSTREAMS.md template ownership",
  "reason": "Four gaps between the frozen contracts and what the context-policy evaluators must decide purely. (1) ContextManifest.task.kind is required but ContextPlan carries no task kind, so builder abu_build vs abu_revision must be inferred. (2) checkEligibility must check GitHub account age (>= 90 days) but EligibilityInput has no evaluation time, and the package may not read the clock (ARCHITECTURE.md rule 4); step 7 also needs excluded_account_ids and restricted_to_account_id, which the input lacks. (3) The other slot's current verdict must be excluded with reason other_slot_current_round, but CONTEXT-PROTOCOL.md never names the ref form of a verdict document, so the engine can only recognise a convention. (4) WORKSTREAMS.md gives planning ownership of packages/planning/templates/** (author, reviewer and resolver templates) while CONTEXT-PROTOCOL.md section 4 puts every template in packages/context-engine/templates/<templateId>.md with its sha256 in the manifest; buildContext's frozen signature has no way to receive templates from planning.",
  "evidence": "agent-io.ts ContextPlan fields vs ContextManifest.task {id, kind}; agent-policy/src/index.ts EligibilityInput (githubAccountCreatedAt only); AGENT-POLICY.md section 5 steps 3 and 7; CONTEXT-PROTOCOL.md sections 2, 3 and 7; WORKSTREAMS.md planning OWNS; tests packages/agent-policy/test/eligibility.test.ts ('no clock passed fails closed') and packages/context-engine/test/isolation.test.ts.",
  "requestedCapability": "(1) ContextPlan.taskKind: TaskKind. (2) Ratify the additive optional EligibilityInput fields now, excludedAccountIds, restrictedToAccountId (implemented; now missing fails closed with CLOCK_REQUIRED), or make now required. (3) Name the verdict ref form in CONTEXT-PROTOCOL.md section 2. (4) Decide which package owns prompt templates.",
  "affectedWorkstreams": [
    "context-policy",
    "control-plane",
    "planning",
    "github-build"
  ],
  "suggestedResolution": "MINOR contracts bump: add optional ContextPlan.taskKind (engine prefers it over inference when present). Keep the three optional EligibilityInput fields; control-plane passes now from the transaction clock. Declare verdict refs as wos:verdict/<roundId>/<slot> (implemented by isCurrentRoundVerdictRef, which also matches wos:verdicts/, wos:review/, wos:reviews/ containing the round id). Keep every template in context-engine (they are hashed into manifests and must ship with the engine); planning contributes template text by PR to packages/context-engine/templates and owns the validators only.",
  "decision": {
    "outcome": "accepted",
    "contractsVersion": "2.0.0",
    "note": "accept-modified. (1) ContextPlan.taskKind added and REQUIRED (the plan never leaves it to inference; drop taskKindForPlan). (2) EligibilityInput.now becomes REQUIRED (control plane passes the transaction clock); excludedAccountIds and restrictedToAccountId ratified. (3) Verdict ref reserved as wos:verdict/<roundId>/<slot>, never placed in a plan; checkManifestAgainstPlan rejects any wos:verdict/ ref and any server_document ref not in the plan (do not match loose variants). (4) All templates live in packages/context-engine/templates/; ownership per file: planning owns tpl.roadmap_*, tpl.feature_*, tpl.conflict_resolver*. (5) bootstrap_self is exempt from the same-author cap (bootstrap.exemptSelfReviewFromSameAuthorCap = true). (6) Author and resolver leases get a family limit: limits.maxConcurrentAuthorLeasesPerContributor = 1.",
    "decidedAt": "2026-09-29T19:30:00Z"
  }
}
```

Notes:

- Interim behaviour, all tested: `taskKindForPlan` returns `abu_revision` for a builder plan that selects a `wos:findings/` document, else `abu_build`; the manifest check compares against the same derivation, so client and server agree.
- A fifth, smaller question for the same decision: in bootstrap, `maxReviewsOfSameAuthorPer7d` (5) also applies to a solo founder reviewing their own work (`bootstrap_self`), because AGENT-POLICY.md says self-review is allowed only when the author rule is the only one failing. That caps the founder at five self-reviews per slot per week. Implemented as written (test "bootstrap: self-review still respects the same-author cap"); the architect may want the cap waived for `bootstrap_self`.
- Lease families: AGENT-POLICY.md step 4 defines limits only for build and review roles, so authors and the resolver have no concurrent-lease limit in `checkEligibility`. Confirm that is intended.
