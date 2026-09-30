import Link from "next/link";
import { BRIEFING, BRIEFING_INTRO } from "@/lib/briefing";
import { pageMetadata } from "@/lib/seo";
import { Section } from "@/components/Section";
import { BriefingBlock } from "@/components/BriefingBlock";

export const metadata = pageMetadata({
  title: "Briefing: how warOnSaaS works",
  description:
    "The full warOnSaaS briefing: the mission, the Sniper List, the four PR types, the shared Feature Catalog, progress tracking, leases, independent review, gated PRs, tokens, sign-in and models.",
  path: "/briefing",
});

export default function Briefing() {
  return (
    <>
      <div className="title">
        <p className="label">BRIEFING // FULL SYSTEM</p>
        <h1>How warOnSaaS works</h1>
        <p className="lead">{BRIEFING_INTRO}</p>
      </div>

      <div className="brief">
        <nav className="toc" aria-label="Briefing contents">
          <p className="label">CONTENTS</p>
          <ol>
            {BRIEFING.map((s, i) => (
              <li key={s.id}>
                <span aria-hidden="true">{String(i + 1).padStart(2, "0")}</span>
                <a href={`#${s.id}`}>{s.title}</a>
              </li>
            ))}
          </ol>
        </nav>

        <div className="brief-body">
          {BRIEFING.map((s, i) => (
            <Section key={s.id} n={String(i + 1).padStart(2, "0")} title={s.title.toUpperCase()} id={s.id}>
              {s.blocks.map((b, j) => (
                <BriefingBlock key={j} block={b} />
              ))}
            </Section>
          ))}
          <Section title="NEXT" id="next">
            <div className="cmds-row">
              <Link className="cmd" href="/targets/waronsaas">TGT-00 FEATURE PROPOSAL</Link>
              <Link className="cmd" href="/#targets">SNIPER LIST</Link>
              <Link className="cmd" href="/contribute">HOW TO CONTRIBUTE</Link>
            </div>
          </Section>
        </div>
      </div>
    </>
  );
}
