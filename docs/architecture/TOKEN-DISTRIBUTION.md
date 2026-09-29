# TOKEN-DISTRIBUTION (proposal)

**Status: PROPOSAL. Not implemented. Not an offer.** Nothing in this document is built in V1, and nothing here promises anyone anything. It exists because the spec asks for the proposed token distribution architecture to be documented separately from the implementation.

> WOS tokens are in-app credits with no cash value.

## 1. What exists in V1

- An internal, append-only, hash-chained ledger of WOS tokens earned for accepted work (REWARD-PROTOCOL.md).
- Balances and scores derived from it; a public opt-in leaderboard.
- No transfer between accounts, no redemption, no purchase, no exchange, no cash value, no on-chain representation.

## 2. What V1 must never do

| Never | Why |
|---|---|
| Deploy, mint or announce a transferable token or cryptocurrency | spec Agent 7; legal exposure |
| Let accounts send tokens to each other | creates a market and a sybil incentive |
| Sell tokens or accept payment for them | securities and money-transmission risk |
| Describe tokens as an investment, share, equity or future payout | misleading; legal exposure |
| Promise a future conversion ratio | same |
| Store wallet addresses or ask for them | not needed; privacy |
| Omit the disclaimer where tokens appear | D3 |

The code enforces the first three by absence: there is no transfer kind in the ledger (`LedgerEntryKind` has no transfer), no API route that moves tokens between accounts, and `debit` exists only for future in-app spending.

## 3. What a future transferable form would require

Activation would need, in this order:

1. **Legal review** in the founder's jurisdictions (securities, money transmission, tax, consumer protection) with a written opinion.
2. **Governance decision** recorded publicly: who decides, the rules, the vote or sign-off, the effective date.
3. **Snapshot.** Freeze the ledger at a published `entry_no` and `entry_hash` (the hash chain head). Anyone can verify every balance at the snapshot by replaying the public ledger and checking the chain.
4. **Identity and eligibility.** Accounts would need whatever verification the legal review requires. Unverified accounts keep in-app credits only.
5. **Opt-in claim.** Each eligible account explicitly claims; unclaimed balances stay in-app.
6. **New code path**, reviewed like any wOS change, behind a feature flag that is off by default: a new ledger kind for conversion, never a mutation of existing entries.

## 4. Allocation principles (proposal)

If a transferable form is ever activated, allocation should follow these principles:

- **Earned, not bought.** Allocation derives from the V1 ledger score (lifetime earned), not from any purchase.
- **Contributors first.** The majority of any supply goes to accounts by score at the snapshot; any founder, treasury or future-work reserve is a stated minority, published before activation, with vesting.
- **Reversals respected.** Voided and clawed-back amounts are already excluded by the score formula.
- **Bootstrap work treated equally only after independent re-review.** Held awards count only if released.
- **No retroactive changes.** The snapshot is final; corrections go through public adjustments before the snapshot.
- **Transparency.** The snapshot, the formula, the reserve sizes and the code are public before any claim opens.

## 5. Open questions for the founder

All of these are open and none is decided here: whether a transferable form should ever exist; jurisdictions; reserve sizes; vesting; whether spending in-app (debits) should come first; the casing of the token name (G-31). See GAPS.md.
