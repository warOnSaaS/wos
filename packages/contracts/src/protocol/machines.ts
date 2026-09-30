/**
 * DRAFT — Proof of Contribution state machines, as data (same shape as ../state-machines.ts). Prose: PROTOCOL.md
 * section 4. Epoch state, receipt status and allocation/dispute history are append-only in migration 0007.
 */
import type { Machine } from "../state-machines.js";
import type { AllocationState, EpochState, ReceiptStatus, ReceiptStatusEventKind } from "./entities.js";

export type EpochEvent = "close" | "propose" | "finalize" | "fund" | "reconcile";

/**
 * D28: optimistic verification. CALCULATING runs sampled audits, canaries and the bounded risk review; PROPOSED
 * publishes every allocation with its explanation and anomaly metrics and opens the challenge window; FINALIZED makes
 * undisputed allocations final (disputed ones stay escrowed until their gate resolves).
 */
export const EpochMachine: Machine<EpochState, EpochEvent> = {
  name: "Epoch",
  states: ["OPEN", "CALCULATING", "PROPOSED", "FINALIZED", "DISTRIBUTABLE", "CLOSED"],
  initial: ["OPEN"],
  terminal: ["CLOSED"],
  transitions: [
    {
      from: "OPEN",
      to: "CALCULATING",
      event: "close",
      actor: ["system"],
      guard:
        "now >= endsAt (UTC); the receipt manifest is frozen in the same transaction; sampled audits and canaries are assigned; the next epoch opens in the same transaction",
    },
    {
      from: "CALCULATING",
      to: "PROPOSED",
      event: "propose",
      actor: ["system"],
      guard:
        "now >= CALCULATING.at + riskReviewHours (bounded window for holds, revocations and sampled-audit findings); the engine ran on the frozen manifest; allocations, explanations and anomaly metrics written exactly once; receiptsRoot, allocationsRoot and resultSha256 recorded and published publicly",
    },
    {
      from: "PROPOSED",
      to: "FINALIZED",
      event: "finalize",
      actor: ["system"],
      guard:
        "now >= PROPOSED.at + challengeHours (the window runs from the PUBLIC publication time, never from a notification); undisputed allocations become final; disputed ones stay escrowed",
    },
    {
      from: "FINALIZED",
      to: "DISTRIBUTABLE",
      event: "fund",
      actor: ["system", "maintainer"],
      guard:
        "the settlement batch exists (devnet: the distribution wallet holds the epoch's claimable total) and the Memo anchor with the roots is confirmed",
    },
    {
      from: "DISTRIBUTABLE",
      to: "CLOSED",
      event: "reconcile",
      actor: ["system"],
      guard: "every final leaf is settled or carried forward and every dispute of the epoch is resolved; reconciliation recorded",
    },
  ],
};

/**
 * Receipt qualification (D23, D28, D54). ACTIVE, RATIFIED and FINAL_BY_SILENCE count live. A PROVISIONAL receipt
 * finalizes (D54) when its persisted post-bootstrap challenge publication closes with no challenge (FINAL_BY_SILENCE — its
 * own evidence class, not a ratification); a challenge sends it to the review gate, whose one decision either accepts it
 * (RATIFIED, an independent human) or rejects it (it stays PROVISIONAL, on record). Audit-quorum ratification is dormant.
 */
