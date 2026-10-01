/**
 * Shadow-receipt display model (P1 shadow accounting, contracts 5.20.0): everything /receipts renders for a
 * non-technical reader — who ran which model on what task, the cost as reported, the reviews and verdicts, the
 * outcome, the shadow budget ("shadow — no value"), and the verify lines with the hashes.
 *
 * This file is the pure model, like lib/gauge.mts: no React, no imports. The parameter types mirror the public
 * API's receipt shapes (packages/contracts/src/shadow.ts, frozen in contracts 5.20.0) structurally, so
 * tests/shadow-receipts-web.test.ts can check every label against fixtures without a web build.
 *
 * No fake data: anything the receipt does not carry renders as "NOT REPORTED" / "UNKNOWN", never as a guess.
 */

export type ReceiptKind = "abu_build" | "abu_revision" | "roadmap_author" | "feature_author";

export type ReceiptSummary = {
  id: string;
  kind: ReceiptKind;
  handle: string | null;
  target: string | null;
  feature: string | null;
  abu: string | null;
  abuTitle: string | null;
  documentKind: "roadmap" | "feature_contract" | null;
  documentVersion: number | null;
  provider: string | null;
  modelId: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  costUsd: number | null;
  runCount: number;
  roundCount: number;
  reviewCount: number;
  trialLabel: string | null;
  outcome: {
    state: string;
    merged: boolean;
    pr: { number: number; url: string } | null;
    contribution: "pending" | "accepted" | "rejected" | "reversed" | null;
  };
  shadowBudget: ShadowBudget | null;
  createdAt: string;
  updatedAt: string;
};

export type ShadowBudget = {
  label: string;
  policy: { capability: string; reward: string };
  taskKind: string;
  sizePoints: number;
  difficultyBp: number;
  importanceBp: number;
  budgetAcuMicro: string;
  basePriceAcuMicro: string;
  queueBonusBp: number;
};

export type ReceiptRun = {
  id: string;
  provider: string;
  launchProvider: string | null;
  modelIdRequested: string;
  modelIdReported: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  costUsd: number | null;
  steps: number | null;
  startedAt: string;
  durationSeconds: number;
  exitCode: number | null;
  mode: "shadow" | null;
  manifestSha256: string;
  transcriptSha256: string | null;
};

export type ReceiptReview = {
  slot: string;
  handle: string | null;
  provider: string | null;
  modelId: string | null;
  verdict: "NO_MATERIAL_GAPS" | "MATERIAL_GAPS" | null;
};

export type ReceiptRound = {
  id: string;
  number: number;
  state: string;
  outcome: "consensus" | "gaps" | null;
  independence: string | null;
  reviewLabel: string | null;
  trialLabel: string | null;
  secondSeat: string | null;
  submissionSha256: string;
  headSha: string;
  revealedAt: string | null;
  reviews: ReceiptReview[];
};

export type Receipt = ReceiptSummary & {
  runs: ReceiptRun[];
  rounds: ReceiptRound[];
  receiptSha256: string;
};

/** The public API's cursor page of receipt summaries (the route's Page shape). */
export type ReceiptsPage = { items: ReceiptSummary[]; nextCursor: string | null };

const KIND_LABEL: Record<ReceiptKind, string> = {
  abu_build: "Build unit",
  abu_revision: "Build revision",
  roadmap_author: "Roadmap author",
  feature_author: "Feature contract author",
};

export function kindLabel(kind: ReceiptKind): string {
  return KIND_LABEL[kind] ?? "Unknown";
}

/** What the task was: the ABU's key and title, or the document's kind and version. */
export function taskLabel(
  r: Pick<ReceiptSummary, "kind" | "abu" | "abuTitle" | "documentKind" | "documentVersion" | "target">,
): string {
  if (r.kind === "abu_build" || r.kind === "abu_revision") {
    const unit = r.abu ? `${r.abu}${r.abuTitle ? ` — ${r.abuTitle}` : ""}` : "UNKNOWN";
    return r.target ? `${unit} (${r.target})` : unit;
  }
  const doc = r.documentKind ? `${r.documentKind.replace("_", " ")} v${r.documentVersion ?? "?"}` : "UNKNOWN";
  return r.target ? `${doc} (${r.target})` : doc;
}

const numberFormat = new Intl.NumberFormat("en-US");

