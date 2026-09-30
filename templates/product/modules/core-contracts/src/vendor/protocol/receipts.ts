/**
 * DRAFT — canonical hashing for Proof of Contribution records and the allocation Merkle tree. Node-only (it uses
 * @waronsaas/contracts/canonical). Normative rules, pinned by packages/contracts/test/protocol.test.ts:
 *
 *  P-1 A receipt's hash is canonicalSha256 (C-1/C-2) of the zod-PARSED record (unknown keys stripped). Usage
 *      receipts, contribution receipts, run-policy snapshots, human reviews and review contexts all use this rule.
 *  P-2 Usage event dedup: usageEventIdsSha256 = sha256 of the provider response ids, sorted (UTF-16), joined "\n".
 *  P-3 Allocation Merkle tree (wOS's own root, published and anchored in an SPL Memo; independent of any on-chain
 *      distributor format): leaf = sha256(0x00 || JCS(ClaimLeaf)); node = sha256(0x01 || left || right); leaves in
 *      `index` order; an odd node at any level is promoted unchanged. Empty tree root = sha256("") of zero bytes.
 *  P-4 Receipts Merkle root of an epoch manifest: the same tree over sha256(0x00 || JCS(EpochManifestEntry)) sorted by
 *      receiptId.
 */
import { createHash } from "node:crypto";
import { canonicalJson, canonicalSha256 } from "../canonical.js";
import type { Sha256 } from "../primitives.js";
import {
  ClaimLeaf,
  ContributionReceipt,
  EpochManifestEntry,
  GenesisContribution,
  HumanReview,
  HumanReviewContext,
  RunPolicySnapshot,
  UsageReceipt,
} from "./entities.js";

export function usageReceiptSha256(r: UsageReceipt): Sha256 {
  return canonicalSha256(UsageReceipt.parse(r));
}
export function contributionReceiptSha256(r: ContributionReceipt): Sha256 {
  return canonicalSha256(ContributionReceipt.parse(r));
}
export function runPolicySnapshotSha256(r: RunPolicySnapshot): Sha256 {
  return canonicalSha256(RunPolicySnapshot.parse(r));
}
export function humanReviewSha256(r: HumanReview): Sha256 {
  return canonicalSha256(HumanReview.parse(r));
}
export function humanReviewContextSha256(r: HumanReviewContext): Sha256 {
  return canonicalSha256(HumanReviewContext.parse(r));
}
export function genesisContributionSha256(r: GenesisContribution): Sha256 {
  return canonicalSha256(GenesisContribution.parse(r));
}

export function usageEventIdsSha256(ids: readonly string[]): Sha256 {
  const sorted = [...new Set(ids)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  if (sorted.length !== ids.length) throw new Error("usageEventIdsSha256: duplicate provider response id in one run");
  return `sha256:${createHash("sha256").update(sorted.join("\n"), "utf8").digest("hex")}` as Sha256;
}

// ------------------------------------------------------------------------------------------------ Merkle (P-3, P-4)

const hash = (...parts: Uint8Array[]) => {
  const h = createHash("sha256");
  for (const p of parts) h.update(p);
  return new Uint8Array(h.digest());
};
const LEAF = Uint8Array.of(0);
const NODE = Uint8Array.of(1);
const hex = (b: Uint8Array) => `sha256:${Buffer.from(b).toString("hex")}` as Sha256;

function leafBytes(value: unknown): Uint8Array {
  return hash(LEAF, new TextEncoder().encode(canonicalJson(value)));
}

export function claimLeafHash(leaf: ClaimLeaf): Sha256 {
  return hex(leafBytes(ClaimLeaf.parse(leaf)));
}

export interface MerkleTree {
  root: Sha256;
  levels: Uint8Array[][];
}

export function merkleFromLeafHashes(leaves: readonly Uint8Array[]): MerkleTree {
  if (leaves.length === 0) return { root: hex(hash()), levels: [[]] };
  const levels: Uint8Array[][] = [[...leaves]];
  while (levels[levels.length - 1]!.length > 1) {
    const cur = levels[levels.length - 1]!;
    const next: Uint8Array[] = [];
    for (let i = 0; i < cur.length; i += 2) next.push(i + 1 < cur.length ? hash(NODE, cur[i]!, cur[i + 1]!) : cur[i]!);
    levels.push(next);
  }
  return { root: hex(levels[levels.length - 1]![0]!), levels };
}

/** Builds the allocation tree. Leaves must have indexes 0..n-1 exactly once. */
export function allocationTree(leaves: readonly ClaimLeaf[]): MerkleTree {
  const parsed = leaves.map((l) => ClaimLeaf.parse(l)).sort((a, b) => a.index - b.index);
  parsed.forEach((l, i) => {
    if (l.index !== i) throw new Error(`allocationTree: leaf indexes must be 0..n-1, found ${l.index} at ${i}`);
  });
  return merkleFromLeafHashes(parsed.map((l) => leafBytes(l)));
}

export function receiptsRoot(entries: readonly EpochManifestEntry[]): Sha256 {
  const parsed = entries
    .map((e) => EpochManifestEntry.parse(e))
    .sort((a, b) => (a.receiptId < b.receiptId ? -1 : a.receiptId > b.receiptId ? 1 : 0));
  return merkleFromLeafHashes(parsed.map((e) => leafBytes(e))).root;
}

export interface MerkleProofStep {
  side: "left" | "right";
  hash: Sha256;
}

export function merkleProof(tree: MerkleTree, index: number): MerkleProofStep[] {
  const proof: MerkleProofStep[] = [];
  let i = index;
  for (let lv = 0; lv < tree.levels.length - 1; lv++) {
    const level = tree.levels[lv]!;
    const sib = i % 2 === 0 ? i + 1 : i - 1;
    if (sib < level.length) proof.push({ side: i % 2 === 0 ? "right" : "left", hash: hex(level[sib]!) });
    i = Math.floor(i / 2);
  }
  return proof;
}

export function verifyClaimLeaf(leaf: ClaimLeaf, proof: readonly MerkleProofStep[], root: Sha256): boolean {
  let acc = leafBytes(ClaimLeaf.parse(leaf));
  for (const step of proof) {
    const sib = new Uint8Array(Buffer.from(step.hash.slice(7), "hex"));
    acc = step.side === "right" ? hash(NODE, acc, sib) : hash(NODE, sib, acc);
  }
  return hex(acc) === root;
}