export const ReceiptStatusMachine: Machine<ReceiptStatus, ReceiptStatusEventKind> = {
  name: "ReceiptStatus",
  states: ["ACTIVE", "PROVISIONAL", "RATIFIED", "FINAL_BY_SILENCE", "REVOKED"],
  initial: ["ACTIVE", "PROVISIONAL"],
  terminal: [],
  transitions: [
    {
      from: "PROVISIONAL",
      to: "RATIFIED",
      event: "quorum_ratified",
      actor: ["system"],
      guard: "an audit quorum of `quorum` independent random auditors (not the founder) judged every line plausible, sealed, with evidence",
    },
    {
      from: "PROVISIONAL",
      to: "RATIFIED",
      event: "human_signoff",
      actor: ["system"],
      guard: "small pool: a PASS by an authorized human who is not the founder, bound to the merge commit and the receipt hash",
    },
    {
      from: "PROVISIONAL",
      to: "FINAL_BY_SILENCE",
      event: "final_by_silence",
      actor: ["system"],
      guard:
        "D54: its challenge publication (persisted, server-stamped after bootstrap ended, bound to the receipt hash) has closed and no challenge was admitted; decided under the receipt's subject lock",
    },
    {
      from: "PROVISIONAL",
      to: "PROVISIONAL",
      event: "ratification_rejected",
      actor: ["system"],
      guard: "the quorum or human rejected it; the rejection is recorded; nothing is deleted",
    },
    {
      from: "ACTIVE",
      to: "REVOKED",
      event: "revoked",
      actor: ["maintainer", "system"],
      guard: "AdminAction invalidate_receipt (two-person) or a dispute gate outcome REVOKED; after finalization an offset is recorded",
    },
    { from: "PROVISIONAL", to: "REVOKED", event: "revoked", actor: ["maintainer", "system"], guard: "as above" },
    { from: "RATIFIED", to: "REVOKED", event: "revoked", actor: ["maintainer", "system"], guard: "as above" },
    { from: "FINAL_BY_SILENCE", to: "REVOKED", event: "revoked", actor: ["maintainer", "system"], guard: "as above" },
    {
      from: "REVOKED",
      to: "ACTIVE",
      event: "restored",
      actor: ["maintainer"],
      guard: "AdminAction restore_receipt; the status before the revocation was ACTIVE",
    },
    { from: "REVOKED", to: "PROVISIONAL", event: "restored", actor: ["maintainer"], guard: "as above for PROVISIONAL" },
    { from: "REVOKED", to: "RATIFIED", event: "restored", actor: ["maintainer"], guard: "as above for RATIFIED" },
    {
      from: "REVOKED",
      to: "FINAL_BY_SILENCE",
      event: "restored",
      actor: ["maintainer"],
      guard: "as above, and only when the receipt's immutable history holds its final_by_silence event (review 07 R07-5)",
    },
  ],
};

export type AllocationEvent =
  | "open_window"
  | "window_closed"
  | "dispute"
  | "reply_closed"
  | "gate_upheld"
  | "gate_clipped"
  | "gate_revoked"
  | "settle";

/** One allocation line (per receipt or per payout) from proposal to final (D28, D30, D31). Derived from append-only rows. */
export const AllocationMachine: Machine<AllocationState, AllocationEvent> = {
  name: "Allocation",
  states: ["PROPOSED", "CHALLENGE_OPEN", "FINALIZED", "DISPUTED", "UNDER_REVIEW", "UPHELD", "CLIPPED", "REVOKED", "FINAL"],
  initial: ["PROPOSED"],
  terminal: ["FINAL"],
  transitions: [
    {
      from: "PROPOSED",
      to: "CHALLENGE_OPEN",
      event: "open_window",
      actor: ["system"],
      guard: "the epoch entered PROPOSED; the line, its explanation and permalink are public",
    },
    {
      from: "CHALLENGE_OPEN",
      to: "FINALIZED",
      event: "window_closed",
      actor: ["system"],
      guard: "the window ended with no dispute naming this allocation (silence = accept)",
    },
    {
      from: "CHALLENGE_OPEN",
      to: "DISPUTED",
      event: "dispute",
      actor: ["contributor"],
      guard:
        "a dispute by an epoch participant (not the allocation's owner) names this allocation; stake escrowed; rate limits hold; later disputes join the same gate",
    },
    {
      from: "DISPUTED",
      to: "UNDER_REVIEW",
      event: "reply_closed",
      actor: ["system"],
      guard: "the accused's right-of-reply window ended (or they replied); the audit gate is assigned",
    },
    {
      from: "UNDER_REVIEW",
      to: "UPHELD",
      event: "gate_upheld",
      actor: ["system", "maintainer"],
      guard: "the gate kept the allocation as proposed",
    },
    {
      from: "UNDER_REVIEW",
      to: "CLIPPED",
      event: "gate_clipped",
      actor: ["system", "maintainer"],
      guard:
        "an inflation or attribution finding was upheld; a ReceiptClip records the plausible weight; amount recomputed at the epoch rate",
    },
    {
      from: "UNDER_REVIEW",
      to: "REVOKED",
      event: "gate_revoked",
      actor: ["system", "maintainer"],
      guard: "the receipt was revoked (fabrication, duplicate work)",
    },
    { from: "FINALIZED", to: "FINAL", event: "settle", actor: ["system"], guard: "the epoch finalized; the line is claimable" },
    { from: "UPHELD", to: "FINAL", event: "settle", actor: ["system"], guard: "stakes settled; the line is claimable" },
    {
      from: "CLIPPED",
      to: "FINAL",
      event: "settle",
      actor: ["system"],
      guard: "excess returned to the reserve less the disputer's bounty; the clipped amount is claimable",
    },
    {
      from: "REVOKED",
      to: "FINAL",
      event: "settle",
      actor: ["system"],
      guard: "excess returned to the reserve less the bounty; nothing claimable",
    },
  ],
};
