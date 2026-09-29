```json
{
  "id": "B-0001-rewards",
  "status": "accepted",
  "raisedBy": "rewards",
  "raisedAt": "2026-09-29T20:01:33Z",
  "affectedContract": "packages/rewards RewardFacts (loaded by services/control-plane rewardsConsumer); REWARD-PROTOCOL.md section 7 ('returns the contribution transitions and ledger entry drafts'); the release sweeper (section 5)",
  "reason": "The rules need facts that neither the event nor the Wave 0 RewardFacts ({ now, bootstrapSelfReviewed }) carry: ABU size points, the review's subject kind, validity and timeliness, a finding's state and paid rank, a ruling's confirmation, a security severity, the pool row id and basis, and the ledger ids of existing awards. The control plane today passes { now, bootstrapSelfReviewed, contributions: [{ id, account_id, category, state, weight }] }, which is not enough to price anything, so with the real rules it writes no drafts. Separately, section 7 says computeLedgerDrafts returns contribution transitions, but the frozen signature returns LedgerEntryDraft[] only, and releases have no triggering event.",
  "evidence": "services/control-plane/src/domain/consumers.ts rewardsConsumer (facts literal, types list without app_feature.state_changed and progress.recomputed); services/control-plane/test/support/harness.ts computeLedgerDrafts: () => []; packages/rewards/src/facts.ts (the typed facts); packages/rewards/test/rules.test.ts 'pays nothing when the facts a rule needs were not loaded (fail closed)'.",
  "requestedCapability": "Ratify the typed RewardFacts in packages/rewards/src/facts.ts (additive: every new field optional, Wave 0 fields unchanged) as the facts contract, and have control-plane load them per event; add app_feature.state_changed and progress.recomputed to the rewards consumer; create the reward_pools row before calling the rules and pass its id; call computeReleaseDrafts from GET /v1/cron/sweep; state in REWARD-PROTOCOL.md that contribution transitions stay with the control plane (the rules return drafts only).",
  "affectedWorkstreams": [
    "control-plane",
    "rewards"
  ],
  "suggestedResolution": "Accept facts.ts as written. Loader mapping: contribution.accepted -> facts.contribution (implementation: abus.size_points, attempt merged; review: rounds subject kind, abus.size_points for implementation, subjectAccepted from the subject, schemaValid = a sealed reviews row exists, onTime = reviews.sealed_at <= leases.expires_at, invalidated = false unless an audit voided it; review_finding: findings.severity = 'material', findings.state, paidRank = position among the review's resolved/upheld material findings ordered by findings.id; architecture_resolution: rulings.state = 'confirmed'; security: the severity of the award_security action). contribution.reversed -> facts.awards (the contribution's award entries with released/reversed flags). document.merged -> facts.documentPool (accepted roadmap_work/feature_contract_work contributions, acceptedRevisions = contributions.weight). app_feature.state_changed to built -> insert the feature_completion pool (amount = featureCompletionPoolTotal(basis)) and pass facts.featurePool with the implementation awards on ABUs in that app's profile. progress.recomputed built 10000 -> the application_completion pool and facts.applicationPool. round.revealed of an independent re-review of a bootstrap_self subject -> facts.reReview. Sweeper: load awards with blockedByBootstrap = contribution.independence = 'bootstrap_self' and no passed independent re-review of the subject.",
  "decision": {
    "outcome": "accepted",
    "contractsVersion": "4.2.0",
    "note": "accepted as suggested: facts.ts is the facts contract and the loader mapping is normative; rules return drafts only, contribution transitions stay with the control plane; the consumer adds app_feature.state_changed and progress.recomputed; pools are created by the control plane before the rules; the sweeper calls computeReleaseDrafts (REWARD-PROTOCOL section 8).",
    "decidedAt": "2026-09-29T23:00:00Z"
  }
}
```

Continued without waiting: the rules, the facts types and `computeReleaseDrafts` are implemented and tested against these facts, including one test against the real Postgres ledger (`packages/rewards/test/ledger.db.test.ts`). Nothing in a frozen file or in `services/control-plane` was changed. Until the control plane loads these facts, the consumer writes nothing (fail closed), which is the same observable behaviour as the Wave 1 fake.
