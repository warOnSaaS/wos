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

import { canonicalSha256 } from "../canonical.js";
import { largestRemainder } from "./engine.js";
import { RunPolicySnapshot } from "./entities.js";

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
 * Review 04 finding 9: the canonical operation of each consumer — every field that affects authority, money or
 * duration, and the expected prior state where a stale approval matters. A consumer must pass ALL of them as
 * `operation`; the approved payload must equal it. Kind and target alone authorize only operations they fully identify.
 */
export const CANONICAL_OPERATION_FIELDS = {
  reviewer_grant: ["accountId", "action", "domains", "level", "contributionTypes", "riskClasses"],
  epoch_transition: ["epochNumber", "fromState", "toState"],
  confiscation: ["beneficiaryKind", "beneficiaryId", "provenExcessBase", "findingRef", "replyClosesAt", "appealClosesAt", "holdExpiresAt"],
  dispute_resolution: ["allocationId", "outcome", "resultingAmountBase", "excessBase", "recoveredBase"],
  appeal_decision: ["allocationId", "decision", "finalAmountBase"],
  adapter_event: ["action", "adapter", "triggerKind", "expiresAt", "config"],
  record_offset: ["beneficiaryId", "receiptId", "amountBase"],
  approve_budget: ["taskId", "objectiveId", "kind", "budgetAcuMicro", "modelAcuMicro", "budgetModelVersion", "basis"],
  genesis_reference: ["version", "manifestSha256"],
  review_policy_switch: ["fromPolicyVersion", "toPolicyVersion", "fallback"],
  void_leaf: ["leafId"],
} as const satisfies Record<string, readonly string[]>;
export type OperationConsumer = keyof typeof CANONICAL_OPERATION_FIELDS;

export function canonicalOperationFields(consumer: OperationConsumer): readonly string[] {
  return CANONICAL_OPERATION_FIELDS[consumer];
}

/**
 * A consuming mutation must cite an action of an allowed kind, targeting exactly this row, whose payload IS the
 * operation, separately approved by the named co-signer when two-person, and never used before. With `consumer`, the
 * operation must carry every canonical field of that consumer (review 04 finding 9).
 */
export function adminAuthorizationRefusals(
  a: AdminActionRow | null,
  need: {
    kinds: readonly string[];
    targetKind: string;
    targetId: string;
    consumer?: OperationConsumer;
    operation?: Record<string, unknown>;
  },
  ctx: { approval: { approverAccountId: string; operationSha256: string } | null; alreadyUsed: boolean },
): string[] {
  if (!a) return ["no admin action cited"];
  const r: string[] = [];
  if (!need.kinds.includes(a.action) || a.targetKind !== need.targetKind || a.targetId !== need.targetId)
    r.push(`admin action does not authorize ${need.kinds.join("|")} on ${need.targetKind}/${need.targetId}`);
  if (need.consumer) {
    const fields = CANONICAL_OPERATION_FIELDS[need.consumer];
    const missing = fields.filter((f) => !need.operation || !(f in need.operation));
    if (missing.length > 0) r.push(`the ${need.consumer} operation must name ${missing.join(", ")} (canonical fields)`);
    const unapproved = fields.filter((f) => !(f in a.payload));
    if (unapproved.length > 0) r.push(`the approved payload omits ${unapproved.join(", ")}`);
  }
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
    /** Review 04 finding 6: the lease's own expiry, not only its hard deadline. */
    expiresAtMs: number;
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
  /**
   * Review 04 finding 6 / review 05 B6: the run-policy snapshot body AS STORED. It is parsed with the typed schema,
   * which carries the policy-derived `humanReviewRequired`; a missing or malformed field fails closed.
   */
  snapshotBody: unknown;
  humanPreMergePassOnRound: boolean;
}

