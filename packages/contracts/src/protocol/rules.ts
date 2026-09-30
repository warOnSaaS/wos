/**
 * DRAFT v5 (engine-first enforcement, D51) — the protocol's write-time RULES as pure functions.
 *
 * Migration 0007 keeps only hard invariants that must hold even if the application is buggy (append-only records,
 * uniqueness, conservation at commit, reviewer independence, serialized epoch publication, budget immutability after a
 * lease; docs/protocol/PROTOCOL.md §12). Everything else — qualification chains, authorization of admin actions,
 * dispute and confiscation procedure, entitlement planning, claims, budget bounds, wallet binding, Genesis rules — is
 * decided HERE. The service layer is contractually required to call the matching function with the rows it read,
 * inside the same transaction, and to write nothing when it returns a refusal. Each function returns the list of
 * refusals (empty = allowed). Pure, deterministic, no clock: the caller passes server time (`nowMs`).
 *
 * Every repro of Astra reviews 02 and 03 that no longer has a SQL guard has a test here (packages/contracts/test/
 * protocol-rules.test.ts); REVIEW-PACKET §3e maps each repro to its guard.
 */

const H = 3_600_000;

// ------------------------------------------------------------------------------------------------ admin actions (H12, A3-7)

export interface AdminActionRow {
  id: string;
  action: string;
  targetKind: string;
  targetId: string;
  /** The exact operation the action authorizes. */
  payload: Record<string, unknown>;
  requiresCoSigner: boolean;
  coSignerAccountId: string | null;
  operationSha256: string;
}

/** Canonical JSON equality for payload binding (key order irrelevant). */
function sameJson(a: unknown, b: unknown): boolean {
  const norm = (v: unknown): unknown =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(
          Object.entries(v as Record<string, unknown>)
            .sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0))
            .map(([k, x]) => [k, norm(x)]),
        )
      : Array.isArray(v)
        ? v.map(norm)
        : v;
  return JSON.stringify(norm(a)) === JSON.stringify(norm(b));
}

/**
 * A consuming mutation must cite an action of an allowed kind, targeting exactly this row, whose payload IS the
 * operation, separately approved by the named co-signer when two-person, and never used before.
 */
export function adminAuthorizationRefusals(
  a: AdminActionRow | null,
  need: { kinds: readonly string[]; targetKind: string; targetId: string; operation?: Record<string, unknown> },
  ctx: { approval: { approverAccountId: string; operationSha256: string } | null; alreadyUsed: boolean },
): string[] {
  if (!a) return ["no admin action cited"];
  const r: string[] = [];
  if (!need.kinds.includes(a.action) || a.targetKind !== need.targetKind || a.targetId !== need.targetId)
    r.push(`admin action does not authorize ${need.kinds.join("|")} on ${need.targetKind}/${need.targetId}`);
  if (need.operation && !sameJson(a.payload, need.operation)) r.push("admin action authorizes another operation (payload differs)");
  if (
    a.requiresCoSigner &&
    (!ctx.approval || ctx.approval.approverAccountId !== a.coSignerAccountId || ctx.approval.operationSha256 !== a.operationSha256)
  )
    r.push("no separate co-signer approval of this exact operation");
  if (ctx.alreadyUsed) r.push("admin action already used (one action, one mutation)");
  return r;
}

// ------------------------------------------------------------------------------------------------ qualification (H7, A3-5)

export interface QualificationEvidence {
  subjectKind: "attempt" | "document";
  subjectId: string;
  revision: string;
  lease: {
    id: string;
    generation: number;
    accountId: string;
    taskKind: string;
    taskAttemptId: string | null;
    taskAbuId: string | null;
    taskDocumentId: string | null;
    issuedAtMs: number;
    hardDeadlineAtMs: number;
    endedAtMs: number | null;
  };
  citedGeneration: number;
  changeset: { leaseId: string; ok: boolean; signatureValid: boolean; createdAtMs: number; submissionSha256: string } | null;
  attempt?: { id: string; accountId: string; abuId: string; maxLifetimeAtMs: number };
  round: {
    state: string;
    outcome: string | null;
    headSha: string;
    submissionSha256: string;
    attemptId: string | null;
    documentId: string | null;
    reviewVerdicts: ReadonlyArray<{ slot: string; verdict: string }>;
  } | null;
  greenCiAtHead: boolean;
  snapshotRequiresHuman: boolean;
  humanPreMergePassOnRound: boolean;
}

