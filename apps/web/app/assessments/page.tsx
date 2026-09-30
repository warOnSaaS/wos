import Link from "next/link";
import { Empty } from "@/components/Empty";
import { JsonLd } from "@/components/JsonLd";
import { MarkerKey, ScoreChart } from "@/components/ScoreChart";
import { Section } from "@/components/Section";
import {
  ASSESSMENTS_SOURCE_PATH,
  METRIC_GROUPS,
  READINESS_LABEL,
  RUNS,
  evaluatorOf,
  runDate,
  evaluators,
  reportUrl,
  versionMarks,
} from "@/lib/assessments";
import { breadcrumbLd, pageMetadata } from "@/lib/seo";
import { ASSESSMENTS_MD_PATH, ASSESSMENTS_PATH, WHITEPAPER_CHANGES_PATH, WHITEPAPER_PATH } from "@/lib/whitepaper";
import { hasVersionPage, versionPath } from "@/lib/whitepaper-history";

export const metadata = pageMetadata({
  title: "Assessments: how agents score the white paper",
  description:
    "warOnSaaS's own reference runs of the white paper's evaluation brief: each agent's scores for the problem and the approach, over time, by evaluator and paper version. Only recorded runs are shown.",
  path: ASSESSMENTS_PATH,
});

// Progressive enhancement only: shows the SHOW checkboxes and hides a series in every chart and the table.
// Without JS every series is shown and the legend still names each marker.
const SCRIPT = `(function(){
var boxes=document.querySelectorAll("[data-filter]");
boxes.forEach(function(b){b.hidden=false;var i=b.querySelector("input");i.addEventListener("change",function(){
var k=i.value;document.querySelectorAll('[data-series="'+k+'"]').forEach(function(el){el.classList.toggle("is-off",!i.checked)})})});
})();`;

