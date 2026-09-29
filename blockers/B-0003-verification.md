```json
{
  "id": "B-0003-verification",
  "status": "accepted",
  "raisedBy": "verification",
  "raisedAt": "2026-09-29T18:18:19Z",
  "affectedContract": "packages/db/migrations/0001_init.sql check_review_independence, reviews, events RLS, platform_settings",
  "reason": "The DB backstops described in SECURITY.md S-12, S-23 and S-31 are weaker than stated. (a) A review row is not bound to its task, lease and slot: the trigger checks round state, head and diff hash and the author rule, but not that tasks.round_id = reviews.round_id, that the lease is for that task and held by reviews.account_id, that reviews.slot = tasks.reviewer_slot, or that manifest_id belongs to the lease. Head sha and diff hash are public, so a control-plane bug that trusts a lease id lets a reviewer of round X post into round Y. (b) independence='bootstrap_self' skips the author rule unconditionally, even when platform_settings.bootstrap_mode is disabled or the account is not a maintainer. (c) bootstrap_mode can be set back to enabled by the app role; AGENT-POLICY says exit is one-way. (d) events has visibility 'private' but a permissive app_all policy, so private events are readable by any contributor at the DB layer.",
  "evidence": "packages/verification/test/adversarial/db.adversarial.test.ts: five 'KNOWN GAP (B-0003)' tests run as it.fails against a freshly migrated Postgres 17 (all five fail on their assertion, not on setup). Migration lines 1026-1066 (trigger), 1133-1143 (app_all includes events and platform_settings).",
  "requestedCapability": "A new migration that: extends check_review_independence to require the task/lease/slot/manifest binding; rejects bootstrap_self unless bootstrap_mode.enabled and the account holds the maintainer role; forbids bootstrap_mode enabled=false -> true (trigger on platform_settings); gives events a policy that hides visibility='private' rows from non-owners.",
  "affectedWorkstreams": [
    "architect",
    "control-plane"
  ],
  "suggestedResolution": "Migration 0002_backstops.sql. The it.fails tests turn red when it lands, which is the signal to drop the marker.",
  "decision": {
    "outcome": "accepted",
    "contractsVersion": "2.0.0",
    "note": "accepted. Migration 0002_backstops.sql: review bound to its task (round and slot), the task's active lease held by the reviewer, and a manifest of that lease; bootstrap_self and bootstrap_maintainer only while bootstrap mode is on and only from a maintainer; bootstrap mode one-way (trigger on platform_settings, also no delete); private events readable only by privileged actors and the account concerned. Equivalent assertions are in packages/db/test/db-assertions.sql and pass on postgres:17 and supabase/postgres. Remove the it.fails markers and give fixtures valid bindings.",
    "decidedAt": "2026-09-29T19:30:00Z"
  }
}
```

Raised by the verification workstream in Wave 1. See the evidence paths above; continuing with unaffected work.