/** The pinned human-review requirement of a stored snapshot, or null when the snapshot does not parse (fail closed). */
export function snapshotHumanRequirement(body: unknown): { required: boolean; riskClass: string } | null {
  const p = RunPolicySnapshot.safeParse(body);
  return p.success ? { required: p.data.humanReviewRequired, riskClass: p.data.riskClass } : null;
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
    c.createdAtMs > l.expiresAtMs ||
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
  const human = snapshotHumanRequirement(q.snapshotBody);
  if (!human) r.push("the run-policy snapshot does not parse (humanReviewRequired and riskClass are required): fail closed");
  else if (human.required && !q.humanPreMergePassOnRound) r.push("the pinned policy requires a human pre-merge PASS on this round");
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
  /**
   * `submittedEpoch`: when the work was submitted while the reservation was live (review 05 B4); it keeps the
   * reservation for `reviewGraceEpochs` more epochs. One expiry rule in every layer: live while epoch < expiry.
   */
  budget: {
    amountMicro: bigint;
    kind: string;
    released: boolean;
    expiresEpoch: number;
    submittedEpoch: number | null;
    reviewGraceEpochs: number;
  } | null;
  slice: string;
  admittedEpoch: number;
  shareBp: number | null;
  sharesAlreadyDeclaredBp: number;
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
      const expiry = b.submittedEpoch !== null && b.submittedEpoch < b.expiresEpoch ? b.expiresEpoch + b.reviewGraceEpochs : b.expiresEpoch;
      if (b.released || x.admittedEpoch >= expiry) r.push("the task budget was released or expired");
      if (x.weightMicro !== b.amountMicro || x.slice !== b.kind) r.push("the receipt carries its task budget, never a usage figure");
    }
    if (x.shareBp === null || x.sharesAlreadyDeclaredBp + x.shareBp > 10_000) r.push("declared shares exceed 10000 bp");
  }
  return r;
}

/**
 * Review 05 B10: optional telemetry never blocks reward admission. Each usage receipt offered with a contribution gets
 * an integrity status; only `valid` ones are linked (and used for calibration); the others are excluded and raise a
 * signal. An earned budget changes only through a separately adjudicated acceptance defect (a dispute).
 */
export function telemetryLinkStatus(u: {
  ownAndThisLease: boolean;
  attributedElsewhere: boolean;
}): "valid" | "excluded_not_this_lease" | "excluded_already_linked" {
  if (!u.ownAndThisLease) return "excluded_not_this_lease";
  if (u.attributedElsewhere) return "excluded_already_linked";
  return "valid";
}

/**
 * Review 05 B6: contribution type -> commissioning route -> acceptance event, from the pinned reward policy's
 * `acceptance` table. A type without a route is refused (no reward-bearing receipt without a real acceptance path). A
 * commissioned type (task_budget) needs its matching task kind, lease rule and, for HUMAN_REVIEW, a completed human
 * review by this account under the task's server-owned assignment; an outcome type is never paid from a budget.
 */
export function receiptRouteRefusals(x: {
  acceptance: ReadonlyArray<{ contributionType: string; slice: string; weightBasis: string; needsLease: boolean }>;
  contributionType: string;
  slice: string;
  evidenceClass: "accepted_budget" | "outcome";
  /** The kind of the task budget the receipt is paid from (null for outcomes). */
  taskKind: string | null;
  hasLease: boolean;
  receiptAccountId: string;
  taskId: string | null;
  /** For HUMAN_REVIEW: the sealed human review cited and its assignment. */
  humanReview: {
    reviewerAccountId: string;
    assignmentTaskId: string | null;
    assignmentReviewerAccountId: string | null;
    sealed: boolean;
  } | null;
}): string[] {
  const route = x.acceptance.find((a) => a.contributionType === x.contributionType);
  if (!route || route.slice === "none" || route.weightBasis === "none")
    return [`${x.contributionType} has no acceptance route in the pinned reward policy: no reward-bearing receipt`];
  const r: string[] = [];
  if (x.slice !== route.slice) r.push(`${x.contributionType} is paid from the ${route.slice} slice, not ${x.slice}`);
  if (route.weightBasis === "task_budget") {
    if (x.evidenceClass !== "accepted_budget" || !x.taskId)
      r.push(`${x.contributionType} is a commissioned task: it is paid its task budget`);
    if (x.taskKind !== route.slice) r.push(`the task budget is of kind ${x.taskKind}, the route needs ${route.slice}`);
    if (route.needsLease && !x.hasLease) r.push(`${x.contributionType} needs the lease it was done under`);
  } else if (x.evidenceClass !== "outcome" || x.taskId) r.push(`${x.contributionType} is an outcome: never paid from a task budget`);
  if (x.contributionType === "HUMAN_REVIEW") {
    const h = x.humanReview;
    if (
      !h?.sealed ||
      h.reviewerAccountId !== x.receiptAccountId ||
      h.assignmentTaskId !== x.taskId ||
      h.assignmentReviewerAccountId !== x.receiptAccountId
    )
      r.push("a HUMAN_REVIEW receipt needs this account's sealed human review under the task's own assignment");
  }
  return r;
}