export function qualificationRefusals(q: QualificationEvidence): string[] {
  const r: string[] = [];
  const l = q.lease;
  const c = q.changeset;
  if (l.generation !== q.citedGeneration) r.push("stale lease generation");
  if (
    !c ||
    c.leaseId !== l.id ||
    !c.ok ||
    !c.signatureValid ||
    c.createdAtMs < l.issuedAtMs ||
    c.createdAtMs > l.hardDeadlineAtMs ||
    (l.endedAtMs !== null && c.createdAtMs > l.endedAtMs)
  )
    r.push("the changeset was not accepted on this lease while it was valid");
  if (q.subjectKind === "attempt") {
    const a = q.attempt;
    if (
      !a ||
      l.accountId !== a.accountId ||
      !(l.taskAttemptId === a.id || (l.taskKind === "abu_build" && l.taskAbuId === a.abuId)) ||
      (c && c.createdAtMs > a.maxLifetimeAtMs)
    )
      r.push("the changeset belongs to another attempt, or the attempt's hard lifetime had passed");
    if (!q.greenCiAtHead) r.push("an implementation qualifies only with green CI at the qualified head");
  } else if (!(l.taskDocumentId === q.subjectId && (l.taskKind === "roadmap_author" || l.taskKind === "feature_author"))) {
    r.push("a document qualification cites the document's own author lease");
  }
  const rd = q.round;
  const both = rd ? new Set(rd.reviewVerdicts.filter((v) => v.verdict === "NO_MATERIAL_GAPS").map((v) => v.slot)).size === 2 : false;
  const anyGap = rd ? rd.reviewVerdicts.some((v) => v.verdict !== "NO_MATERIAL_GAPS") : true;
  const ofSubject = rd ? (q.subjectKind === "attempt" ? rd.attemptId === q.subjectId : rd.documentId === q.subjectId) : false;
  if (
    !rd ||
    rd.state !== "revealed" ||
    rd.outcome !== "consensus" ||
    rd.headSha !== q.revision ||
    !c ||
    rd.submissionSha256 !== c.submissionSha256 ||
    !ofSubject ||
    !both ||
    anyGap
  )
    r.push("needs the revealed consensus round of this subject at this revision (both seats passing)");
  if (q.snapshotRequiresHuman && !q.humanPreMergePassOnRound) r.push("the pinned policy requires a human pre-merge PASS on this round");
  return r;
}

// ------------------------------------------------------------------------------------------------ receipts (H7, D49)

export function receiptRefusals(x: {
  consentAccepted: boolean;
  epochState: string | null;
  cluster: "devnet" | "mainnet-beta";
  contributionType: string;
  subjectKind: string;
  attemptMerged: boolean;
  qualificationOk: boolean;
  needsQualification: boolean;
  evidenceClass: "accepted_budget" | "outcome";
  weightMicro: bigint;
  budget: { amountMicro: bigint; kind: string; released: boolean; expiresEpoch: number } | null;
  slice: string;
  admittedEpoch: number;
  shareBp: number | null;
  sharesAlreadyDeclaredBp: number;
  usage: { allOwnAndThisLease: boolean; anyAttributedElsewhere: boolean };
}): string[] {
  const r: string[] = [];
  if (!x.consentAccepted) r.push("the contributor has not accepted the publication disclosure (D47)");
  if (x.epochState !== "OPEN") r.push("receipts are admitted only to an OPEN epoch");
  if (x.cluster === "mainnet-beta") r.push("mainnet epochs admit no receipts in this draft (readiness gate)");
  if (x.contributionType === "IMPLEMENTATION" && (x.subjectKind !== "attempt" || !x.attemptMerged))
    r.push("IMPLEMENTATION needs a merged attempt");
  if (x.needsQualification && !x.qualificationOk) r.push("needs a qualification of its subject on its lease generation");
  if (x.evidenceClass === "accepted_budget") {
    const b = x.budget;
    if (!b) r.push("no task budget");
    else {
      if (b.released || x.admittedEpoch > b.expiresEpoch) r.push("the task budget was released or expired");
      if (x.weightMicro !== b.amountMicro || x.slice !== b.kind) r.push("the receipt carries its task budget, never a usage figure");
    }
    if (x.shareBp === null || x.sharesAlreadyDeclaredBp + x.shareBp > 10_000) r.push("declared shares exceed 10000 bp");
  }
  if (!x.usage.allOwnAndThisLease) r.push("telemetry usage receipts must be the contributor's own, of this lease");
  if (x.usage.anyAttributedElsewhere) r.push("a usage receipt already backs another contribution");
  return r;
}

// ------------------------------------------------------------------------------------------------ budgets (D49)

