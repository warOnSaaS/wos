/**
 * Release sweep (REWARD-PROTOCOL.md section 5). Pure: the sweeper (`GET /v1/cron/sweep`) loads the awards
 * and calls this; it writes a release pair for every award past its hold window that has no release, void
 * or clawback and is not blocked by a bootstrap_self review awaiting independent re-review.
 */
import type { LedgerEntryDraft } from "@waronsaas/contracts";
import { sha256Of } from "@waronsaas/contracts/canonical";
import type { AwardFact } from "./facts.js";
import { RewardFactsError } from "./facts.js";
import { finish } from "./rules.js";

export function computeReleaseDrafts(awards: readonly AwardFact[], now: string): LedgerEntryDraft[] {
  const t = Date.parse(now);
  if (Number.isNaN(t)) throw new RewardFactsError(`bad now ${now}`);
  const out: LedgerEntryDraft[] = [];
  for (const a of awards) {
    if (a.released || a.reversed || a.blockedByBootstrap) continue;
    if (Date.parse(a.releaseAfter) > t) continue;
    const pairId = deterministicUuid(`release:${a.id}`);
    const base = {
      accountId: a.accountId,
      kind: "release" as const,
      category: a.category,
      contributionId: a.contributionId,
      poolId: a.poolId,
      relatedEntryId: a.id,
      pairId,
      scheduleVersion: a.scheduleVersion,
      releaseAfter: null,
    };
    out.push(
      { ...base, bucket: "held", amount: -a.amount, idempotencyKey: `release:${a.id}:held`, memo: "hold window passed" },
      { ...base, bucket: "available", amount: a.amount, idempotencyKey: `release:${a.id}:available`, memo: "hold window passed" },
    );
  }
  return finish(out);
}

/** A name-based UUID (RFC 9562 version 8) from sha256, so a release pair id is the same on every replay. */
export function deterministicUuid(name: string): string {
  const h = sha256Of(`wos.rewards:${name}`)
    .slice("sha256:".length, "sha256:".length + 32)
    .split("");
  h[12] = "8";
  h[16] = ((Number.parseInt(h[16]!, 16) & 0x3) | 0x8).toString(16);
  const s = h.join("");
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20)}`;
}
