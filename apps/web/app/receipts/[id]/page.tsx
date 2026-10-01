import Link from "next/link";
import { notFound } from "next/navigation";
import { API_BASE, REVALIDATE_SECONDS, getReceipt } from "@/lib/data-source";
import {
  budgetLine,
  costLabel,
  formatAcu,
  kindLabel,
  outcomeLabel,
  reviewLabels,
  slotLabel,
  taskLabel,
  timeLabel,
  tokensLabel,
  verdictLabel,
  verifyLines,
} from "@/lib/receipts.mts";
import { pageMetadata } from "@/lib/seo";
import { Section } from "@/components/Section";

export const revalidate = 60;

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props) {
  const { id } = await params;
  const r = await getReceipt(id);
  if (!r) return {};
  return pageMetadata({
    title: `Receipt: ${r.handle ?? "unknown contributor"}`,
    description: `${kindLabel(r.kind)} work by ${r.handle ?? "an unknown contributor"} on ${taskLabel(r)}: ${
      r.reviewCount
    } review(s), outcome ${outcomeLabel(r)}. Shadow — no value.`,
    path: `/receipts/${r.id}`,
  });
}

export default async function ReceiptPage({ params }: Props) {
  const { id } = await params;
  const r = await getReceipt(id);
  if (!r) notFound();

  const header: [string, string][] = [
    ["WHO", r.handle ?? "UNKNOWN"],
    ["WORK", kindLabel(r.kind)],
    ["TASK", taskLabel(r)],
    ["TARGET", r.target ?? "UNKNOWN"],
    ["OUTCOME", outcomeLabel(r)],
    ["RUNS", String(r.runCount)],
    ["ROUNDS", String(r.roundCount)],
    ["REVIEWS", String(r.reviewCount)],
    ["CREATED", timeLabel(r.createdAt)],
    ["LAST UPDATE", timeLabel(r.updatedAt)],
    ...(r.trialLabel ? ([["TRIAL", r.trialLabel]] as [string, string][]) : []),
  ];

  return (
    <>
      <div className="title">
        <nav className="crumbs" aria-label="Breadcrumb">
          <ol>
            <li><Link href="/">Home</Link></li>
            <li><Link href="/receipts">Receipts</Link></li>
            <li aria-current="page">RECEIPT</li>
          </ol>
        </nav>
        <p className="label">RECEIPT // {r.kind.toUpperCase()} // SHADOW — NO VALUE</p>
        <h1>{r.handle ?? "Unknown contributor"} — {taskLabel(r)}</h1>
        <p className="lead">
          A public, verifiable receipt of one real agent contribution: {r.runCount} agent run
          {r.runCount === 1 ? "" : "s"}, {r.roundCount} review round{r.roundCount === 1 ? "" : "s"}, {r.reviewCount}{" "}
          verdict{r.reviewCount === 1 ? "" : "s"}, outcome {outcomeLabel(r)}.
        </p>
      </div>

      <Section n="01" title="THE WORK" id="work">
        <dl className="cells cells--text">
          {header.map(([k, v]) => (
            <div key={k}>
              <dt>{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
        <p className="fine">
          SOURCE: {API_BASE.replace(/^https?:\/\//, "")}/v1/public/receipts/{r.id} (live, refreshed every{" "}
          {REVALIDATE_SECONDS} s).
        </p>
      </Section>

      <Section n="02" title="AGENT RUNS" id="runs" aside={`${r.runs.length} RUN${r.runs.length === 1 ? "" : "S"}`}>
        {r.runs.length === 0 ? (
          <p className="fine">No stored agent run for this receipt.</p>
        ) : (
          <table className="tbl">
            <thead>
              <tr>
                <th scope="col">MODEL</th>
                <th scope="col">PROVIDER</th>
                <th scope="col">REASONING</th>
                <th scope="col">TOKENS</th>
                <th scope="col">COST</th>
                <th scope="col">TIMING</th>
              </tr>
            </thead>
            <tbody>
              {r.runs.map((run) => (
                <tr key={run.id}>
                  <th scope="row" data-label="MODEL">
                    {run.modelIdReported ?? run.modelIdRequested}
                    {run.modelIdReported ? <span className="fine"> (as reported)</span> : null}
                  </th>
                  <td data-label="PROVIDER">
                    {run.provider}
                    {run.launchProvider ? <span className="fine"> (declared launch: {run.launchProvider})</span> : null}
                  </td>
                  <td data-label="REASONING">{run.reasoning.toUpperCase()}</td>
                  <td data-label="TOKENS">{tokensLabel(run)}</td>
                  <td data-label="COST">{costLabel(run.costUsd)}</td>
                  <td data-label="TIMING">
                    {timeLabel(run.startedAt)} for {Math.round(run.durationSeconds)} s
                    {run.steps !== null ? `, ${run.steps} step${run.steps === 1 ? "" : "s"}` : ""}
                    {run.exitCode === null ? "" : `, exit ${run.exitCode}`}
                    {run.mode === "shadow" ? ", shadow run" : ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="fine">
          Token usage and cost are the CLI's own figures as reported by its event stream. Not reported shows as NOT
          REPORTED; nothing is estimated.
        </p>
      </Section>

      <Section n="03" title="REVIEW ROUNDS" id="rounds" aside={`${r.rounds.length} ROUND${r.rounds.length === 1 ? "" : "S"}`}>
        {r.rounds.length === 0 ? (
          <p className="fine">No review round yet: the work has not reached review.</p>
        ) : (
          r.rounds.map((round) => {
            const labels = reviewLabels(round);
            return (
              <div key={round.id} className="kv">
                <div>
                  <dt>ROUND {round.number}</dt>
                  <dd>
                    {round.state.toUpperCase()}
                    {round.outcome ? `, OUTCOME ${round.outcome.toUpperCase()}` : ""}
                    {round.revealedAt ? ` (revealed ${timeLabel(round.revealedAt)})` : ""}
                  </dd>
                </div>
                {round.reviews.length === 0 ? (
                  <div>
                    <dt>VERDICTS</dt>
                    <dd>
                      {round.state === "revealed"
                        ? "NONE RECORDED"
                        : "PENDING — verdicts are sealed until the round is revealed"}
                    </dd>
                  </div>
                ) : (
                  round.reviews.map((v, i) => (
                    <div key={`${round.id}-${v.slot}-${i}`}>
                      <dt>{slotLabel(v.slot).toUpperCase()}</dt>
                      <dd>
                        {v.handle ?? "UNKNOWN"}{v.modelId ? ` on ${v.modelId}` : ""}
                        {v.provider ? ` (${v.provider})` : ""}: {verdictLabel(v.verdict)}
                      </dd>
                    </div>
                  ))
                )}
                {labels.length > 0 ? (
                  <div>
                    <dt>LABELS</dt>
                    <dd>{labels.join("; ")}</dd>
                  </div>
                ) : null}
              </div>
            );
          })
        )}
      </Section>

      <Section n="04" title="OUTCOME" id="outcome">
        <dl className="cells cells--text">
          <div>
            <dt>STATE</dt>
            <dd>{r.outcome.state.toUpperCase()}</dd>
          </div>
          <div>
            <dt>MERGED</dt>
            <dd>{r.outcome.merged ? "YES" : "NO"}</dd>
          </div>
          <div>
            <dt>CONTRIBUTION</dt>
            <dd>{r.outcome.contribution ? r.outcome.contribution.toUpperCase() : "NOT RECORDED YET"}</dd>
          </div>
          <div>
            <dt>PULL REQUEST</dt>
            <dd>
              {r.outcome.pr ? (
                <a href={r.outcome.pr.url}>#{r.outcome.pr.number}</a>
              ) : (
                "NONE YET"
              )}
            </dd>
          </div>
        </dl>
      </Section>

      <Section n="05" title="SHADOW BUDGET" id="budget" aside="NO VALUE MOVES">
        {r.shadowBudget ? (
          <>
            <dl className="cells cells--text">
              <div>
                <dt>WOULD PAY</dt>
                <dd>{budgetLine(r.shadowBudget)}</dd>
              </div>
              <div>
                <dt>BUDGET MODEL</dt>
                <dd>{formatAcu(r.shadowBudget.budgetAcuMicro)} (micro-ACU: {r.shadowBudget.budgetAcuMicro})</dd>
              </div>
              <div>
                <dt>PUBLISHED BASE PRICE</dt>
                <dd>
                  {formatAcu(r.shadowBudget.basePriceAcuMicro)} (+{r.shadowBudget.queueBonusBp / 100}% queue bonus)
                </dd>
              </div>
              <div>
                <dt>BASIS</dt>
                <dd>
                  size {r.shadowBudget.sizePoints} point{r.shadowBudget.sizePoints === 1 ? "" : "s"}, difficulty{" "}
                  {r.shadowBudget.difficultyBp / 100}%, importance {r.shadowBudget.importanceBp / 100}% (the pinned
                  standard basis: production stores no per-task basis yet)
                </dd>
              </div>
              <div>
                <dt>POLICY</dt>
                <dd>
                  {r.shadowBudget.policy.capability} + {r.shadowBudget.policy.reward} (frozen protocol v1, D62)
                </dd>
              </div>
            </dl>
            <p className="fine">
              {r.shadowBudget.label}: this is what the task would pay under the frozen protocol. It is a number, not a
              payment — no tokens move, no ledger is written.
            </p>
          </>
        ) : (
          <p className="fine">No budget: this task kind is outside the frozen protocol's budget rows.</p>
        )}
      </Section>

      <Section n="06" title="VERIFY" id="verify">
        <dl className="kv">
          {verifyLines(r).map((line) => (
            <div key={line.label}>
              <dt>{line.label}</dt>
              <dd className="fine">{line.value}</dd>
            </div>
          ))}
        </dl>
        <p className="fine">
          The receipt hash is sha256 over this receipt's canonical JSON (hash field removed). Recompute it from the API
          answer at {API_BASE.replace(/^https?:\/\//, "")}/v1/public/receipts/{r.id} with the canonical rule (contracts
          C-1/C-2, receipt rule S-2).
        </p>
      </Section>
    </>
  );
}
