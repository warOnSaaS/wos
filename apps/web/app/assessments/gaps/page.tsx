import Link from "next/link";
import { Empty } from "@/components/Empty";
import { JsonLd } from "@/components/JsonLd";
import { Section } from "@/components/Section";
import { CONVENTION, GAP_REGISTER, GAPS_MD_PATH, GAPS_PATH, MATCHING_RULE, gapReportUrl, statusText } from "@/lib/gaps";
import { breadcrumbLd, pageMetadata } from "@/lib/seo";
import { ASSESSMENTS_PATH, WHITEPAPER_CHANGES_PATH, WHITEPAPER_PATH } from "@/lib/whitepaper";
import { hasVersionPage, versionPath } from "@/lib/whitepaper-history";

export const metadata = pageMetadata({
  title: "Gap register: what our self-assessments found, and what we did",
  description:
    "Every gap warOnSaaS's own self-assessments found in the white paper, per version, with its status: open, addressed in a later version, or declined with a reason. Matched by exact id only.",
  path: GAPS_PATH,
  alternateMarkdown: GAPS_MD_PATH,
});

const V = ({ v }: { v: string }) => (hasVersionPage(v) ? <Link href={versionPath(v)}>v{v}</Link> : <>v{v}</>);

export default function GapsPage() {
  const R = GAP_REGISTER;
  const open = R.gaps.filter((g) => g.status === "open").length;
  return (
    <>
      <div className="title">
        <p className="label">
          ASSESSMENTS // <Link href={ASSESSMENTS_PATH}>SCORES</Link> // GAP REGISTER
        </p>
        <h1>What our self-assessments found missing, and what we did about it.</h1>
        <p className="lead">
          Every version of the <Link href={WHITEPAPER_PATH}>white paper</Link> ships with a self-assessment: our own
          reference run of the public prompt. Since v0.9 each run lists the gaps it found. This register keeps every gap
          from the latest run of each version, with what became of it.
        </p>
        <p className="fine">
          If you are an agent evaluating the paper: read this only after you have written your own score block. For
          agents, the same register as text: <a href={GAPS_MD_PATH}>/assessments/gaps.md</a>.
        </p>
      </div>

      <Section n="01" title="GAPS" id="gaps" aside={`GAPS: ${R.gaps.length} · OPEN: ${open}`}>
        {R.gaps.length === 0 ? (
          <Empty title="No gaps recorded yet">
            No recorded run lists gaps yet. Runs before paper v0.9 used a score block without them; the first run of v0.9
            will fill this register.
          </Empty>
        ) : (
          <table className="tbl">
            <caption>Newest version first, then by severity. Each gap as the agent wrote it; the full report is on GitHub.</caption>
            <thead>
              <tr>
                <th scope="col">ID</th>
                <th scope="col">GAP</th>
                <th scope="col">CONCERNS</th>
                <th scope="col">SEVERITY</th>
                <th scope="col">FOUND IN</th>
                <th scope="col">STATUS</th>
                <th scope="col">REPORT</th>
              </tr>
            </thead>
            <tbody>
              {R.gaps.map((g) => (
                <tr key={`${g.version}-${g.id}`}>
                  <th scope="row" data-label="ID">
                    <code data-verbatim="">{g.id}</code>
                  </th>
                  <td data-label="GAP">
                    <code data-verbatim="">{g.title}</code>
                  </td>
                  <td data-label="CONCERNS">
                    <span>
                      <code data-verbatim="">{g.concerns}</code> <span className="dim">(PART {g.part})</span>
                    </span>
                  </td>
                  <td data-label="SEVERITY">
                    <span>{g.severity.toUpperCase()}</span>
                  </td>
                  <td data-label="FOUND IN">
                    <span>
                      <V v={g.version} />
                      {g.alsoReportedIn.length ? (
                        <span className="dim">
                          {" "}
                          (same id also in {g.alsoReportedIn.map((v) => `v${v}`).join(", ")})
                        </span>
                      ) : null}
                    </span>
                  </td>
                  <td data-label="STATUS">
                    <code data-verbatim="">{statusText(g)}</code>
                  </td>
                  <td data-label="REPORT">
                    <a href={gapReportUrl(g)}>FULL REPORT</a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {R.unknownCitations.length ? (
          <p className="fine">
            Changelog citations that match no recorded gap:{" "}
            {R.unknownCitations.map((c, i) => (
              <span key={`${c.version}-${c.id}`}>
                {i ? "; " : ""}v{c.version} {c.kind} <code>{c.id}</code>
              </span>
            ))}
            .
          </p>
        ) : null}
      </Section>

      <Section n="02" title="HOW GAPS ARE MATCHED AND CLOSED" id="rules">
        <ul className="dash">
          <li>
            <span>{MATCHING_RULE}</span>
          </li>
          <li>
            <span>{CONVENTION}</span>
          </li>
          <li>
            <span>
              Only the latest run of each version is used (the same run the version&apos;s self-assessment shows). A version
              whose runs predate the gap list has no entry.
            </span>
          </li>
          <li>
            <span>
              The build warns, and does not fail, when a new version leaves a high-severity gap of the previous version
              unmentioned in its changelog. <Link href={WHITEPAPER_CHANGES_PATH}>Every version and its changelog</Link>.
            </span>
          </li>
        </ul>
      </Section>

      <JsonLd
        data={breadcrumbLd([
          { name: "warOnSaaS", path: "/" },
          { name: "Assessments", path: ASSESSMENTS_PATH },
          { name: "Gap register", path: GAPS_PATH },
        ])}
      />
    </>
  );
}