export function budgetRefusals(x: {
  budgetMicro: bigint;
  modelMicro: bigint;
  humanAboveBp: number;
  hardMaxBp: number;
  justification: string;
  approvalRefusals: string[] | null;
  objectiveBudgetMicro: bigint;
  objectiveUsedMicro: bigint;
  epochOpenWithRate: boolean;
  cluster: "devnet" | "mainnet-beta";
}): string[] {
  const r: string[] = [];
  if (!x.epochOpenWithRate) r.push("tasks are issued only in an OPEN epoch with a pinned issuance rate and task capacity");
  if (x.cluster === "mainnet-beta") r.push("no task is issued on mainnet in this draft");
  if (x.budgetMicro <= 0n) r.push("a budget is positive");
  if (x.budgetMicro * 10_000n > x.modelMicro * BigInt(x.hardMaxBp)) r.push("budget exceeds the hard maximum of the model");
  else if (x.budgetMicro * 10_000n > x.modelMicro * BigInt(x.humanAboveBp)) {
    if (x.justification.trim().length < 40) r.push("a budget above the model needs a written justification");
    if (x.approvalRefusals === null || x.approvalRefusals.length > 0)
      r.push("a budget above the model needs a two-person approve_budget action");
  }
  if (x.objectiveUsedMicro + x.budgetMicro > x.objectiveBudgetMicro)
    r.push("task budgets under the objective would exceed its budget (splitting cannot raise the total)");
  return r;
}

// ------------------------------------------------------------------------------------------------ disputes (H10, D43, A3-3)

export interface Adjudication {
  finalAmount: bigint | null;
  isFinal: boolean;
}

/** The ONE effective final amount of an allocation (A3-3). */
export function allocationAdjudication(x: {
  proposedAmount: bigint;
  gated: boolean;
  resolution: { resultingAmount: bigint; resolvedAtMs: number } | null;
  appealFiled: boolean;
  appealDecision: { finalAmount: bigint } | null;
  appealHours: number;
  nowMs: number;
}): Adjudication {
  if (!x.gated) return { finalAmount: x.proposedAmount, isFinal: true };
  if (!x.resolution) return { finalAmount: null, isFinal: false };
  if (x.appealDecision) return { finalAmount: x.appealDecision.finalAmount, isFinal: true };
  if (x.appealFiled) return { finalAmount: x.resolution.resultingAmount, isFinal: false };
  return { finalAmount: x.resolution.resultingAmount, isFinal: x.nowMs >= x.resolution.resolvedAtMs + x.appealHours * H };
}

export function disputeOpenRefusals(x: {
  epochState: string | null;
  nowMs: number;
  proposedAtMs: number;
  challengeHours: number;
  disputerPendingBase: bigint;
  disputerStakesAlreadyBase: bigint;
  disputesAlready: number;
  maxDisputes: number;
  items: ReadonlyArray<{
    allocationAccountId: string | null;
    allocationBeneficiaryId: string;
    allocationEpoch: number;
    alreadyResolved: boolean;
  }>;
  disputerAccountId: string;
  epochNumber: number;
  maxItems: number;
  stakeBase: bigint;
  expectedStakeBase: bigint;
}): string[] {
  const r: string[] = [];
  if (x.epochState !== "PROPOSED" || x.nowMs >= x.proposedAtMs + x.challengeHours * H)
    r.push("disputes are accepted only while the epoch is PROPOSED and its window is open");
  if (x.disputerPendingBase <= 0n) r.push("only participants of the epoch may dispute its allocations");
  if (x.disputesAlready >= x.maxDisputes) r.push("dispute rate limit reached");
  if (x.items.length < 1 || x.items.length > x.maxItems) r.push(`a dispute carries 1..${x.maxItems} items, frozen at submission`);
  if (x.stakeBase <= 0n || x.stakeBase !== x.expectedStakeBase) r.push("stake must equal the per-item stake times the items");
  if (x.disputerStakesAlreadyBase + x.stakeBase > x.disputerPendingBase)
    r.push("the stakes of all your disputes in the epoch would exceed your pending allocations");
  for (const it of x.items) {
    if (it.allocationEpoch !== x.epochNumber) r.push("a dispute covers allocations of its own epoch only");
    if (it.allocationAccountId === x.disputerAccountId || it.allocationBeneficiaryId === x.disputerAccountId)
      r.push("one cannot dispute one's own allocation");
    if (it.alreadyResolved) r.push("allocation is already resolved");
  }
  return r;
}

