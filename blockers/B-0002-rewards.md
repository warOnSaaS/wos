```json
{
  "id": "B-0002-rewards",
  "status": "open",
  "raisedBy": "rewards",
  "raisedAt": "2026-09-29T20:01:33Z",
  "affectedContract": "docs/architecture/REWARD-PROTOCOL.md sections 3-5 (rules the protocol leaves open)",
  "reason": "Eight rule choices are not stated by the protocol. Wave 1 lesson 3 says every such choice is raised, not assumed. Each is implemented as below and pinned by a test, so a ruling either confirms it or names the change.",
  "evidence": "packages/rewards/src/rules.ts and release.ts; packages/rewards/test/rules.test.ts.",
  "requestedCapability": "A ruling on each of the eight choices listed in the prose below, recorded in REWARD-PROTOCOL.md.",
  "affectedWorkstreams": ["rewards", "control-plane"],
  "suggestedResolution": "Confirm all eight as implemented.",
  "decision": null
}
```

1. **Hold start.** `release_after = event.occurredAt + holdDays`, not the entry's `created_at` (which the trigger sets and a pure rule cannot know). This makes drafts identical on replay; the hold can start up to one dispatch lag earlier than section 5 says.
2. **One payer per category.** Implementation, review, finding, ruling and security awards are paid only on `contribution.accepted`; `attempt.merged` and `finding.ruled` pay nothing directly. Roadmap and contract work is paid only on `document.merged` (never per revision contribution). Keys: `award:implementation:<attemptId>:<account>`, `award:review:<reviewId>:<account>`, `award:review_finding:<findingId>:<account>`, `award:architecture_resolution:<rulingId>:<account>`, `award:security:<contributionId>:<account>` (the same key the control plane's `award_security` writes, so the two never double-pay), `award:<roadmap_work|feature_contract_work>:<documentId>:<account>`, `award:<pool category>:<poolId>:<account>`, `void:<awardId>`, `clawback:<awardId>`, `release:<awardId>:held|available`.
3. **Document pool shares.** One share per author, weighted by the sum of accepted revisions over that author's contributions; the draft names the author's lowest contribution id. Authors with zero accepted revisions get nothing.
4. **Pool shares have `contributionId` null.** The protocol lists `feature_completion_pool` and `application_completion_pool` as contribution categories "accepted at creation" but does not say who creates those rows. The drafts carry `poolId`; if contribution rows are wanted, the facts need their ids per account.
5. **Rounding.** Feature pool total = floor(live implementation tokens x 10 / 100). Reversed implementation awards are excluded from the basis. Pool shares then use `allocatePool`.
6. **No cascade.** Reversing an implementation contribution voids or claws back its own award only; pool shares already paid from it are not recomputed. Pools are created once, so a later reversal leaves them as distributed.
7. **Re-review outcome.** An `independent` `round.revealed` with outcome `gaps` on a subject that had a `bootstrap_self` round is the failed re-review and voids the held awards it guarded; outcome `consensus` writes nothing (the sweeper releases once `blockedByBootstrap` is false). A bootstrap pool share is not itself blocked (it has no contribution); see item 4.
8. **Missing or inconsistent facts.** Missing facts produce no drafts (fail closed). Facts naming a different subject than the event throw `RewardFactsError` (a loader bug that must stay loud, so the consumer stops instead of paying).
