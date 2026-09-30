/**
 * `wos review --human` (contracts 5.15.0, D53): the required human review that holds the second seat of a round while
 * the review policy fallback `fable_unavailable` is active. It shows the round's subject, the sealed Astra verdict and
 * the prior findings, then records the human's verdict (review-verdict.v1) bound to the round's head sha and submission
 * hash. The human seat is never the subject's author nor the Astra reviewer of the same round (the server refuses both).
 */
import { FindingCategory, type HumanReviewSubject, ReviewVerdict } from "@waronsaas/contracts";

type Verdict = ReviewVerdict;

const wrap = (s: string, indent: string) =>
  s
    .split("\n")
    .map((l) => `${indent}${l}`)
    .join("\n");

/** Plain-text view of a round for the human seat. */
export function renderHumanReview(s: HumanReviewSubject): string {
  const r = s.round;
  const subject = r.target ? `${r.subjectKind} ${r.target}` : r.feature ? `${r.subjectKind} ${r.feature}` : r.subjectKind;
  const out: string[] = [
    `round    ${r.roundId}: round ${r.roundNumber} of ${subject} (${r.label})`,
    `head     ${r.headSha}`,
    `hash     ${r.submissionSha256}`,
    `subject  ${s.subject.title}${s.subject.prNumber !== null ? `, PR #${s.subject.prNumber}` : ""}${s.subject.prUrl ? ` ${s.subject.prUrl}` : ""}`,
    `repo     ${s.subject.repo}${s.subject.branch ? ` branch ${s.subject.branch}` : ""}`,
  ];
  if (!r.eligibility.eligible) for (const reason of r.eligibility.reasons) out.push(`refused  ${reason}`);
  out.push("files");
  for (const f of s.subject.files) out.push(`  ${f.path}\n    ${f.url}`);
  const summary = (s.subject.authorSummary as { summary?: unknown } | null)?.summary;
  if (typeof summary === "string") out.push("author summary", wrap(summary, "  "));
  if (s.agentReview) {
    const a = s.agentReview;
    out.push(`astra    ${a.verdict.verdict} by @${a.reviewerHandle} (${a.model}, ${a.reasoning}, attested)`, wrap(a.verdict.summary, "  "));
    for (const f of a.verdict.findings)
      out.push(`  ${f.localId} ${f.severity.toUpperCase()} ${f.category}: ${f.title}`, wrap(f.detail, "      "));
    for (const p of a.verdict.priorFindings) out.push(`  prior ${p.findingId}: ${p.status}${p.note ? `, ${p.note}` : ""}`);
  } else out.push("astra    not shown (the Astra verdict is not sealed yet, or you may not hold this seat)");
  if (s.priorFindings.length > 0) {
    out.push("prior findings");
    for (const f of s.priorFindings)
      out.push(`  ${f.id} round ${f.roundNumber} ${f.source} ${f.severity} ${f.state}: ${f.title}`, wrap(f.detail, "      "));
  }
  return `${out.join("\n")}\n`;
}

/** Prior MATERIAL findings the human must re-check (open or disputed). */
export const priorToRecheck = (s: HumanReviewSubject) =>
  s.priorFindings.filter((f) => f.severity === "material" && (f.state === "open" || f.state === "disputed"));

/** Parses and checks a verdict file: review-verdict.v1, and every open prior material finding answered. */
export function parseVerdictFile(text: string, s: HumanReviewSubject): { ok: true; verdict: Verdict } | { ok: false; problems: string[] } {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, problems: ["the verdict file is not JSON"] };
  }
  const v = ReviewVerdict.safeParse(raw);
  if (!v.success) return { ok: false, problems: v.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`) };
  const answered = new Set(v.data.priorFindings.map((p) => p.findingId));
  const missing = priorToRecheck(s).filter((f) => !answered.has(f.id));
  if (missing.length > 0)
    return { ok: false, problems: missing.map((f) => `priorFindings: answer ${f.id} (${f.title}) resolved or still_open`) };
  return { ok: true, verdict: v.data };
}

type Prompt = (question: string) => Promise<string | null>;

/** Interactive verdict: prior findings first, then new findings, then the summary. Null when aborted. */
export async function promptVerdict(prompt: Prompt, s: HumanReviewSubject): Promise<Verdict | null> {
  const ask = async (q: string, valid?: (a: string) => boolean): Promise<string | null> => {
    for (;;) {
      const a = await prompt(q);
      if (a === null) return null;
      const t = a.trim();
      if (!valid || valid(t)) return t;
    }
  };
  const priorFindings: Verdict["priorFindings"] = [];
  for (const f of priorToRecheck(s)) {
    const status = await ask(`prior ${f.id} "${f.title}": resolved or still_open? `, (a) => a === "resolved" || a === "still_open");
    if (status === null) return null;
    const note = (await ask("  note (optional): ")) ?? "";
    priorFindings.push({ findingId: f.id, status: status as "resolved" | "still_open", note });
  }
  const findings: Verdict["findings"] = [];
  for (;;) {
    const more = await ask(`add a finding${findings.length ? " more" : ""}? [y/N] `);
    if (more === null) return null;
    if (!/^y(es)?$/i.test(more)) break;
    const severity = await ask("  severity (material or minor): ", (a) => a === "material" || a === "minor");
    const category = await ask(`  category (${FindingCategory.options.join(", ")}): `, (a) => FindingCategory.safeParse(a).success);
    const title = await ask("  title: ", (a) => a.length > 0 && a.length <= 200);
    const detail = await ask("  detail: ", (a) => a.length > 0 && a.length <= 8000);
    const suggested = await ask("  suggested resolution (optional): ", (a) => a.length <= 4000);
    if (severity === null || category === null || title === null || detail === null || suggested === null) return null;
    findings.push({
      localId: `f${findings.length + 1}`,
      severity: severity as "material" | "minor",
      category: category as Verdict["findings"][number]["category"],
      title,
      detail,
      evidence: [],
      suggestedResolution: suggested,
    });
  }
  const gaps = findings.some((f) => f.severity === "material") || priorFindings.some((p) => p.status === "still_open");
  const summary = await ask(
    `summary of your review (verdict ${gaps ? "MATERIAL_GAPS" : "NO_MATERIAL_GAPS"}): `,
    (a) => a.length > 0 && a.length <= 4000,
  );
  if (summary === null) return null;
  const verdict = ReviewVerdict.parse({
    schema: "review-verdict.v1",
    verdict: gaps ? "MATERIAL_GAPS" : "NO_MATERIAL_GAPS",
    summary,
    findings,
    priorFindings,
  });
  return verdict;
}