export function appealDecisionRefusals(x: {
  decision: "confirmed" | "reversed";
  finalAmount: bigint;
  resultingAmount: bigint;
  proposedAmount: bigint;
}): string[] {
  if (x.decision === "confirmed" && x.finalAmount !== x.resultingAmount) return ["a confirmed appeal keeps the resolution's amount"];
  if (x.decision === "reversed" && (x.finalAmount === x.resultingAmount || x.finalAmount > x.proposedAmount))
    return ["a reversed appeal sets another amount within the proposal"];
  return [];
}

/** Settlement is DERIVED from the effective final adjudication of every item (A3-3). */
export function disputeSettlementDerived(x: {
  items: ReadonlyArray<{
    proposedAmount: bigint;
    adjudication: Adjudication;
    stakeBase: bigint;
    recoveredBase: bigint;
    heldPriority: boolean;
  }>;
  bountyBpOfRecovered: number;
}): { refusals: string[]; excess: bigint; recovered: bigint; forfeited: bigint; maxBounty: bigint } {
  const refusals: string[] = [];
  let excess = 0n;
  let recovered = 0n;
  let forfeited = 0n;
  for (const it of x.items) {
    if (!it.adjudication.isFinal || it.adjudication.finalAmount === null) {
      refusals.push("every item must be finally adjudicated (appeal decided or its window closed) before settlement");
      continue;
    }
    const e = it.proposedAmount - it.adjudication.finalAmount;
    if (it.heldPriority) {
      excess += e;
      recovered += it.recoveredBase < e ? it.recoveredBase : e;
    }
    if (e === 0n) forfeited += it.stakeBase;
  }
  return { refusals, excess, recovered, forfeited, maxBounty: (recovered * BigInt(x.bountyBpOfRecovered)) / 10_000n };
}

// ------------------------------------------------------------------------------------------------ entitlements and claims (A3-1, A3-2)

export function entitlementRefusals(x: {
  epochState: string | null;
  kind: string;
  sourceKind: string;
  sameEpochModeBeneficiary: boolean;
  adjudication: Adjudication | null;
  heldOnSource: bigint;
  entitledFromSource: bigint;
  releaseFromSource: bigint;
  amount: bigint;
  holdbackBp: number;
  tranche?: { maturesEpoch: number; remaining: bigint };
  epochNumber: number;
  reservedStakeBase: bigint;
  contributorAvailableBase: bigint;
  contributorEntitledBase: bigint;
  bounty?: { toDisputer: boolean; bountyBase: bigint; alreadyBase: bigint };
}): string[] {
  const r: string[] = [];
  if (!["FINALIZED", "DISTRIBUTABLE", "CLOSED"].includes(x.epochState ?? "")) r.push("entitlements exist only once the epoch is FINALIZED");
  if (x.kind === "genesis_vesting") r.push("Genesis vesting comes only from the Genesis finalization (mainnet-only)");
  if (x.sourceKind === "allocation") {
    if (!x.sameEpochModeBeneficiary) r.push("an entitlement names an allocation of its own epoch, mode and beneficiary");
    if (!x.adjudication?.isFinal || x.adjudication.finalAmount === null)
      r.push("allocation is not final (dispute gate or appeal window open)");
    else {
      const avail = x.adjudication.finalAmount - x.heldOnSource;
      if (x.entitledFromSource + x.amount > avail) r.push("entitlements would exceed the allocation's remaining balance");
      if (x.kind !== "holdback_tranche" && x.releaseFromSource + x.amount > avail - (avail * BigInt(x.holdbackBp)) / 10_000n)
        r.push("release would dip into the holdback share");
    }
    if (x.reservedStakeBase > 0n && x.contributorEntitledBase + x.amount > x.contributorAvailableBase - x.reservedStakeBase)
      r.push("part of the epoch's allocations is reserved as dispute stake");
  } else if (x.sourceKind === "tranche") {
    if (!x.tranche) r.push("a matured release must name a tranche of the same beneficiary");
    else {
      if (x.epochNumber < x.tranche.maturesEpoch) r.push(`the tranche matures in epoch ${x.tranche.maturesEpoch}`);
      if (x.amount !== x.tranche.remaining) r.push("a matured release is exactly the tranche's remaining balance");
    }
  } else if (x.sourceKind === "dispute_settlement") {
    if (!x.bounty?.toDisputer || x.bounty.alreadyBase + x.amount > x.bounty.bountyBase)
      r.push("a bounty entitlement is the settlement's bounty, to its disputer");
  }
  return r;
}

