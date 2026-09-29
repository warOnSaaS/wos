/**
 * @waronsaas/rewards — pure reward rules: events in, ledger entry drafts out (owner: rewards workstream).
 * Never writes to the database; the control plane persists drafts in one transaction.
 */
import { NotImplementedError, type DomainEvent, type LedgerEntryDraft, type RewardSchedule } from "@waronsaas/contracts";

/** Facts the rules need that are not in the event itself, loaded by the control plane. */
export interface RewardFacts {
  now: string;
  bootstrapSelfReviewed: boolean;
  [key: string]: unknown;
}

export function computeLedgerDrafts(event: DomainEvent, facts: RewardFacts, schedule: RewardSchedule): LedgerEntryDraft[] {
  void event;
  void facts;
  void schedule;
  throw new NotImplementedError("computeLedgerDrafts");
}

/** Largest-remainder split of an integer pool by integer weights; deterministic tie-break by key. */
export function allocatePool(total: number, weights: ReadonlyArray<{ key: string; weight: number }>): Map<string, number> {
  void total;
  void weights;
  throw new NotImplementedError("allocatePool");
}
