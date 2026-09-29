/**
 * Derived token accounting, the pure mirror of `wos.v_balances` and `wos.v_leaderboard` (D3: balances are
 * derived by summing, never stored). Used by tests and by any reader that already holds the entries.
 * WOS tokens are in-app credits with no cash value.
 */
import type { Balance, LedgerEntryDraft } from "@waronsaas/contracts";
import { compareKeys } from "./allocate.js";

type Entry = Pick<LedgerEntryDraft, "accountId" | "kind" | "bucket" | "amount">;

const SCORE_KINDS = new Set(["award", "void", "clawback", "adjustment"]);

export function computeBalances(entries: readonly Entry[]): Balance[] {
  const by = new Map<string, Balance>();
  for (const e of entries) {
    const b = by.get(e.accountId) ?? { accountId: e.accountId, held: 0, available: 0, score: 0 };
    if (e.bucket === "held") b.held += e.amount;
    else b.available += e.amount;
    // Releases net to zero across buckets; debits (spending) never lower the score.
    if (SCORE_KINDS.has(e.kind)) b.score += e.amount;
    by.set(e.accountId, b);
  }
  return [...by.values()].sort((a, b) => compareKeys(a.accountId, b.accountId));
}

export interface LeaderboardAccount {
  accountId: string;
  handle: string | null;
  optedIn: boolean;
  active: boolean;
  createdAt: string;
}

/** Opted-in, active accounts with a handle and a positive score, by score then account age (SQL rank()). */
export function rankLeaderboard(
  balances: readonly Balance[],
  accounts: readonly LeaderboardAccount[],
): Array<{ rank: number; accountId: string; handle: string; score: number }> {
  const score = new Map(balances.map((b) => [b.accountId, b.score]));
  const rows = accounts
    .filter((a) => a.optedIn && a.active && a.handle !== null && (score.get(a.accountId) ?? 0) > 0)
    .map((a) => ({ accountId: a.accountId, handle: a.handle!, score: score.get(a.accountId)!, at: Date.parse(a.createdAt) }))
    .sort((a, b) => b.score - a.score || a.at - b.at || compareKeys(a.accountId, b.accountId));
  return rows.map((r, i) => {
    const firstEqual = rows.findIndex((x) => x.score === r.score && x.at === r.at);
    return { rank: (firstEqual === -1 ? i : firstEqual) + 1, accountId: r.accountId, handle: r.handle, score: r.score };
  });
}
