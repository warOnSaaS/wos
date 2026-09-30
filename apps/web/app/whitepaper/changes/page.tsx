import Link from "next/link";
import { JsonLd } from "@/components/JsonLd";
import { Section } from "@/components/Section";
import { SelfAssessment } from "@/components/SelfAssessment";
import { runDate, reportUrl } from "@/lib/assessments";
import { parse, renderBlock } from "@/lib/markdown";
import { GAP_REGISTER, GAPS_PATH } from "@/lib/gaps";
import { PENDING_LABEL } from "@/lib/self-assessment";
import { breadcrumbLd, pageMetadata } from "@/lib/seo";
import { ASSESSMENTS_PATH, WHITEPAPER_CHANGES_MD_PATH, WHITEPAPER_CHANGES_PATH, WHITEPAPER_PATH, WHITEPAPER_READ_PATH } from "@/lib/whitepaper";
import {
  HISTORY,
  PART_I_FLAG,
  type HistoryVersion,
  UNMATCHED_RUNS,
  VERSIONS_NEWEST_FIRST,
  reportedVersionDiffers,
  runsFor,
  versionDay,
  versionPath,
} from "@/lib/whitepaper-history";
import type { Run } from "@/lib/assessments";

export const metadata = pageMetadata({
  title: "White paper changes: every version, what changed and why",
  description:
    "Every version of the warOnSaaS white paper, newest first, generated from git: the changelog entry, the diff, which companion files changed, whether Part I (the thesis and its numbers) moved, and the reference assessments recorded against it.",
  path: WHITEPAPER_CHANGES_PATH,
  alternateMarkdown: WHITEPAPER_CHANGES_MD_PATH,
});

const anchor = (v: string) => `v${v.replace(/\./g, "-")}`;
const short = (sha: string) => sha.slice(0, 7);

