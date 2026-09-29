```json
{
  "id": "B-0002-control-plane",
  "status": "open",
  "raisedBy": "control-plane",
  "raisedAt": "2026-09-29T14:40:00-04:00",
  "affectedContract": "packages/contracts/src/events.ts DomainEventBody",
  "reason": "DOMAIN-MODEL.md section 3 requires exactly one wos.events row per transition, but events.ts defines no event for several transitions: DocumentMachine round_gaps, ruling_upheld, ruling_all_overruled, maintainer_reopen; RoundMachine cancel; ContributionMachine reject; every ProposalMachine and BlockerMachine transition (only proposal.opened / blocker.opened exist); InventoryMachine roadmap_merged and superseded_by_newer. There is also no document.state_changed for readers who want one event type per document transition.",
  "evidence": "services/control-plane/src/db/events.ts PendingEventType. These are written today as PRIVATE events typed document.state_changed, round.cancelled, contribution.state_changed, proposal.state_changed, blocker.state_changed, inventory_version.state_changed so the database invariant holds; the API filters them out because they do not parse as DomainEvent.",
  "requestedCapability": "Event types (v1) for those transitions, e.g. document.state_changed {documentId, event, from, to}, round.cancelled {roundId, reason}, contribution.state_changed {contributionId, from, to, reason}, proposal.state_changed {proposalId, from, to}, blocker.state_changed {blockerId, from, to}, inventory_version.state_changed {id, event, from, to}; public or private per the architect.",
  "affectedWorkstreams": ["control-plane", "web", "rewards"],
  "suggestedResolution": "MINOR change: add the six types above with exactly these payloads; rows already written by the control plane then parse without migration.",
  "decision": null
}
```
