/**
 * DRAFT — Proof of Contribution state machines, as data (same shape as ../state-machines.ts). Prose: PROTOCOL.md
 * section 4. Epoch state is append-only (wos.epoch_transitions); receipt status is append-only
 * (wos.receipt_status_events). Neither table is ever updated.
 */
import type { Machine } from "../state-machines.js";
import type { EpochState, ReceiptStatus, ReceiptStatusEventKind } from "./entities.js";

export type EpochEvent = "close" | "finalize" | "fund" | "reconcile";

export const EpochMachine: Machine<EpochState, EpochEvent> = {
  name: "Epoch",
  states: ["OPEN", "CALCULATING", "FINALIZED", "DISTRIBUTABLE", "CLOSED"],
  initial: ["OPEN"],
  terminal: ["CLOSED"],
  transitions: [
    {
      from: "OPEN",
      to: "CALCULATING",
      event: "close",
      actor: ["system"],
      guard:
        "now >= endsAt; the epoch manifest is frozen in the same transaction (every receipt with status counting in this epoch's mode and admitted to it); the next epoch is opened in the same transaction",
    },
    {
      from: "CALCULATING",
      to: "FINALIZED",
      event: "finalize",
      actor: ["system", "maintainer"],
      guard:
        "now >= CALCULATING.at + riskReviewHours (bounded window; admins could hold or revoke receipts only before this); no receipt is deferred more than maxDeferrals times; the engine ran on the frozen manifest; receiptsRoot, allocationsRoot and resultSha256 are recorded; allocations inserted exactly once (unique (epoch, account, slice))",
    },
    {
      from: "FINALIZED",
      to: "DISTRIBUTABLE",
      event: "fund",
      actor: ["system", "maintainer"],
      guard:
        "now >= FINALIZED.at + challengeHours; the settlement batch for the epoch exists (devnet: the distribution wallet holds exactly the epoch's net total); a Memo anchor with the roots was confirmed",
    },
    {
      from: "DISTRIBUTABLE",
      to: "CLOSED",
      event: "reconcile",
      actor: ["system"],
      guard:
        "every leaf of the epoch has a confirmed settlement record or was carried forward (unbound wallet); the reconciliation of on-chain transfers against leaves is recorded",
    },
  ],
};

type Kind = ReceiptStatusEventKind;

/**
 * Receipt qualification (D23, D25). Only RATIFIED counts in live epochs. Nothing is ever deleted; a rejected
 * ratification of founder bootstrap work returns it to PROVISIONAL with the rejection on record.
 */
export const ReceiptStatusMachine: Machine<ReceiptStatus, Kind> = {
  name: "ReceiptStatus",
  states: ["PENDING_RATIFICATION", "PROVISIONAL", "DISPUTED", "RATIFIED", "REVOKED"],
  initial: ["PENDING_RATIFICATION", "PROVISIONAL"],
  terminal: [],
  transitions: [
    {
      from: "PENDING_RATIFICATION",
      to: "RATIFIED",
      event: "quorum_ratified",
      actor: ["system"],
      guard:
        "the receipt's ratification quorum revealed X sealed RATIFY verdicts from distinct random accounts (never the author, never a pre-merge reviewer), each with server-verified evidence quotes at the merge commit",
    },
    {
      from: "PROVISIONAL",
      to: "RATIFIED",
      event: "quorum_ratified",
      actor: ["system"],
      guard: "as above; founder bootstrap receipts are first in the duty queue",
    },
    {
      from: "PENDING_RATIFICATION",
      to: "RATIFIED",
      event: "human_signoff",
      actor: ["system"],
      guard:
        "small pool only (active ratifiers < ReviewPolicy.ratification.smallPoolThreshold): the pre-merge human review by a non-author authorized human satisfies ratification",
    },
    {
      from: "PROVISIONAL",
      to: "RATIFIED",
      event: "human_signoff",
      actor: ["system"],
      guard:
        "small pool only: a separate human review by an authorized human who is not the founder, bound to the merge commit and the receipt hash",
    },
    {
      from: "PENDING_RATIFICATION",
      to: "DISPUTED",
      event: "ratification_failed",
      actor: ["system"],
      guard: "at least one revealed REJECT verdict with a material finding",
    },
    { from: "PROVISIONAL", to: "DISPUTED", event: "ratification_failed", actor: ["system"], guard: "as above" },
    {
      from: "DISPUTED",
      to: "RATIFIED",
      event: "dispute_resolved_ratify",
      actor: ["maintainer"],
      guard:
        "a conflict_resolution ruling confirmed by a maintainer who is not the author overrules every material finding (AdminAction resolve_ratification_dispute)",
    },
    {
      from: "DISPUTED",
      to: "REVOKED",
      event: "dispute_resolved_revoke",
      actor: ["maintainer"],
      guard:
        "the ruling upholds a material finding; the merged change becomes a fix task; an offset is recorded if the receipt was ever paid",
    },
    {
      from: "DISPUTED",
      to: "PROVISIONAL",
      event: "ratification_rejected",
      actor: ["maintainer"],
      guard: "only for receipts born PROVISIONAL: the rejection is recorded and the receipt stays public and provisional",
    },
    {
      from: "PENDING_RATIFICATION",
      to: "REVOKED",
      event: "revoked",
      actor: ["maintainer"],
      guard: "AdminAction invalidate_receipt with reason (two-person per RiskPolicy)",
    },
    { from: "PROVISIONAL", to: "REVOKED", event: "revoked", actor: ["maintainer"], guard: "as above" },
    {
      from: "RATIFIED",
      to: "REVOKED",
      event: "revoked",
      actor: ["maintainer"],
      guard: "as above; after finalization an offset is recorded instead of any on-chain reversal",
    },
    {
      from: "REVOKED",
      to: "PENDING_RATIFICATION",
      event: "restored",
      actor: ["maintainer"],
      guard: "AdminAction restore_receipt; the status before the revocation was PENDING_RATIFICATION",
    },
    { from: "REVOKED", to: "PROVISIONAL", event: "restored", actor: ["maintainer"], guard: "as above for PROVISIONAL" },
    { from: "REVOKED", to: "RATIFIED", event: "restored", actor: ["maintainer"], guard: "as above for RATIFIED" },
  ],
};