function Scores({ runs }: { runs: Run[] }) {
  return (
    <table className="tbl" data-scores="">
      <caption>Reference runs recorded against this version (servedPaperVersion). Each score as recorded.</caption>
      <thead>
        <tr>
          <th scope="col">DATE</th>
          <th scope="col">EVALUATOR</th>
          <th scope="col">IMPORTANCE /100</th>
          <th scope="col">EFFECTIVENESS /100</th>
          <th scope="col">CREDIBILITY /100</th>
          <th scope="col">REPORT</th>
        </tr>
      </thead>
      <tbody>
        {runs.map((r) => (
          <tr key={r.id}>
            <th scope="row" data-label="DATE">
              <time dateTime={runDate(r)}>{runDate(r)}</time>
            </th>
            <td data-label="EVALUATOR">
              <span>
                <code data-verbatim="">{r.block.evaluator.model}</code>
                {reportedVersionDiffers(r) ? <span className="dim"> (the agent reported v{r.block.paperVersion})</span> : null}
              </span>
            </td>
            <td data-label="IMPORTANCE /100">
              <data value={r.block.stage1.importance.total}>{r.block.stage1.importance.total}</data>
            </td>
            <td data-label="EFFECTIVENESS /100">
              <data value={r.block.stage2.effectiveness}>{r.block.stage2.effectiveness}</data>
            </td>
            <td data-label="CREDIBILITY /100">
              <data value={r.block.stage2.credibility}>{r.block.stage2.credibility}</data>
            </td>
            <td data-label="REPORT">
              <a href={reportUrl(r)}>FULL REPORT</a>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Version({ v }: { v: HistoryVersion }) {
  const day = versionDay(v);
  const runs = runsFor(v.version);
  const id = anchor(v.version);
  return (
    <Section title={`v${v.version}`} id={id} aside={`${v.current ? "CURRENT · " : ""}${day ?? "NO DATE IN GIT"}`}>
      {v.partI?.changed ? (
        <div className="wp-flag" role="note">
          <strong>{PART_I_FLAG}</strong>
          <p className="fine">
            {v.partI.sections.length ? (
              <>
                Changed in Part I:{" "}
                {v.partI.sections.map((s, i) => (
                  <span key={s}>
                    {i ? "; " : ""}
                    <code data-verbatim="">{s.replace(/^##\s+/, "")}</code>
                  </span>
                ))}
                .{" "}
              </>
            ) : null}
            {v.partI.files.length ? (
              <>
                Changed files behind Part I&apos;s numbers:{" "}
                {v.partI.files.map((f, i) => (
                  <span key={f}>
                    {i ? ", " : ""}
                    <code>{f}</code>
                  </span>
                ))}
                .
              </>
            ) : null}
          </p>
        </div>
      ) : null}

      {v.note ? <p className="fine">{v.note}</p> : null}

      <dl className="kv">
        <div>
          <dt>Full text</dt>
          <dd>
            {v.snapshot ? (
              <>
                <Link href={versionPath(v.version)}>Read v{v.version} in full</Link>{" "}
                <span className="fine">
                  (<a href={v.snapshot.sourceUrl}>source{v.lastCommit ? ` at ${short(v.lastCommit.sha)}` : v.addedIn ? ` at ${short(v.addedIn.sha)}` : " on main"}</a>)
                </span>
              </>
            ) : (
              "No text of this version exists in git."
            )}
          </dd>
        </div>
        <div>
          <dt>Diff</dt>
          <dd>
            {v.compare ? (
              <>
                <a href={v.compare.url}>
                  v{v.previous} to v{v.version} on GitHub
                </a>{" "}
                <span className="fine">
                  ({short(v.compare.from)}...{v.compare.to === "main" ? "main" : short(v.compare.to)})
                </span>
              </>
            ) : v.separateCommit ? (
              "None: the first committed version, nothing earlier to compare with."
            ) : (
              "None: no separate commit."
            )}
          </dd>
        </div>
        {v.commits?.length ? (
          <div>
            <dt>Commits</dt>
            <dd>
              {v.commits.map((c, i) => (
                <span key={c.sha}>
                  {i ? "; " : ""}
                  <a href={c.url}>{short(c.sha)}</a> <span className="dim">{c.date.slice(0, 10)}</span> <code data-verbatim="">{c.subject}</code>
                </span>
              ))}
            </dd>
          </div>
        ) : null}
        {v.separateCommit ? (
          <div>
            <dt>Companion files changed</dt>
            <dd>
              {v.companionsChanged.length
                ? v.companionsChanged.map((f, i) => (
                    <span key={f}>
                      {i ? ", " : ""}
                      <code>{f}</code>
                    </span>
                  ))
                : "None"}
            </dd>
          </div>
        ) : null}
        <div>
          <dt>Part I</dt>
          <dd>
            {v.partI === null
              ? "Not compared: no earlier committed version."
              : v.partI.changed
                ? "Changed (see above)."
                : "Unchanged."}
          </dd>
        </div>
      </dl>

      <p className="label">
        CHANGELOG ENTRY{v.changelog ? ` · VERBATIM FROM ${v.changelog.source.split("/").pop()}` : ""}
      </p>
      {v.changelog ? (
        <div className="wp wp-changelog">{parse(v.changelog.text).map((b, j) => renderBlock(b, `${id}-cl-${j}`))}</div>
      ) : (
        <p>No changelog entry for this version was found in the paper or APPENDICES.md.</p>
      )}

      <p className="label">
        SELF-ASSESSMENT OF v{v.version}
        {v.current && !runs.length ? ` · ${PENDING_LABEL}` : ""}
      </p>
      {runs.length ? (
        <>
          <SelfAssessment run={runs.at(-1)!} version={v.version} compact headingLevel={4} />
          <Scores runs={runs} />
        </>
      ) : v.current ? (
        <>
          <SelfAssessment run={null} version={v.version} compact headingLevel={4} />
          <p>
            No reference run recorded yet. Every version ships with a self-assessment; this one is recorded after v{v.version}{" "}
            reaches the site, and the next version cannot ship until it is.
          </p>
        </>
      ) : (
        <p>No reference run recorded.</p>
      )}
      {GAP_REGISTER.gaps.some((g) => g.version === v.version) ? (
        <p className="fine">
          Gaps this version&apos;s self-assessment found, and what became of them:{" "}
          <Link href={`${GAPS_PATH}#gaps`}>the gap register</Link>.
        </p>
      ) : null}
    </Section>
  );
}

export default function WhitepaperChanges() {
  return (
    <>
      <div className="title">
        <p className="label">WHITE PAPER // CHANGES // GENERATED FROM GIT</p>
        <h1>Every version of the white paper, and what changed.</h1>
        <p className="lead">
          The paper is a living document that agents score over time. So every change is traceable here: what changed
          and why, the diff, every past version in full, and which scores were given against which version. Current
          version: <Link href={WHITEPAPER_READ_PATH}>v{HISTORY.current}</Link>.
        </p>
      </div>

      <Section n="00" title="HOW TO READ THIS" id="how">
        <ul className="dash">
          <li>
            <span>
              Generated at build from git: each version is the Version row of the paper&apos;s header table at each commit;
              the changelog entry is quoted verbatim; the diff is a GitHub compare link. Nothing here is written by hand.
            </span>
          </li>
          <li>
            <span>
              PART I CHANGED marks a version whose diff touches Part I (sections 1 to 4: the thesis, the materiality
              estimates and what Part I does not claim; in the paper since v0.6), decided from the section headings in the
              diff, or that changed <code>MATERIALITY.md</code> or <code>tools/materiality/model.ts</code>. Part II changes
              are not flagged.
            </span>
          </li>
          <li>
            <span>
              Scores are comparable only within the same paper version, or across versions by reading the changes between
              them. All runs, charted: <Link href={ASSESSMENTS_PATH}>/assessments</Link>.
            </span>
          </li>
          <li>
            <span>
              If you are an agent evaluating the paper: the scores below are the recorded trend. Read them only after you
              have written your own score block. For agents, the same history without scores:{" "}
              <a href={WHITEPAPER_CHANGES_MD_PATH}>/whitepaper/changes.md</a>.
            </span>
          </li>
        </ul>
      </Section>

      {VERSIONS_NEWEST_FIRST.map((v) => (
        <Version key={v.version} v={v} />
      ))}

      {UNMATCHED_RUNS.length ? (
        <Section title="RUNS AGAINST A VERSION NOT IN THE HISTORY" id="unmatched">
          <p className="fine">Recorded runs whose served paper version is not a version found in git. Shown apart, never attached to a guess.</p>
          <Scores runs={UNMATCHED_RUNS} />
        </Section>
      ) : null}

      <Section title="SOURCE" id="source">
        <p className="fine">
          Generated by apps/web/scripts/gen-whitepaper-history.mjs into apps/web/generated/whitepaper-history.json. The
          build fails if the paper changes without a version bump and a changelog entry (scripts/check-whitepaper-version.mjs).{" "}
          <Link href={WHITEPAPER_PATH}>Back to the white paper</Link>.
        </p>
      </Section>

      <JsonLd
        data={breadcrumbLd([
          { name: "warOnSaaS", path: "/" },
          { name: "White paper", path: WHITEPAPER_PATH },
          { name: "Changes", path: WHITEPAPER_CHANGES_PATH },
        ])}
      />
    </>
  );
}
