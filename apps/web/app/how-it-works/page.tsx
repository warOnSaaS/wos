import Link from "next/link";
import { PROGRESS_METRICS } from "@/lib/content";
import { pageMetadata } from "@/lib/seo";
import { Steps } from "@/components/Steps";

export const metadata = pageMetadata({
  title: "How it works",
  description:
    "How warOnSaaS builds open-source software: one public roadmap per target, two AI reviewers from two labs that must agree, small build tasks, and independent review before anything merges.",
  path: "/how-it-works",
});

export default function HowItWorks() {
  return (
    <>
      <section className="hero" aria-labelledby="h">
        <div className="wrap">
          <p className="kicker">From plan to merged code</p>
          <h1 id="h">How it works</h1>
          <p className="lede">
            A plan everyone agrees on, cut into tasks small enough for one AI agent, built on contributors’ own
            computers and checked by someone else before it merges.
          </p>
        </div>
      </section>

      <section className="section" aria-labelledby="steps-h">
        <div className="wrap">
          <h2 id="steps-h">The seven steps</h2>
          <Steps detailed />
        </div>
      </section>

      <section className="section" aria-labelledby="measure-h">
        <div className="wrap grid-2">
          <div>
            <h2 id="measure-h">How progress is measured</h2>
            <p>
              Each target shows three numbers. They are independent: a product can be fully mapped while almost
              nothing is built.
            </p>
            <p>
              Today every target is at 0% on all three. <Link href="/#sniper-list">See the Sniper List.</Link>
            </p>
          </div>
          <dl className="facts">
            {PROGRESS_METRICS.map((m) => (
              <div key={m.key}>
                <dt>{m.label} %</dt>
                <dd>{m.means}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      <section className="section" aria-labelledby="why-h">
        <div className="wrap grid-2">
          <div>
            <h2 id="why-h">Why two AIs?</h2>
            <p>
              One AI can miss what it does not know. Two models from two different labs, trained differently and
              working without seeing each other’s answer, are much less likely to miss the same thing. Nothing
              moves forward until both agree.
            </p>
          </div>
          <div className="panel">
            <p>
              <strong>Fable</strong> is Claude, made by Anthropic.
            </p>
            <p>
              <strong>Astra</strong> is ChatGPT, made by OpenAI.
            </p>
            <p className="fine">Both run at maximum reasoning effort for every review.</p>
          </div>
        </div>
      </section>

      <section className="section section--tight">
        <div className="wrap actions">
          <Link className="btn" href="/download">Download wOS</Link>
          <Link className="btn btn--ghost" href="/tokens">How tokens work</Link>
        </div>
      </section>
    </>
  );
}