// ------------------------------------------------------------------------------------------------ budgets (D49)

/**
 * Review 05 B1: the budget model, computed from pinned policy data and the task's immutable basis (never taken from the
 * caller): (base + perSizePoint x size) x difficulty x importance for commissioned agent work; the risk-class weight
 * for a human review. Returns null with a reason when the basis is outside the policy.
 */
export interface BudgetBasis {
  taskKind: string;
  sizePoints: number;
  difficultyBp: number;
  importanceBp: number;
  /** Human reviews only. */
  riskClass?: string;
}
export function budgetModelMicro(
  policy: {
    capabilityBudgets: ReadonlyArray<{ taskKind: string; baseMicro: string; perSizePointMicro: string }>;
    model: { difficultyBp: { min: number; max: number }; importanceBp: { min: number; max: number } };
    humanReviewWeights: Readonly<Record<string, string>>;
  },
  basis: BudgetBasis,
): { modelMicro: bigint } | { refusal: string } {
  const { difficultyBp: d, importanceBp: i } = policy.model;
  if (!Number.isInteger(basis.difficultyBp) || basis.difficultyBp < d.min || basis.difficultyBp > d.max)
    return { refusal: `difficulty ${basis.difficultyBp} bp is outside the policy bounds ${d.min}..${d.max}` };
  if (!Number.isInteger(basis.importanceBp) || basis.importanceBp < i.min || basis.importanceBp > i.max)
    return { refusal: `importance ${basis.importanceBp} bp is outside the policy bounds ${i.min}..${i.max}` };
  let base: bigint;
  if (basis.taskKind === "human_review") {
    const w = basis.riskClass ? policy.humanReviewWeights[basis.riskClass] : undefined;
    if (!w) return { refusal: `no human-review budget weight for risk class ${basis.riskClass}` };
    base = BigInt(w);
  } else {
    const row = policy.capabilityBudgets.find((b) => b.taskKind === basis.taskKind);
    if (!row) return { refusal: `no budget model for task kind ${basis.taskKind}` };
    if (!Number.isInteger(basis.sizePoints) || basis.sizePoints < 0) return { refusal: "size points are a non-negative integer" };
    base = BigInt(row.baseMicro) + BigInt(row.perSizePointMicro) * BigInt(basis.sizePoints);
  }
  const modelMicro = (base * BigInt(basis.difficultyBp) * BigInt(basis.importanceBp)) / 100_000_000n;
  return modelMicro > 0n ? { modelMicro } : { refusal: "the model budget is zero" };
}