export function claimRefusals(x: {
  entitlementKind: string;
  sameBeneficiary: boolean;
  entitlementCluster: string;
  leafCluster: string;
  leafFrozen: boolean;
  remaining: bigint;
  amount: bigint;
}): string[] {
  const r: string[] = [];
  if (x.leafCluster === "mainnet-beta") r.push("mainnet settlement is closed in this draft (readiness gate)");
  if (x.entitlementKind === "holdback_tranche") r.push("a holdback tranche is claimable only through its matured release");
  if (!x.sameBeneficiary) r.push("entitlement and leaf beneficiaries differ");
  if (x.entitlementCluster !== x.leafCluster) r.push("entitlement and leaf are in different settlement domains");
  if (x.leafFrozen) r.push("leaf is frozen (void, or already signed)");
  if (x.amount !== x.remaining || x.amount <= 0n) r.push("a claim takes the entitlement's whole remaining balance");
  return r;
}

// ------------------------------------------------------------------------------------------------ confiscation (D39, A3-4)

export function confiscationNoticeRefusals(x: { nowMs: number; replyClosesAtMs: number; appealClosesAtMs: number }): string[] {
  return x.replyClosesAtMs < x.nowMs + 72 * H || x.appealClosesAtMs < x.replyClosesAtMs + 168 * H
    ? ["confiscation needs >= 72 h reply and >= 168 h appeal windows after notice"]
    : [];
}

export function confiscationAppealRefusals(x: {
  appellantIsAffectedBeneficiary: boolean;
  nowMs: number;
  appealClosesAtMs: number;
}): string[] {
  const r: string[] = [];
  if (!x.appellantIsAffectedBeneficiary) r.push("only the affected beneficiary appeals a confiscation");
  if (x.nowMs > x.appealClosesAtMs) r.push("the confiscation appeal window has closed");
  return r;
}

export function confiscationDecisionRefusals(x: {
  appealFiled: boolean;
  nowMs: number;
  replyClosesAtMs: number;
  authorizationRefusals: string[];
}): string[] {
  const r: string[] = [];
  if (!x.appealFiled) r.push("no appeal was filed (without one, the confiscation executes after the appeal window)");
  r.push(...x.authorizationRefusals);
  if (x.nowMs < x.replyClosesAtMs) r.push("a confiscation appeal is decided only after the reply window closes");
  return r;
}

export function confiscationExecutionRefusals(x: {
  nowMs: number;
  appealClosesAtMs: number;
  holdExpiresAtMs: number;
  appealFiled: boolean;
  decision: "upheld" | "overturned" | null;
}): string[] {
  const ok =
    x.nowMs < x.holdExpiresAtMs &&
    x.decision !== "overturned" &&
    (x.decision === "upheld" || (!x.appealFiled && x.nowMs >= x.appealClosesAtMs));
  return ok ? [] : ["confiscation executes only after the appeal window (no appeal) or an upheld appeal, before its hold lapses"];
}

export function confiscationHoldRefusals(x: {
  holdActive: boolean;
  executed: boolean;
  alreadyHeldBase: bigint;
  amount: bigint;
  provenExcessBase: bigint;
  sourceBeneficiaryMatches: boolean;
  sourceRemaining: bigint;
  sourceKindFits: boolean;
}): string[] {
  const r: string[] = [];
  if (!x.holdActive || x.executed) r.push("confiscation is overturned, lapsed or already executed");
  if (x.alreadyHeldBase + x.amount > x.provenExcessBase) r.push("confiscation never exceeds the proven excess");
  if (!x.sourceBeneficiaryMatches || !x.sourceKindFits || x.sourceRemaining < x.amount)
    r.push("the source is not an unreleased, unclaimed balance of this beneficiary with enough remaining");
  return r;
}

// ------------------------------------------------------------------------------------------------ audits (H8, A3-6)

