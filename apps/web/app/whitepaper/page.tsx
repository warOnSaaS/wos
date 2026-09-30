import { JsonLd } from "@/components/JsonLd";
import { Section } from "@/components/Section";
import { renderBlock } from "@/lib/markdown";
import { breadcrumbLd, pageMetadata, whitepaperLd } from "@/lib/seo";
import {
  WHITEPAPER_HISTORY_URL,
  WHITEPAPER_MD_PATH,
  WHITEPAPER_META,
  WHITEPAPER_PATH,
  WHITEPAPER_SOURCE_URL,
  WHITEPAPER_V01_URL,
  lastUpdatedDay,
  whitepaper,
} from "@/lib/whitepaper";

const wp = whitepaper();

export const metadata = pageMetadata({
  title: `White paper v${wp.version}`,
  description:
    "The warOnSaaS white paper, a living document: budget-based Proof of Contribution, one open wOS product, the Sniper List, what exists today and what does not. Written for agents to evaluate critically.",
  path: WHITEPAPER_PATH,
  defaultImage: false,
  alternateMarkdown: WHITEPAPER_MD_PATH,
});

export default function WhitepaperPage() {
  return (
    <>
      <div className="title">
        <p className="label">WHITE PAPER // v{wp.version} // LIVING DOCUMENT</p>
        <h1>{wp.subtitle}</h1>
        <p className="lead">
          The design of warOnSaaS and wOS, and the evidence for it, in one document. It changes when the design
          changes. Every change is a commit with a changelog entry.
        </p>
        <div className="cmds-row">
          <a className="cmd" href={WHITEPAPER_MD_PATH} download="WHITEPAPER.md">
            DOWNLOAD MARKDOWN
          </a>
          <a className="cmd" href={WHITEPAPER_HISTORY_URL}>
            HISTORY ON GITHUB
          </a>
        </div>
      </div>

      <div className="sec" id="document">
        <dl className="kv">
          <div>
            <dt>Version</dt>
            <dd>{wp.version}</dd>
          </div>
          <div>
            <dt>Status</dt>
            <dd>{wp.status}</dd>
          </div>
          <div>
            <dt>Last updated</dt>
            <dd>
              {lastUpdatedDay && WHITEPAPER_META.commitUrl ? (
                <>
                  <time dateTime={WHITEPAPER_META.lastUpdated ?? undefined}>{lastUpdatedDay}</time>{" "}
                  <span className="fine">
                    from git, commit <a href={WHITEPAPER_META.commitUrl}>{WHITEPAPER_META.lastCommit?.slice(0, 7)}</a>
                  </span>
                </>
              ) : (
                "No commit yet"
              )}
            </dd>
          </div>
          <div>
            <dt>History</dt>
            <dd>
              <a href={WHITEPAPER_HISTORY_URL}>Every change to this file on GitHub</a>
            </dd>
          </div>
          <div>
            <dt>For agents</dt>
            <dd>
              <a href={WHITEPAPER_MD_PATH}>Plain Markdown</a> (the same text, one file).{" "}
              <a href={WHITEPAPER_SOURCE_URL}>Source</a>. <a href={WHITEPAPER_V01_URL}>v0.1, kept verbatim</a>.
            </dd>
          </div>
        </dl>
      </div>

      <div className="brief wp">
        <nav className="toc" aria-label="White paper contents">
          <p className="label">CONTENTS</p>
          <ol>
            {wp.sections.map((s) => (
              <li key={s.id}>
                <span aria-hidden="true">{s.n ?? "--"}</span>
                <a href={`#${s.id}`}>{s.title}</a>
              </li>
            ))}
          </ol>
        </nav>

        <div className="brief-body">
          {wp.sections.map((s) => (
            <Section key={s.id} n={s.n ?? undefined} title={s.title} id={s.id}>
              {s.blocks.map((b, j) => renderBlock(b, `${s.id}-${j}`))}
            </Section>
          ))}
        </div>
      </div>

      <JsonLd data={whitepaperLd(wp)} />
      <JsonLd
        data={breadcrumbLd([
          { name: "warOnSaaS", path: "/" },
          { name: "White paper", path: WHITEPAPER_PATH },
        ])}
      />
    </>
  );
}
