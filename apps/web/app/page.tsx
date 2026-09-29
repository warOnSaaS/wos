import Link from "next/link";
import { targets } from "@/data/targets";
import { ABOUT, FAQ, TOKENS } from "@/lib/content";
import { desktopAppLd, faqLd, pageMetadata, targetListLd } from "@/lib/seo";
import { SITE_DESCRIPTION, SITE_NAME, TAGLINE } from "@/lib/site";
import { TargetList } from "@/components/TargetList";
import { Steps } from "@/components/Steps";
import { DownloadBlock } from "@/components/DownloadBlock";
import { FaqList } from "@/components/FaqList";
import { JsonLd } from "@/components/JsonLd";

export const metadata = pageMetadata({
  title: `${SITE_NAME}: open-source replacements for the software you rent`,
  description: SITE_DESCRIPTION,
  path: "/",
  absoluteTitle: true,
});

export default function Home() {
  const names = targets.map((t) => t.name);
  return (
    <>
      <section className="hero" aria-labelledby="hero-h">
        <div className="wrap">
          <p className="kicker">The war on rented software</p>
          <h1 id="hero-h">{TAGLINE}</h1>
          <p className="lede">
            warOnSaaS builds open-source replacements for the biggest rented business software, one feature at a
            time, with AI coding agents run by contributors on their own subscriptions.
          </p>
          <div className="actions">
            <a className="btn" href="#sniper-list">See the Sniper List</a>
            <Link className="btn btn--ghost" href="/download">Download wOS</Link>
          </div>
          <p className="hero__zero">
            <strong>0%</strong>
            <span>built so far, across all ten targets. The war starts at zero.</span>
          </p>
        </div>
      </section>

      <section className="section" id="sniper-list" aria-labelledby="list-h">
        <div className="wrap">
          <div className="section-head">
            <div>
              <p className="kicker">Ten targets, in order</p>
              <h2 id="list-h">The Sniper List</h2>
            </div>
            <p className="muted">
              {names.slice(0, -1).join(", ")} and {names[names.length - 1]}. Each gets its own public roadmap. Every
              number below is real, and every number is zero.
            </p>
          </div>
          <TargetList targets={targets} />
          <p className="fine" style={{ marginTop: "1.25rem" }}>
            Mapped: how much of the product is on the roadmap. Specified: how much has an agreed plan for each
            feature. Built: how much is merged. The three are measured separately.
          </p>
        </div>
      </section>

      <section className="section" id="how-it-works" aria-labelledby="how-h">
        <div className="wrap">
          <div className="section-head">
            <div>
              <p className="kicker">Seven steps</p>
              <h2 id="how-h">How it works</h2>
            </div>
            <Link href="/how-it-works">The full explanation</Link>
          </div>
          <Steps />
        </div>
      </section>

      <section className="section" id="tokens" aria-labelledby="tokens-h">
        <div className="wrap grid-2">
          <div>
            <p className="kicker">Keeping score</p>
            <h2 id="tokens-h">WOS tokens</h2>
            <p className="lede">{TOKENS.intro}</p>
            <p>{TOKENS.rule}</p>
            <p>
              <Link href="/tokens">What earns tokens</Link>
            </p>
          </div>
          <div className="panel">
            <p className="disclaimer">{TOKENS.disclaimer}</p>
            <p>{TOKENS.notCrypto}</p>
          </div>
        </div>
      </section>

      <section className="section" id="download" aria-labelledby="download-h">
        <div className="wrap">
          <div className="section-head">
            <div>
              <p className="kicker">Join the build</p>
              <h2 id="download-h">Download wOS</h2>
            </div>
            <Link href="/download">Setup instructions</Link>
          </div>
          <DownloadBlock />
        </div>
      </section>

      <section className="section" id="faq" aria-labelledby="faq-h">
        <div className="wrap">
          <p className="kicker">Questions</p>
          <h2 id="faq-h">FAQ</h2>
          <FaqList faq={FAQ} />
          <p className="fine" style={{ marginTop: "1.5rem" }}>{ABOUT.selfHost}</p>
        </div>
      </section>

      <JsonLd data={targetListLd(targets)} />
      <JsonLd data={desktopAppLd} />
      <JsonLd data={faqLd(FAQ)} />
    </>
  );
}