export default function AssessmentsPage() {
  const runs = RUNS;
  const evs = evaluators(runs);
  const versions = versionMarks(runs);
  const dates = runs.map((r) => runDate(r)).sort();
  const domain: [string, string] = [dates[0] ?? "", dates[dates.length - 1] ?? ""];
  const latestFirst = [...runs].reverse();

  return (
    <>
      <div className="title">
        <p className="label">ASSESSMENTS // REFERENCE RUNS OF THE WHITE PAPER BRIEF</p>
        <h1>How agents score the white paper, over time.</h1>
        <p className="lead">
          We give the <Link href={WHITEPAPER_PATH}>white paper</Link>&apos;s public prompt, unchanged, to Claude and ChatGPT
          agents and record the scores each one gives: the problem on its own, then our approach against it. Every run is
          shown as recorded, low scores included. Nothing is averaged, estimated or filled in.
        </p>
        <p className="fine">
          Scores are comparable only within the same paper version, or across versions by reading the changes between
          them: <Link href={WHITEPAPER_CHANGES_PATH}>what changed in each version</Link>. Each run and each point links to
          the full text of the version it scored.
        </p>
      </div>

      <Section n="01" title="SCORES OVER TIME" id="scores" aside={`RUNS: ${runs.length}`}>
        {runs.length === 0 ? (
          <Empty title="No assessments recorded yet">
            No reference run has been recorded, so there is nothing to chart. Each run the founder records appears here
            with its date, the paper version it read and the evaluator that scored it: the problem&apos;s importance out of
            100 and its five rubric dimensions, each of the four theses, and the approach&apos;s effectiveness and
            credibility.
          </Empty>
        ) : (
          <>
            <div className="chart-legend" role="group" aria-label="Evaluators">
              <span className="label">EVALUATOR (SELF-REPORTED)</span>
              {evs.map((e) => (
                <span key={e.key} className="chart-legend__item" data-series-key={e.key}>
                  <MarkerKey evaluator={e} evaluators={evs} />
                  <code data-verbatim="">{e.marker === "other" ? `${e.model} (OTHER)` : e.model}</code>
                  <label data-filter="" hidden>
                    <input type="checkbox" value={e.key} defaultChecked /> SHOW
                  </label>
                </span>
              ))}
              <span className="fine">SOURCE: reference runs by warOnSaaS (the only source recorded).</span>
            </div>
            {METRIC_GROUPS.map((g) => (
              <div key={g.id} className="chart-group">
                <h3>{g.title}</h3>
                <p className="fine">{g.about}</p>
                <div className="charts">
                  {g.metrics.map((m) => (
                    <ScoreChart key={m.key} metric={m} runs={runs} evaluators={evs} versions={versions} domain={domain} />
                  ))}
                </div>
              </div>
            ))}
            <p className="fine">
              Vertical rules mark the first run on each paper version. Hover a marker for its value; the table below
              lists every value.
            </p>
          </>
        )}
      </Section>

      <Section n="02" title="RUNS" id="runs" aside="LATEST FIRST">
        {runs.length === 0 ? (
          <p>No runs yet. The table fills in as reference runs are recorded.</p>
        ) : (
          <table className="tbl">
            <caption>Every recorded run. Scores out of 100. The full report of each run is on GitHub.</caption>
            <thead>
              <tr>
                <th scope="col">DATE</th>
                <th scope="col">PAPER</th>
                <th scope="col">EVALUATOR</th>
                <th scope="col">RUN WITH</th>
                <th scope="col">IMPORTANCE</th>
                <th scope="col">EFFECTIVENESS</th>
                <th scope="col">CREDIBILITY</th>
                <th scope="col">READINESS</th>
                <th scope="col">VERDICT</th>
                <th scope="col">REPORT</th>
              </tr>
            </thead>
            <tbody>
              {latestFirst.map((r) => {
                const b = r.block;
                const d = runDate(r);
                const e = evaluatorOf(r, evs);
                return (
                  <tr key={r.id} data-series={e.key}>
                    <th scope="row" data-label="DATE">
                      <time dateTime={d}>{d}</time>
                    </th>
                    <td data-label="PAPER">
                      <span>
                        {hasVersionPage(r.servedPaperVersion) ? (
                          <Link href={versionPath(r.servedPaperVersion)}>v{r.servedPaperVersion}</Link>
                        ) : (
                          <>v{r.servedPaperVersion}</>
                        )}
                      </span>
                    </td>
                    <td data-label="EVALUATOR">
                      <span>
                        <MarkerKey evaluator={e} evaluators={evs} /> <code data-verbatim="">{b.evaluator.model}</code>{" "}
                        <span className="dim">
                          (<code data-verbatim="">{b.evaluator.product}</code>)
                        </span>
                      </span>
                    </td>
                    <td data-label="RUN WITH">
                      <code data-verbatim="">
                        {r.runner.cli} {r.runner.requestedModel}
                      </code>
                    </td>
                    <td data-label="IMPORTANCE">
                      <span>
                        <data value={b.stage1.importance.total}>{b.stage1.importance.total}</data>
                      </span>
                    </td>
                    <td data-label="EFFECTIVENESS">
                      <span>
                        <data value={b.stage2.effectiveness}>{b.stage2.effectiveness}</data>
                      </span>
                    </td>
                    <td data-label="CREDIBILITY">
                      <span>
                        <data value={b.stage2.credibility}>{b.stage2.credibility}</data>
                      </span>
                    </td>
                    <td data-label="READINESS">
                      <span>{READINESS_LABEL[b.stage2.readiness]}</span>
                    </td>
                    <td data-label="VERDICT">
                      <span>{b.stage2.verdict}</span>
                    </td>
                    <td data-label="REPORT">
                      <a href={reportUrl(r)}>FULL REPORT</a>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        <p className="fine">
          Every score of every run, including the rubric dimensions and the four theses, is also in{" "}
          <a href={ASSESSMENTS_MD_PATH}>/whitepaper/assessments.md</a>.
        </p>
      </Section>

      <Section n="03" title="HOW RUNS ARE MADE" id="method">
        <ul className="dash">
          <li>
            <span>
            The founder runs the public prompt from <Link href={WHITEPAPER_PATH}>/whitepaper</Link>, unchanged, with his
            own Claude Code and Codex subscriptions. A script checks the prompt against the live site, records the exact
            prompt&apos;s hash, and saves the agent&apos;s full report next to its scores.
            </span>
          </li>
          <li>
            <span>
            The paper asks every evaluating agent to end its report with a score block. The script reads that block and
            checks it against the published schema; it never types, adjusts or averages a score. A run whose block is
            missing or invalid is not recorded.
            </span>
          </li>
          <li>
            <span>
            The evaluator is what the agent reported about itself. It is not verified.
            </span>
          </li>
          <li>
            <span>
            Only these reference runs are recorded. Assessments from readers are not collected.
            </span>
          </li>
          <li>
            <span>
            No score appears in the white paper. Agents are asked to open this record only after writing their own scores,
            and then to say where and why they differ, so that earlier scores cannot anchor theirs.
            </span>
          </li>
        </ul>
        <p className="fine">
          SOURCE: {ASSESSMENTS_SOURCE_PATH} in the wOS repository ({runs.length === 0 ? "no runs yet" : "one JSON record and one report per run"}),
          copied into the site at build.
        </p>
      </Section>

      <script dangerouslySetInnerHTML={{ __html: SCRIPT }} />
      <JsonLd
        data={breadcrumbLd([
          { name: "warOnSaaS", path: "/" },
          { name: "Assessments", path: ASSESSMENTS_PATH },
        ])}
      />
    </>
  );
}
