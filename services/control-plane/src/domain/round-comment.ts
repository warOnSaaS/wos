/**
 * The App's PR review comment for a revealed round (REVIEW-PROTOCOL section 6 step 5): one review with event COMMENT
 * (never APPROVE) on the document PR, pinned to the round's head. It carries both verdicts with their findings, the
 * models and reasoning (attested), the reviewer handles, the independence label and, under the D53 fallback, the
 * `single_lab_review` label with its reason.
 */
import type { ReviewVerdict } from "@waronsaas/contracts";
import type { Tx } from "@waronsaas/db";

const LIMIT = 60_000;
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const oneLine = (s: string) => s.replace(/\s+/g, " ").trim();

interface SeatRow {
  seat: "astra" | "fable" | "human";
  handle: string;
  model: string | null;
  reasoning: string | null;
  body: ReviewVerdict;
}

export async function roundCommentFor(
  tx: Tx,
  roundId: string,
): Promise<{ repo: string; prNumber: number; headSha: string; body: string } | null> {
  const [r] = await tx<
    {
      round_number: number;
      head_sha: string;
      submission_sha256: string;
      outcome: string | null;
      independence: string | null;
      review_label: string | null;
      review_label_reason: string | null;
      trial_label: string | null;
      state: string;
      repo: string | null;
      pr_number: number | null;
      kind: string | null;
    }[]
  >`
    select r.round_number, r.head_sha, r.submission_sha256, r.outcome, r.independence, r.review_label, r.review_label_reason,
           to_jsonb(r) ->> 'trial_label' as trial_label, r.state,
           d.repo_full_name as repo, d.pr_number, d.kind
      from wos.rounds r left join wos.documents d on d.id = r.document_id where r.id = ${roundId}`;
  if (r?.state !== "revealed" || !r.repo || r.pr_number === null) return null;
  const agents = await tx<SeatRow[]>`
    select v.slot as seat, coalesce(a.github_login, a.handle, 'unknown') as handle, v.model_id as model, v.reasoning, v.body
      from wos.reviews v join wos.accounts a on a.id = v.account_id where v.round_id = ${roundId} order by v.slot`;
  const humans = await tx<(SeatRow & { bootstrap_self?: boolean })[]>`
    select 'human' as seat, coalesce(a.github_login, a.handle, 'unknown') as handle, null as model, null as reasoning, h.body,
           coalesce((to_jsonb(h) ->> 'bootstrap_self')::boolean, false) as bootstrap_self
      from wos.round_human_reviews h join wos.accounts a on a.id = h.account_id where h.round_id = ${roundId}`;
  const seats: Array<SeatRow & { bootstrap_self?: boolean }> = [...agents, ...humans];
  const founderSeat = humans.some((x) => x.bootstrap_self);
  const label =
    r.review_label === "single_lab_review"
      ? `**single_lab_review**: ${r.review_label_reason ?? ""}. Devnet/shadow accounting only (D53).`
      : null;
  const head = [
    `## wOS review, round ${r.round_number}: ${r.outcome === "consensus" ? "CONSENSUS (no material gaps)" : "MATERIAL GAPS"}`,
    "",
    `Head \`${r.head_sha}\`, submission \`${r.submission_sha256}\`. Independence: \`${r.independence ?? "unknown"}\`${r.independence === "bootstrap_self" ? " (Bootstrap review: not yet independently cross-reviewed)" : ""}.`,
    ...(label ? ["", label] : []),
    ...(r.trial_label
      ? [
          "",
          `**${r.trial_label}** (D69): a maintainer designated this work for the candidate model \`${r.trial_label.slice("candidate_trial:".length)}\` (identity self-reported, D52). It is reviewed and may merge like any other work.`,
        ]
      : []),
    ...(founderSeat
      ? [
          "",
          "**bootstrap_self** (D67): the human seat was held by the bootstrap founder on the founder's own work. This work stays PROVISIONAL (D23) and gets an independent re-review after bootstrap ends.",
        ]
      : []),
    "",
    "This comment records the reviews. It is not an approval: merging needs `wos/consensus`, `wos-verify` and a Code Owner review.",
  ];
  const sections = seats.map((s) => {
    const who =
      s.seat === "human"
        ? `### Human review (required seat under \`fable_unavailable\`) by @${s.handle}${s.bootstrap_self ? " (bootstrap_self, D67)" : ""}`
        : `### ${s.seat === "astra" ? "Astra" : "Fable"} ${String(s.reasoning ?? "").toUpperCase()} (attested, \`${s.model}\`) by @${s.handle}`;
    const findings = s.body.findings.map(
      (f) =>
        `- **${f.localId}** ${f.severity.toUpperCase()} \`${f.category}\`: ${oneLine(f.title)}. ${clip(oneLine(f.detail), 1500)}${
          f.suggestedResolution ? ` Suggested: ${clip(oneLine(f.suggestedResolution), 600)}` : ""
        }`,
    );
    const prior = s.body.priorFindings.map(
      (p) => `- prior \`${p.findingId}\`: ${p.status}${p.note ? `, ${clip(oneLine(p.note), 400)}` : ""}`,
    );
    return [
      who,
      "",
      `Verdict: **${s.body.verdict}**`,
      "",
      clip(s.body.summary, 3000),
      ...(findings.length ? ["", "Findings:", ...findings] : ["", "No findings."]),
      ...(prior.length ? ["", "Prior findings re-checked:", ...prior] : []),
    ].join("\n");
  });
  let body = [...head, "", ...sections].join("\n");
  if (body.length > LIMIT)
    body = `${body.slice(0, LIMIT)}\n\n(truncated: the full findings are in wOS, /v1/public/activity and the round record)`;
  return { repo: r.repo, prNumber: r.pr_number, headSha: r.head_sha, body };
}