export function auditVerdictRefusals(x: {
  quorumRevealed: boolean;
  assignment: {
    quorumId: string;
    slot: number;
    packetSha256: string;
    reviewerAccountId: string;
    taskId: string;
    leaseId: string;
    permittedProvider: string;
    leaseGeneration: number;
  } | null;
  verdict: {
    quorumId: string;
    slot: number;
    packetSha256: string;
    reviewerAccountId: string;
    taskId: string;
    leaseId: string;
    provider: string;
  };
  lease: { active: boolean; generation: number; expiresAtMs: number; hardDeadlineAtMs: number };
  run: { leaseId: string; signatureValid: boolean; provider: string; alreadyUsed: boolean };
  nowMs: number;
}): string[] {
  const r: string[] = [];
  const a = x.assignment;
  const v = x.verdict;
  if (x.quorumRevealed) r.push("quorum is already revealed");
  if (
    !a ||
    a.quorumId !== v.quorumId ||
    a.slot !== v.slot ||
    a.packetSha256 !== v.packetSha256 ||
    a.reviewerAccountId !== v.reviewerAccountId ||
    a.taskId !== v.taskId ||
    a.leaseId !== v.leaseId ||
    a.permittedProvider !== v.provider
  )
    r.push("a verdict must redeem its own assignment (quorum, slot, packet, reviewer, task, lease, provider)");
  if (
    !x.lease.active ||
    (a && x.lease.generation !== a.leaseGeneration) ||
    x.lease.expiresAtMs <= x.nowMs ||
    x.lease.hardDeadlineAtMs <= x.nowMs ||
    x.run.leaseId !== v.leaseId ||
    !x.run.signatureValid ||
    x.run.provider !== v.provider
  )
    r.push("needs the assigned lease, still valid, and a signed run of it by the permitted provider");
  if (x.run.alreadyUsed) r.push("a run is used once");
  return r;
}

export function auditAssignmentRefusals(x: {
  quorumRevealed: boolean;
  slot: number;
  size: number;
  ownPayoutAuditLease: boolean;
  taskAlreadyAssigned: boolean;
  lastSeatWithoutSecondProvider: boolean;
  outsideFeature: boolean;
  reviewerHasReceiptsOnFeature: boolean;
}): string[] {
  const r: string[] = [];
  if (x.quorumRevealed || x.slot > x.size) r.push("quorum revealed or slot out of range");
  if (!x.ownPayoutAuditLease) r.push("an assignment names the reviewer's own payout_audit task and lease generation");
  if (x.taskAlreadyAssigned) r.push("one audit task is assigned once");
  if (x.lastSeatWithoutSecondProvider) r.push("the last seat of a quorum must add a second provider");
  if (x.outsideFeature && x.reviewerHasReceiptsOnFeature)
    r.push("an auditor with receipts on this feature cannot fill an outside-feature seat");
  return r;
}

// ------------------------------------------------------------------------------------------------ wallets, votes, pools, Genesis

export function walletBindingRefusals(x: {
  consentAccepted: boolean;
  messageNamesAll: boolean;
  orgBindingByOwnerOrAdmin: boolean | null;
}): string[] {
  const r: string[] = [];
  if (!x.consentAccepted) r.push("accept the publication disclosure before binding a wallet (D47)");
  if (!x.messageNamesAll) r.push("the signed message must name the wallet, the account and (for orgs) the organization");
  if (x.orgBindingByOwnerOrAdmin === false) r.push("only an owner or admin binds an organization wallet");
  return r;
}

export function voteRefusals(x: { nowMs: number; opensAtMs: number; closesAtMs: number; hasSnapshotWeight: boolean }): string[] {
  const r: string[] = [];
  if (!(x.nowMs >= x.opensAtMs && x.nowMs < x.closesAtMs)) r.push("voting is closed");
  if (!x.hasSnapshotWeight) r.push("the account has no weight in the snapshot");
  return r;
}

export function poolEventRefusals(x: { event: "payable" | "paid" | "returned"; alreadyPayable: boolean }): string[] {
  return x.event === "paid" && !x.alreadyPayable ? ["a pool is paid only after it became payable"] : [];
}

export function genesisContributionRefusals(x: {
  relatedToReferencePopulation: boolean;
  commitShasInEvidence: readonly string[];
  claimedCommitShas: readonly string[];
  evidenceKind: string;
}): string[] {
  const r: string[] = [];
  if (x.relatedToReferencePopulation) r.push("a Genesis beneficiary cannot be (related to) a member of the reference population");
  const claimed = new Set(x.claimedCommitShas);
  if (x.commitShasInEvidence.some((c) => !claimed.has(c)) || (x.evidenceKind === "git_commit" && claimed.size === 0))
    r.push("commit evidence without its canonical commit mapping");
  return r;
}

export function genesisCommitClaimRefusals(x: { isMergedLiveAttempt: boolean }): string[] {
  return x.isMergedLiveAttempt ? ["a merged live attempt is live work, not Genesis"] : [];
}

