import Link from "next/link";
import { PROGRESS_METRICS } from "@/lib/content";
import { pageMetadata } from "@/lib/seo";
import { Section } from "@/components/Section";
import { Procedure } from "@/components/Procedure";
import { Rules } from "@/components/Rules";

export const metadata = pageMetadata({
  title: "How it works",
  description:
    "How warOnSaaS builds open-source software: one public roadmap per target, two AI reviewers from two labs that must agree, small build tasks, and independent review before anything merges.",
  path: "/how-it-works",
});

export default function HowItWorks() {
  return (
    <>
      <div className="title">
        <p className="label">PROCEDURE // PLAN TO MERGE</p>
        <h1>How it works</h1>
        <p>
          One agreed plan per target. Cut into tasks small enough for one AI agent. Built on contributors’ machines.
          Checked by someone else before it merges.
        </p>
      </div>

      <Section n="01" title="PROCEDURE" id="procedure" aside="SEVEN STEPS">
        <Procedure detailed />
      </Section>

      <Section n="02" title="MEASURES" id="measures">
        <p>Each target reports three numbers. They are independent: a product can be fully mapped with nothing built.</p>
        <dl className="kv">
          {PROGRESS_METRICS.map((m) => (
            <div key={m.key}>
              <dt>{m.label} %</dt>
              <dd>{m.means}</dd>
            </div>
          ))}
        </dl>
        <p>
          Current value for every target: 0%. <Link href="/#targets">Targets</Link>.
        </p>
      </Section>

      <Section n="03" title="REVIEWERS" id="reviewers">
        <dl className="kv">
          <div>
            <dt>Fable</dt>
            <dd>Claude, by Anthropic.</dd>
          </div>
          <div>
            <dt>Astra</dt>
            <dd>ChatGPT, by OpenAI.</dd>
          </div>
          <div>
            <dt>Why two</dt>
            <dd>
              Two models from two labs, working without seeing each other’s answer, are less likely to miss the same
              gap. Nothing proceeds until both agree.
            </dd>
          </div>
        </dl>
        <p className="fine">Both run at maximum reasoning effort for every review.</p>
      </Section>

      <Section n="04" title="RULES OF ENGAGEMENT" id="roe">
        <Rules />
      </Section>

      <Section title="NEXT" id="next">
        <div className="cmds-row">
          <Link className="cmd" href="/download">DOWNLOAD wOS</Link>
          <Link className="cmd" href="/tokens">TOKENS</Link>
        </div>
      </Section>
    </>
  );
}