export function budgetRefusals(x: {
  budgetMicro: bigint;
  /** What the caller stored as the model: must equal the model computed from the basis (review 05 B1). */
  modelMicro: bigint;
  computedModel: { modelMicro: bigint } | { refusal: string };
  /** The objective's consensus round (review 05 B1): revealed, consensus, covering scope and total budget. */
  objectiveConsensus: { revealed: boolean; outcome: string | null; coversBudget: boolean } | null;
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
  if ("refusal" in x.computedModel) r.push(`budget model: ${x.computedModel.refusal}`);
  else if (x.computedModel.modelMicro !== x.modelMicro)
    r.push(`the stored model ${x.modelMicro} differs from the model computed from the basis (${x.computedModel.modelMicro})`);
  const c = x.objectiveConsensus;
  if (!c?.revealed || c.outcome !== "consensus" || !c.coversBudget)
    r.push("the acceptance objective needs its revealed consensus round over scope and total budget");
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
      // Review 04 finding 2: a matured release takes the tranche's remaining UNHELD balance; the part a hold kept is
      // released by a later release (release_seq + 1) once the hold is lifted — never stranded, never withheld wholesale.
      if (x.amount !== x.tranche.remaining - x.heldOnSource || x.amount <= 0n)
        r.push("a matured release is exactly the tranche's remaining unheld balance");
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

/**
 * D39 minimum windows, and (review 04 finding 4) FINITE maxima from notice: the reply closes within `maxReplyHours`
 * of notice, the appeal within `maxAppealHours` after the reply, the hold lapses within `maxHoldAfterAppealHours`
 * after the appeal closes (and not before it). Maxima come from the pinned reward policy (provisional, F17).
 */
export function confiscationNoticeRefusals(x: {
  nowMs: number;
  replyClosesAtMs: number;
  appealClosesAtMs: number;
  holdExpiresAtMs: number;
  maxima?: { maxReplyHours: number; maxAppealHours: number; maxHoldAfterAppealHours: number };
}): string[] {
  const m = x.maxima ?? { maxReplyHours: 336, maxAppealHours: 720, maxHoldAfterAppealHours: 336 };
  const r: string[] = [];
  if (x.replyClosesAtMs < x.nowMs + 72 * H || x.appealClosesAtMs < x.replyClosesAtMs + 168 * H)
    r.push("confiscation needs >= 72 h reply and >= 168 h appeal windows after notice");
  if (
    !Number.isFinite(x.holdExpiresAtMs) ||
    x.replyClosesAtMs > x.nowMs + m.maxReplyHours * H ||
    x.appealClosesAtMs > x.replyClosesAtMs + m.maxAppealHours * H ||
    x.holdExpiresAtMs > x.appealClosesAtMs + m.maxHoldAfterAppealHours * H ||
    x.holdExpiresAtMs < x.appealClosesAtMs
  )
    r.push(
      `a hold is bounded from notice: reply <= ${m.maxReplyHours} h, appeal <= ${m.maxAppealHours} h after it, lapse <= ${m.maxHoldAfterAppealHours} h after the appeal closes`,
    );
  return r;
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

/** Review 04 finding 11: the canonical hash of a Genesis reference manifest (receipt ids sorted, unique). */
export function genesisReferenceManifestSha256(m: {
  version: string;
  cutoffEpoch: number;
  rules: unknown;
  receiptIds: readonly string[];
}): string {
  return canonicalSha256({ version: m.version, cutoffEpoch: m.cutoffEpoch, rules: m.rules, receiptIds: [...m.receiptIds].sort() });
}

export function genesisReferenceManifestRefusals(x: {
  receipts: ReadonlyArray<{
    exists: boolean;
    status: string | null;
    admittedEpoch: number;
    relatedToGenesisBeneficiary: boolean;
    mode?: "test" | "live";
    contributionType?: string;
  }>;
  cutoffEpoch: number;
  approvalRefusals: string[];
  /** Review 04 finding 11: the manifest's contents and the hash the approval names (recomputed, never asserted). */
  manifest?: { version: string; cutoffEpoch: number; rules: { types?: readonly string[] }; receiptIds: readonly string[] };
  manifestSha256?: string;
}): string[] {
  const r: string[] = [...x.approvalRefusals];
  if (x.manifest) {
    if (x.manifestSha256 !== genesisReferenceManifestSha256(x.manifest))
      r.push("the approved manifest hash does not match the manifest's canonical contents");
    if (new Set(x.manifest.receiptIds).size !== x.manifest.receiptIds.length) r.push("a reference receipt is listed twice");
    const types = x.manifest.rules.types;
    if (x.receipts.some((c) => c.mode !== "live")) r.push("the reference population holds live receipts only (no test-mode receipts)");
    if (types && x.receipts.some((c) => !c.contributionType || !types.includes(c.contributionType)))
      r.push("a reference receipt is outside the manifest's population rules");
  }
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

// ------------------------------------------------------------------------------------------------ model eligibility at claim (D52)

/**
 * A lease is offered only to a model qualified for the task's capability class. A CANDIDATE model (D52, e.g. GLM via
 * Z.ai) is refused for every role until its qualification suite passed for that class and it was added to the class's
 * `qualified` list; reviewer and resolver roles need a separate qualification.
 */
export function modelClaimRefusals(
  policy: {
    classes: ReadonlyArray<{ id: string; qualified: ReadonlyArray<{ provider: string; modelId: string }> }>;
    candidates: ReadonlyArray<{ key: string; provider: string; modelIdPattern: string; allowedRoles: readonly string[] }>;
  },
  claim: { provider: string; modelId: string; requiredClass: string; role: string },
): string[] {
  const glob = (p: string) => new RegExp(`^${p.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}$`);
  const candidate = policy.candidates.find((c) => c.provider === claim.provider || glob(c.modelIdPattern).test(claim.modelId));
  const cls = policy.classes.find((c) => c.id === claim.requiredClass);
  const qualified = cls?.qualified.some((q) => q.provider === claim.provider && q.modelId === claim.modelId) ?? false;
  const r: string[] = [];
  if (candidate && !candidate.allowedRoles.includes(claim.role) && !qualified)
    r.push(`${candidate.key} is a candidate model: not eligible for any role until it passes qualification (D52)`);
  else if (!qualified) r.push(`model ${claim.modelId} is not qualified for ${claim.requiredClass}`);
  return r;
}

// ------------------------------------------------------------------------------------------------ review 04/05 fix pass

/**
 * Review 05 B2: allocations of a commissioned task are DERIVED, not asserted: the task's reservation is split over its
 * receipts by declared shares (largest remainder, the engine's rule), and each receipt's amount over its person and
 * sponsoring organization by the sponsorship share. The set of lines must equal the derivation exactly. (SQL keeps a
 * hard bound: no receipt above ceil(reservation x share).)
 */
export function taskAllocationRefusals(x: {
  reservedBase: bigint;
  receipts: ReadonlyArray<{ receiptId: string; shareBp: number; orgShareBp: number }>;
  lines: ReadonlyArray<{ receiptId: string; beneficiary: "person" | "organization"; amount: bigint }>;
}): string[] {
  const sum = x.receipts.reduce((t, c) => t + c.shareBp, 0);
  if (sum !== 10_000) return ["declared shares of the task must sum to 10000 bp before allocation"];
  const perReceipt = largestRemainder(
    x.reservedBase,
    x.receipts.map((c) => ({ key: c.receiptId, weight: BigInt(c.shareBp) })),
  );
  const want = new Map<string, bigint>();
  for (const c of x.receipts) {
    const amt = perReceipt.get(c.receiptId) ?? 0n;
    const org = (amt * BigInt(c.orgShareBp)) / 10_000n;
    want.set(`${c.receiptId}/person`, amt - org);
    if (c.orgShareBp > 0) want.set(`${c.receiptId}/organization`, org);
  }
  const got = new Map<string, bigint>();
  for (const l of x.lines) got.set(`${l.receiptId}/${l.beneficiary}`, (got.get(`${l.receiptId}/${l.beneficiary}`) ?? 0n) + l.amount);
  const r: string[] = [];
  for (const [k, v] of want) if ((got.get(k) ?? 0n) !== v) r.push(`allocation ${k} is ${got.get(k) ?? 0n}, the declared shares give ${v}`);
  for (const k of got.keys()) if (!want.has(k)) r.push(`allocation ${k} is not a line of this task`);
  return r;
}

/**
 * Review 05 B4: releasing a reservation. `expired` only at or after its (grace-extended) expiry; `failed` and
 * `abandoned` only once no lease is active; `cancelled` and `repriced` of a task with an active lease or submitted work
 * need an authorized, operation-bound admin action; nothing accepted is released (also SQL).
 */
export function budgetReleaseRefusals(x: {
  reason: "expired" | "failed" | "abandoned" | "cancelled" | "repriced";
  epochNumber: number;
  expiresEpoch: number;
  submittedEpoch: number | null;
  reviewGraceEpochs: number;
  accepted: boolean;
  activeLease: boolean;
  authorizationRefusals: string[] | null;
}): string[] {
  const r: string[] = [];
  const expiry = x.submittedEpoch !== null && x.submittedEpoch < x.expiresEpoch ? x.expiresEpoch + x.reviewGraceEpochs : x.expiresEpoch;
  if (x.accepted) r.push("an accepted task is paid, never released");
  if (x.reason === "expired" && x.epochNumber < expiry) r.push(`the reservation is live until epoch ${expiry}`);
  if ((x.reason === "failed" || x.reason === "abandoned") && x.activeLease)
    r.push("a task with an active lease is not failed or abandoned");
  if (
    (x.reason === "cancelled" || x.reason === "repriced") &&
    (x.activeLease || x.submittedEpoch !== null) &&
    (x.authorizationRefusals === null || x.authorizationRefusals.length > 0)
  )
    r.push("cancelling or re-pricing active or submitted work needs an authorized admin action");
  return r;
}

/** Review 05 B4: reward-bearing work is leased only against a funded, unreleased, unexpired budget. */
export function leaseBudgetRefusals(x: {
  rewardBearing: boolean;
  budget: { released: boolean; expiresEpoch: number } | null;
  epochNumber: number;
}): string[] {
  if (!x.rewardBearing) return [];
  if (!x.budget) return ["reward-bearing work needs a funded task budget before it is leased"];
  if (x.budget.released || x.epochNumber >= x.budget.expiresEpoch) return ["the task budget was released or has expired"];
  return [];
}

/**
 * Review 05 B3: the epoch row's pinned issuance rate and task capacity must be the envelope the engine computes when
 * the epoch opens, from the persisted reserve snapshot and demand forecast.
 */
export function epochEnvelopeRefusals(
  pinned: {
    rateBasePerAcu: bigint | null;
    taskCapacityBase: bigint | null;
    reserveSnapshot: bigint | null;
    demandForecastAcuMicro: bigint | null;
  },
  envelope: { rate: bigint; taskCapacity: bigint; reserveSnapshot: bigint; demandForecastAcuMicro: bigint },
): string[] {
  const r: string[] = [];
  if (pinned.reserveSnapshot !== envelope.reserveSnapshot || pinned.demandForecastAcuMicro !== envelope.demandForecastAcuMicro)
    r.push("the epoch's reserve snapshot and demand forecast must be the ones the envelope was computed from");
  if (pinned.rateBasePerAcu !== envelope.rate || pinned.taskCapacityBase !== envelope.taskCapacity)
    r.push("the epoch's pinned rate and task capacity differ from the engine's envelope");
  return r;
}

/**
 * Review 04 finding 8: a typed settlement observation. `expired_not_landed` needs a history search for THIS signature on
 * THIS cluster that found nothing (`value: [null]`) at a block height past the attempt's last valid height; `confirmed`
 * needs the signature finalized WITHOUT error. Contradictory or incomplete evidence leaves the attempt unresolved.
 */
export interface StatusObservation {
  signature: string;
  cluster: "devnet" | "mainnet-beta";
  searchTransactionHistory: boolean;
  observedBlockHeight: number;
  value: ReadonlyArray<{ confirmationStatus: string | null; err: unknown; slot: number } | null>;
}
export function settlementObservationRefusals(x: {
  outcome: "confirmed" | "expired_not_landed";
  attempt: { signature: string; cluster: string; lastValidBlockHeight: number };
  observation: unknown;
}): string[] {
  const o = x.observation as Partial<StatusObservation> | null;
  if (!o || typeof o !== "object" || !Array.isArray(o.value) || o.value.length !== 1)
    return ["the observation is not a status response for one signature"];
  const r: string[] = [];
  if (o.signature !== x.attempt.signature || o.cluster !== x.attempt.cluster) r.push("the observation is of another signature or cluster");
  const v = o.value[0];
  if (x.outcome === "expired_not_landed") {
    if (o.searchTransactionHistory !== true) r.push("expiry needs a historical search");
    if (v !== null) r.push("the observation shows the transaction: it landed (or may land), it is not expired");
    if (!(typeof o.observedBlockHeight === "number" && o.observedBlockHeight > x.attempt.lastValidBlockHeight))
      r.push("expiry needs a block height past the attempt's last valid block height");
  } else if (v?.confirmationStatus !== "finalized" || v.err !== null) r.push("confirmed needs the signature finalized without error");
  return r;
}

// ------------------------------------------------------------------------------------------------ D53 Fable unavailable

/**
 * D53: while the ReviewPolicy fallback `fable_unavailable` is active, the Fable seat is replaced by the required human
 * review (founder or authorized reviewers) as the second independent check; Astra stays the agent reviewer; a model
 * never reviews work built by the same model; every round and receipt reviewed under the fallback is labelled
 * `single_lab_review` with the reason. A later Fable pass is optional, never required, never blocking.
 */
export function reviewSeatRefusals(x: {
  activeFallback: "none" | "fable_unavailable";
  slot: "astra" | "fable" | "human";
  reviewerModelId: string | null;
  builderModelId: string | null;
  /** True for a later, optional Fable pass recorded after the round closed (never counted toward consensus). */
  optionalLaterPass?: boolean;
}): string[] {
  const r: string[] = [];
  if (x.activeFallback === "fable_unavailable" && x.slot === "fable" && !x.optionalLaterPass)
    r.push("the Fable seat is replaced by the required human review while the fable_unavailable fallback is active");
  if (x.reviewerModelId !== null && x.builderModelId !== null && x.reviewerModelId === x.builderModelId)
    r.push(`${x.reviewerModelId} may not review work built by ${x.builderModelId} (same-model self-review)`);
  return r;
}

/** D53: the seats a round needs under the active review policy fallback, and the label its outputs carry. */
export function requiredReviewSeats(activeFallback: "none" | "fable_unavailable"): {
  seats: ReadonlyArray<"astra" | "fable" | "human">;
  labels: ReadonlyArray<{ label: "single_lab_review"; reason: string }>;
} {
  return activeFallback === "fable_unavailable"
    ? {
        seats: ["astra", "human"],
        labels: [{ label: "single_lab_review", reason: "fable_unavailable: Fable seat replaced by the required human review (D53)" }],
      }
    : { seats: ["astra", "fable"], labels: [] };
}

/** D53: switching the review policy is forward-only, needs its AdminAction and is published. */
export function reviewPolicySwitchRefusals(x: {
  fromVersion: string;
  toVersion: string;
  versionsInOrder: readonly string[];
  authorizationRefusals: string[];
  published: boolean;
}): string[] {
  const r = [...x.authorizationRefusals];
  const a = x.versionsInOrder.indexOf(x.fromVersion);
  const b = x.versionsInOrder.indexOf(x.toVersion);
  if (a < 0 || b <= a) r.push("a review policy switch is forward-only");
  if (!x.published) r.push("a review policy switch is shown publicly");
  return r;
}

// ------------------------------------------------------------------------------------------------ D54 provisional receipts

/**
 * D54: PROVISIONAL (bootstrap) receipts finalize optimistically. When bootstrap ends each is published with a challenge
 * window; silence accepts it (qualifying, Genesis-eligible, original timestamp); a challenge sends that receipt to the
 * normal review gate. No recruited reviewer pool or ratification queue is needed; nothing waits on an independent human
 * before bootstrap ends.
 */
export function provisionalReceiptOutcome(x: {
  bootstrapEnded: boolean;
  publishedAtMs: number | null;
  challengeWindowHours: number;
  challenged: boolean;
  nowMs: number;
}): "provisional" | "in_challenge_window" | "final_by_silence" | "to_review_gate" {
  if (!x.bootstrapEnded || x.publishedAtMs === null) return "provisional";
  if (x.challenged) return "to_review_gate";
  return x.nowMs >= x.publishedAtMs + x.challengeWindowHours * H ? "final_by_silence" : "in_challenge_window";
}

// ------------------------------------------------------------------------------------------------ D55 V1-active and dormant modules

/**
 * D55: modules that are designed but DORMANT in V1 (valueless devnet/shadow tokens, a solo founder). A dormant module is
 * refused until its forward-only activation (policy switch by AdminAction) after its trigger; the V1 build waves do not
 * build it. The list and triggers live in POLICIES.md §0 and PROTOCOL.md §13.
 */
export const DORMANT_MODULES = [
  "dispute_stakes_and_bounties",
  "multi_allocation_disputes_and_appeals",
  "payout_canaries",
  "organization_caps_and_beneficiary_splits",
  "governance_voting",
  "collusion_and_sybil_detection_beyond_basics",
  "confiscation_beyond_simple_hold",
  "genesis_calibration_population",
] as const;
export type DormantModule = (typeof DORMANT_MODULES)[number];

export function moduleRefusals(x: { module: DormantModule; activated: readonly string[] }): string[] {
  return x.activated.includes(x.module) ? [] : [`${x.module} is dormant in V1 (D55): activate it by a forward-only policy switch first`];
}

// ------------------------------------------------------------------------------------------------ D56 build next

export interface NextUnitCandidate {
  unitId: string;
  target: string;
  requiredClass: string;
  /** Targets served by the unit's catalog feature (reuse). */
  targetsServed: number;
  /** Units waiting on this one (unlock value). */
  dependentsWaiting: number;
  issuedEpoch: number;
  issuedAtMs: number;
  budgetAcuMicro: bigint;
  estimatedMinutes: number;
  proposerAccountId: string;
  requiredToolchains: readonly string[];
  budget: { released: boolean; expiresEpoch: number } | null;
}

export interface NextUnitContributor {
  accountId: string;
  provider: string;
  modelId: string;
  attestedToolchains: readonly string[];
  activeLeasesByProvider: Readonly<Record<string, number>>;
  leaseLimitByProvider: Readonly<Record<string, number>>;
  /** Accounts related to the contributor (org-mates, sponsors): independence. */
  relatedAccountIds: readonly string[];
  /** What is left of the contributor's own limits (null = no limit). */
  remaining: { budgetAcuMicro: bigint | null; wallTimeMinutes: number | null };
}

/**
 * D56: may this contributor be assigned this unit? The same checks as a self-picked claim: the model is qualified for
 * the unit's class (candidate models refused, modelClaimRefusals), the device attests the toolchains, a provider lease
 * slot is free, the unit's budget was not proposed by the contributor or a related account, the budget is funded and
 * live, and the unit fits the contributor's remaining limits (a filter, never a score).
 */
export function nextUnitEligibilityRefusals(
  capability: Parameters<typeof modelClaimRefusals>[0],
  c: NextUnitContributor,
  u: NextUnitCandidate,
  epochNumber: number,
): string[] {
  const r = modelClaimRefusals(capability, { provider: c.provider, modelId: c.modelId, requiredClass: u.requiredClass, role: "builder" });
  if (u.requiredToolchains.some((t) => !c.attestedToolchains.includes(t))) r.push("the device does not attest the unit's toolchains");
  if ((c.activeLeasesByProvider[c.provider] ?? 0) >= (c.leaseLimitByProvider[c.provider] ?? 1)) r.push(`no free ${c.provider} lease slot`);
  if (u.proposerAccountId === c.accountId || c.relatedAccountIds.includes(u.proposerAccountId))
    r.push("the contributor (or a related account) proposed this unit's budget");
  r.push(...leaseBudgetRefusals({ rewardBearing: true, budget: u.budget, epochNumber }));
  if (c.remaining.budgetAcuMicro !== null && u.budgetAcuMicro > c.remaining.budgetAcuMicro)
    r.push("the unit exceeds the contributor's remaining ACU limit");
  if (c.remaining.wallTimeMinutes !== null && u.estimatedMinutes > c.remaining.wallTimeMinutes)
    r.push("the unit exceeds the contributor's remaining wall time");
  return r;
}

/** D56: the published ranking. Deterministic; ties by unit id ascending. */
export function rankNextUnits(
  policy: {
    weights: { reuse: number; unlock: number; ageingPerEpoch: number };
    ageingCapEpochs: number;
    focus: ReadonlyArray<{ target: string; capabilityClass: string | null; priority: number }>;
  },
  units: readonly NextUnitCandidate[],
  epochNumber: number,
): Array<{ unitId: string; score: { reuse: number; unlock: number; focus: number; ageing: number; total: number } }> {
  return units
    .map((u) => {
      const reuse = policy.weights.reuse * u.targetsServed;
      const unlock = policy.weights.unlock * u.dependentsWaiting;
      const focus = policy.focus
        .filter((f) => f.target === u.target && (f.capabilityClass === null || f.capabilityClass === u.requiredClass))
        .reduce((t, f) => t + f.priority, 0);
      const ageing = policy.weights.ageingPerEpoch * Math.min(Math.max(0, epochNumber - u.issuedEpoch), policy.ageingCapEpochs);
      return { unitId: u.unitId, score: { reuse, unlock, focus, ageing, total: reuse + unlock + focus + ageing } };
    })
    .sort((a, b) => b.score.total - a.score.total || (a.unitId < b.unitId ? -1 : a.unitId > b.unitId ? 1 : 0));
}

/** D56 optional lever (default off): a freshly issued unit is offered only to assigned mode for a short window. */
export function selfPickRefusals(x: { issuedAtMs: number; nowMs: number; assignedOnlyWindowMinutes: number }): string[] {
  return x.nowMs < x.issuedAtMs + x.assignedOnlyWindowMinutes * 60_000 ? ["this unit is offered to assigned mode only for now"] : [];
}

/** D56 continuous mode: stop when asked or when a contributor-set limit is reached (checked before each next claim). */
export function continuousNextStop(x: {
  stopRequested: boolean;
  limits: { units?: number; wallTimeMinutes?: number; budgetAcuMicro?: bigint; perProviderUnits?: Readonly<Record<string, number>> };
  used: { units: number; wallTimeMinutes: number; budgetAcuMicro: bigint; unitsByProvider: Readonly<Record<string, number>> };
  provider: string;
}): string | null {
  if (x.stopRequested) return "stopped by the contributor";
  const l = x.limits;
  if (l.units !== undefined && x.used.units >= l.units) return "unit limit reached";
  if (l.wallTimeMinutes !== undefined && x.used.wallTimeMinutes >= l.wallTimeMinutes) return "wall-time limit reached";
  if (l.budgetAcuMicro !== undefined && x.used.budgetAcuMicro >= l.budgetAcuMicro) return "ACU limit reached";
  const pp = l.perProviderUnits?.[x.provider];
  if (pp !== undefined && (x.used.unitsByProvider[x.provider] ?? 0) >= pp) return `${x.provider} unit limit reached`;
  return null;
}