export function genesisReferenceManifestRefusals(x: {
  receipts: ReadonlyArray<{ exists: boolean; status: string | null; admittedEpoch: number; relatedToGenesisBeneficiary: boolean }>;
  cutoffEpoch: number;
  approvalRefusals: string[];
}): string[] {
  const r: string[] = [...x.approvalRefusals];
  if (x.receipts.some((c) => !c.exists || c.admittedEpoch > x.cutoffEpoch || !(c.status === "ACTIVE" || c.status === "RATIFIED")))
    r.push("every reference receipt exists, is ACTIVE or RATIFIED, and was admitted by the cutoff");
  if (x.receipts.some((c) => c.relatedToGenesisBeneficiary))
    r.push("a Genesis beneficiary or related party cannot be in the reference population");
  return r;
}

export function settlementResumeRefusals(x: { safetyConfirmation: string | null }): string[] {
  return (x.safetyConfirmation ?? "").trim().length < 20 ? ["resuming needs an explicit safety confirmation (D46)"] : [];
}

// ------------------------------------------------------------------------------------------------ reviews, gates, status

export function quorumRatifyRefusals(x: {
  size: number;
  plausibleOutsideFeature: number;
  openInflationOrAttributionFindings: number;
}): string[] {
  const r: string[] = [];
  if (x.plausibleOutsideFeature < x.size) r.push("the quorum lacks enough outside-feature plausible judgments");
  if (x.openInflationOrAttributionFindings > 0) r.push("the quorum has an open inflation or attribution finding");
  return r;
}

export function humanReviewRefusals(x: {
  reviewerGrantedRiskClasses: readonly string[] | null;
  riskClass: string;
  purpose: "pre_merge" | "ratification_signoff" | "audit";
  round: { ofThisSubject: boolean; headSha: string; submissionSha256: string } | null;
  headSha: string | null;
  submissionSha256: string | null;
}): string[] {
  const r: string[] = [];
  if (!x.reviewerGrantedRiskClasses?.includes(x.riskClass)) r.push("the reviewer is not authorized for this risk class");
  if (
    x.purpose === "pre_merge" &&
    (!x.round || !x.round.ofThisSubject || x.round.headSha !== x.headSha || x.round.submissionSha256 !== x.submissionSha256)
  )
    r.push("a pre-merge human review is bound to a round of this subject, its head sha and submission hash");
  return r;
}

export function resolutionRefusals(x: {
  resultingAmount: bigint;
  excess: bigint;
  proposedAmount: bigint;
  nowMs: number;
  replyDeadlineAtMs: number;
  replied: boolean;
}): string[] {
  const r: string[] = [];
  if (x.resultingAmount + x.excess !== x.proposedAmount) r.push("resulting amount + excess must equal the proposed amount");
  if (x.nowMs < x.replyDeadlineAtMs && !x.replied) r.push("a gate resolves after the reply (or its window)");
  return r;
}

export function disputeReplyRefusals(x: { replierIsAccused: boolean; nowMs: number; replyDeadlineAtMs: number }): string[] {
  const r: string[] = [];
  if (!x.replierIsAccused) r.push("only the accused may reply");
  if (x.nowMs > x.replyDeadlineAtMs) r.push("the right-of-reply window has closed");
  return r;
}

export function disputeAppealRefusals(x: {
  appellantIsAccusedOrPriorityDisputer: boolean;
  nowMs: number;
  resolvedAtMs: number;
  appealHours: number;
}): string[] {
  const r: string[] = [];
  if (!x.appellantIsAccusedOrPriorityDisputer) r.push("only the accused or the priority disputer may appeal");
  if (x.nowMs > x.resolvedAtMs + x.appealHours * H) r.push("the appeal window has closed");
  return r;
}

/** A dispute-driven revocation needs the FINAL REVOKED resolution of an allocation of this receipt (A3-7). */
export function disputeRevocationRefusals(x: {
  resolutionOutcome: string | null;
  allocationOfThisReceipt: boolean;
  adjudication: Adjudication | null;
}): string[] {
  return x.resolutionOutcome === "REVOKED" && x.allocationOfThisReceipt && x.adjudication?.isFinal && x.adjudication.finalAmount === 0n
    ? []
    : ["a dispute revokes a receipt only through its final REVOKED resolution"];
}

// ------------------------------------------------------------------------------------------------ further write rules moved from 0007 v4

/** An allocation line uses its receipt's slice, contributor and one of the receipt's beneficiaries (repro C, H2). */
export function allocationLineRefusals(x: {
  receiptSlice: string;
  receiptAccountId: string;
  allowedBeneficiaries: readonly string[];
  line: { slice: string; accountId: string | null; beneficiaryId: string };
  manifestIncluded: boolean;
  modeMatchesEpoch: boolean;
}): string[] {
  const r: string[] = [];
  if (!x.manifestIncluded) r.push("the receipt is not included in this epoch's manifest");
  if (!x.modeMatchesEpoch) r.push("allocation mode differs from its epoch");
  if (x.line.slice !== x.receiptSlice || x.line.accountId !== x.receiptAccountId || !x.allowedBeneficiaries.includes(x.line.beneficiaryId))
    r.push("an allocation uses its receipt's slice, contributor and beneficiary");
  return r;
}