export function tokensLabel(r: Pick<ReceiptSummary, "inputTokens" | "outputTokens">): string {
  if (r.inputTokens === null && r.outputTokens === null) return "NOT REPORTED";
  return `${r.inputTokens === null ? "?" : numberFormat.format(r.inputTokens)} IN / ${
    r.outputTokens === null ? "?" : numberFormat.format(r.outputTokens)
  } OUT`;
}

export function costLabel(costUsd: number | null): string {
  return costUsd === null ? "NOT REPORTED" : `$${costUsd.toFixed(2)} as reported`;
}

/** micro-ACU -> ACU, trailing zeros trimmed (8,000,000 micro-ACU = 8 ACU). */
export function formatAcu(micro: string): string {
  const n = Number(micro);
  if (!/^[0-9]+$/.test(micro) || !Number.isFinite(n) || n < 0) return "UNKNOWN";
  const acu = n / 1_000_000;
  return `${Number.isInteger(acu) ? String(acu) : `${acu.toFixed(6).replace(/0+$/, "")}`} ACU`;
}

/** The one-line shadow budget a reader quotes: what it WOULD pay, and that it pays nothing now. */
export function budgetLine(b: ReceiptSummary["shadowBudget"]): string {
  if (!b) return "NO BUDGET (task kind outside the frozen protocol's budget rows)";
  const base = formatAcu(b.basePriceAcuMicro);
  const bonus = b.queueBonusBp / 100;
  return `WOULD PAY ${formatAcu(b.budgetAcuMicro)} (base price ${base} + ${bonus}% queue bonus) — ${b.label}`;
}

/** The outcome in the brief's words: submitted / accepted-merged / rejected, with the pipeline state. */
export function outcomeLabel(r: Pick<ReceiptSummary, "outcome">): string {
  const { state, merged, contribution } = r.outcome;
  if (merged) return `MERGED${contribution ? ` (CONTRIBUTION ${contribution.toUpperCase()})` : ""}`;
  if (contribution === "rejected") return `REJECTED (${state})`;
  return `SUBMITTED (${state})`;
}

export function timeLabel(iso: string | null): string {
  if (!iso) return "UNKNOWN";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "UNKNOWN" : `${d.toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

const VERDICT_LABEL: Record<string, string> = {
  NO_MATERIAL_GAPS: "NO MATERIAL GAPS",
  MATERIAL_GAPS: "MATERIAL GAPS",
};

export function verdictLabel(v: string | null): string {
  return v === null ? "PENDING (SEALED UNTIL THE ROUND IS REVEALED)" : (VERDICT_LABEL[v] ?? v);
}

const SLOT_LABEL: Record<string, string> = { astra: "Astra seat", fable: "Fable seat", human: "Human seat" };

export function slotLabel(slot: string): string {
  return SLOT_LABEL[slot] ?? "Unknown seat";
}

/** The review labels a reader can meet (D53/D67/D69), explained in one line. */
export function reviewLabels(round: Pick<ReceiptRound, "reviewLabel" | "trialLabel" | "independence" | "secondSeat">): string[] {
  const out: string[] = [];
  if (round.reviewLabel === "single_lab_review") out.push("single_lab_review (Astra + the required human seat)");
  if (round.trialLabel) out.push(`${round.trialLabel} (a candidate's designated trial run)`);
  if (round.independence === "bootstrap_self") out.push("bootstrap_self (the founder reviewed his own work in bootstrap)");
  if (round.secondSeat) out.push(`second seat: ${round.secondSeat}`);
  return out;
}

export interface VerifyLine {
  label: string;
  value: string;
}

/** The verify section: every hash the receipt carries, with what it commits. */
export function verifyLines(r: Receipt): VerifyLine[] {
  const lines: VerifyLine[] = [{ label: "RECEIPT HASH (recompute it from this page's JSON)", value: r.receiptSha256 }];
  for (const run of r.runs) {
    lines.push({ label: `RUN ${run.id} MANIFEST HASH`, value: run.manifestSha256 });
    if (run.transcriptSha256) lines.push({ label: `RUN ${run.id} TRANSCRIPT HASH`, value: run.transcriptSha256 });
  }
  for (const round of r.rounds) {
    lines.push({ label: `ROUND ${round.number} SUBMISSION HASH`, value: round.submissionSha256 });
    lines.push({ label: `ROUND ${round.number} HEAD COMMIT`, value: round.headSha });
  }
  if (r.outcome.pr) lines.push({ label: "PULL REQUEST", value: r.outcome.pr.url });
  return lines;
}
