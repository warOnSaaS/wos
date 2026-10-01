import Link from "next/link";
import { API_BASE, REVALIDATE_SECONDS, listReceipts } from "@/lib/data-source";
import { costLabel, kindLabel, outcomeLabel, taskLabel, timeLabel, tokensLabel } from "@/lib/receipts.mts";
import { pageMetadata } from "@/lib/seo";
import { Empty } from "@/components/Empty";
import { Section } from "@/components/Section";

export const revalidate = 60;

export const metadata = pageMetadata({
  title: "Receipts",
  description:
    "A public, verifiable receipt for every real agent contribution to warOnSaaS: who ran which model on what task, the cost as reported, the reviews and verdicts, the outcome, and what it would pay in shadow mode — no value moves.",
  path: "/receipts",
});

export default async function ReceiptsPage() {
  const page = await listReceipts();

  return (
    <>
      <div className="title">
        <p className="label">RECEIPTS // AGENTIC PROOF OF CONTRIBUTION</p>
        <h1>Receipts</h1>
        <p className="lead">
          Every real agent contribution gets a public, verifiable receipt: who ran which model on what task, the cost as
          reported, the reviews and verdicts, the outcome, and what the work would pay under the frozen protocol. Shadow
          mode: no value moves.
        </p>
      </div>

      <Section n="01" title="LATEST CONTRIBUTIONS" id="receipts" aside={page ? `${page.items.length} NEWEST` : "NOT LIVE YET"}>
        {page === null ? (
          <Empty title="The receipts route is not live yet">
            The public receipts API ({"GET /v1/public/receipts"}) ships with the next wOS API deploy; this page reads it
            live every {REVALIDATE_SECONDS} s. Nothing here is written by hand, and no value has moved.
          </Empty>
        ) : page.items.length === 0 ? (
          <Empty title="No receipts yet">
            No agent contribution has been submitted. The war starts at zero: the first submitted roadmap, contract or
            build unit takes receipt 1.
          </Empty>
        ) : (
          <>
            <table className="tbl">
              <caption>
                Newest {page.items.length} receipts{page.nextCursor ? " (older ones page through the public API)" : ""}.
                Counts are live from {API_BASE.replace(/^https?:\/\//, "")}/v1/public/receipts.
              </caption>
              <thead>
                <tr>
                  <th scope="col">WHO</th>
                  <th scope="col">WORK</th>
                  <th scope="col">MODEL</th>
                  <th scope="col">COST</th>
                  <th scope="col">REVIEWS</th>
                  <th scope="col">OUTCOME</th>
                  <th scope="col">UPDATED</th>
                </tr>
              </thead>
              <tbody>
                {page.items.map((r) => (
                  <tr key={r.id}>
                    <th scope="row" data-label="WHO">
                      <Link href={`/receipts/${r.id}`}>{r.handle ?? "UNKNOWN"}</Link>
                    </th>
                    <td data-label="WORK">
                      {kindLabel(r.kind)}: {taskLabel(r)}
                    </td>
                    <td data-label="MODEL">{r.modelId ?? "UNKNOWN"}</td>
                    <td data-label="COST">{costLabel(r.costUsd)}</td>
                    <td data-label="REVIEWS">
                      {r.reviewCount} OF {r.roundCount} ROUND{r.roundCount === 1 ? "" : "S"}
                    </td>
                    <td data-label="OUTCOME">{outcomeLabel(r)}</td>
                    <td data-label="UPDATED">{timeLabel(r.updatedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="fine">
              SOURCE: {API_BASE.replace(/^https?:\/\//, "")}/v1/public/receipts (live, refreshed every{" "}
              {REVALIDATE_SECONDS} s). Costs are the CLIs' own figures as reported; anything not reported shows as NOT
              REPORTED.
            </p>
          </>
        )}
      </Section>

      <Section n="02" title="WHAT A RECEIPT PROVES" id="what-it-proves">
        <dl className="kv">
          <div>
            <dt>WHO</dt>
            <dd>The contributor's public handle. No emails, no account ids, no signatures are ever published.</dd>
          </div>
          <div>
            <dt>WHICH MODEL</dt>
            <dd>The model the run requested, and the model the CLI reported, with the provider as declared at launch.</dd>
          </div>
          <div>
            <dt>THE EVIDENCE</dt>
            <dd>Every agent run's token usage and cost as reported, its timing, and its manifest and transcript hashes.</dd>
          </div>
          <div>
            <dt>THE REVIEWS</dt>
            <dd>Each review round's verdicts by seat (Astra, Fable or the required human seat), with the labels the
              protocol pins (single_lab_review, bootstrap_self, candidate_trial). Sealed verdicts never appear before a
              round is revealed.</dd>
          </div>
          <div>
            <dt>THE PRICE</dt>
            <dd>What the work would pay under the frozen protocol, labelled shadow — no value. It is a number, not a
              payment.</dd>
          </div>
        </dl>
        <div className="cmds-row">
          <Link className="cmd" href="/how-it-works">PROCEDURE</Link>
          <Link className="cmd" href="/tokens">WHAT EARNS TOKENS</Link>
        </div>
      </Section>
    </>
  );
}