export function manifestEntryRefusals(x: {
  status: string | null;
  epochMode: "test" | "live";
  entryMode: string;
  sameCluster: boolean;
  mainnet: boolean;
}): string[] {
  const r: string[] = [];
  if (x.entryMode !== x.epochMode) r.push("manifest mode differs from epoch mode");
  if (!(x.status === "ACTIVE" || x.status === "RATIFIED" || (x.epochMode === "test" && x.status !== "REVOKED" && x.status !== null)))
    r.push(`a ${x.status} receipt cannot be included in a ${x.epochMode} epoch`);
  if (!x.sameCluster || x.mainnet) r.push("the receipt was admitted to another settlement domain, or mainnet is closed");
  return r;
}

export function sponsorshipRefusals(x: {
  approverIsOwnerOrAdmin: boolean;
  organizationIsPersonal: boolean;
  contributorHasActiveLink: boolean;
}): string[] {
  const r: string[] = [];
  if (!x.approverIsOwnerOrAdmin) r.push("a sponsorship must be approved by an owner or admin of the organization");
  if (x.organizationIsPersonal) r.push("a personal organization cannot sponsor contributions");
  if (x.contributorHasActiveLink) r.push("a contributor has at most one active sponsorship");
  return r;
}

export function usageReceiptRefusals(x: {
  leaseGenerationMatches: boolean;
  leaseAccountMatches: boolean;
  signedRunOfLease: boolean;
  citesLeaseSnapshot: boolean;
  responseIdSeenBefore: boolean;
}): string[] {
  const r: string[] = [];
  if (!x.leaseGenerationMatches || !x.leaseAccountMatches) r.push("usage receipt does not match its lease generation or account");
  if (!x.signedRunOfLease) r.push("usage receipt needs a validly signed agent run of the same lease");
  if (!x.citesLeaseSnapshot) r.push("usage receipt must cite the run-policy snapshot of its lease");
  if (x.responseIdSeenBefore) r.push("a replayed provider response id (also a key in 0007)");
  return r;
}

export function clipRefusals(x: { newWeightMicro: bigint; currentWeightMicro: bigint; authorizationRefusals: string[] }): string[] {
  const r = [...x.authorizationRefusals];
  if (x.newWeightMicro > x.currentWeightMicro) r.push("a clip never raises a receipt's weight");
  return r;
}

export function auditOutcomePublishRefusals(x: { quorumRevealed: boolean; isCanary: boolean; sameReceiptAndOutcome: boolean }): string[] {
  return x.quorumRevealed && !x.isCanary && x.sameReceiptAndOutcome ? [] : ["only a revealed real quorum's outcome is published"];
}

export function dutyEventRefusals(x: { seq: number; offeredToSameAccount: boolean; kind: string; hasDeadline: boolean }): string[] {
  const r: string[] = [];
  if (x.seq > 1 && !x.offeredToSameAccount) r.push("a duty offer ends for the account it was offered to");
  if (x.kind === "offered" && !x.hasDeadline) r.push("an offer carries a deadline");
  return r;
}

export function exclusionRefusals(x: {
  permanent: boolean;
  governanceDecision: boolean;
  bootstrapMode: boolean;
  authorizationRefusals: string[];
}): string[] {
  const r = [...x.authorizationRefusals];
  if (x.permanent && !x.governanceDecision && !x.bootstrapMode) r.push("a permanent exclusion needs a governance decision");
  return r;
}

export function adapterEventRefusals(x: {
  action: "activate" | "pause" | "resume" | "retire";
  firstEvent: boolean;
  governanceDecision: boolean;
  authorizationRefusals: string[];
}): string[] {
  const r = [...x.authorizationRefusals];
  if ((x.action === "activate" || x.action === "retire") && !x.firstEvent && !x.governanceDecision)
    r.push("switching or retiring an adapter needs a governance decision");
  return r;
}

export function genesisDedupRefusals(x: { dedupSource: "receipt" | "genesis" | null; authorizationRefusals: string[] }): string[] {
  const r = [...x.authorizationRefusals];
  if (x.dedupSource !== "genesis") r.push("a Genesis contribution uses a genesis dedup key");
  return r;
}
