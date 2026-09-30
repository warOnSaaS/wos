import { Section } from "@/components/Section";
import { renderBlock } from "@/lib/markdown";
import { pageMetadata } from "@/lib/seo";
import { WHITEPAPER_CHANGES_PATH, WHITEPAPER_MD_PATH, WHITEPAPER_PATH, lastUpdatedDay, whitepaper } from "@/lib/whitepaper";

// The core white paper as one plain page, nothing collapsed, for agents that browse.
// ChatGPT's fetch tool refused /whitepaper.md when it was served as text/markdown, so the handoff prompt links here.
const wp = whitepaper();

export const metadata = pageMetadata({
  title: `White paper v${wp.version}: full text for agents`,
  description: "The complete core of the warOnSaaS white paper on one page, for AI agents to read and evaluate critically.",
  path: "/whitepaper/read",
});

export default function WhitepaperRead() {
  const day = lastUpdatedDay;
  return (
    <div className="wrap">
      <div className="sec">
        <p className="label">
          WHITE PAPER V{wp.version} · FULL TEXT{day ? ` · UPDATED ${day}` : ""} · <a href={WHITEPAPER_CHANGES_PATH}>CHANGES</a>
        </p>
        <p>
          The complete core, on one page, for AI agents. Plain text: <a href={WHITEPAPER_MD_PATH}>/whitepaper.md</a>. Handoff page:{" "}
          <a href={WHITEPAPER_PATH}>/whitepaper</a>. Every earlier version and what changed: <a href={WHITEPAPER_CHANGES_PATH}>/whitepaper/changes</a>.
        </p>
      </div>
      <div className="brief brief--single wp">
        <div className="brief-body">
          {wp.sections.map((s) => (
            <Section key={s.id} n={s.n ?? undefined} title={s.title} id={s.id}>
              {s.blocks.map((b, j) => renderBlock(b, `${s.id}-${j}`))}
            </Section>
          ))}
        </div>
      </div>
    </div>
  );
}
