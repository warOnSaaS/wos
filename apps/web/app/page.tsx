import Link from "next/link";
import { programme, targets } from "@/data/targets";
import { formatPercent, listTargets, sniperListTotals } from "@/lib/data-source";
import { desktopAppLd, pageMetadata, targetListLd } from "@/lib/seo";
import { lastShipped } from "@/lib/build-log";
import { getCliRelease } from "@/lib/cli-release";
import { SITE_DESCRIPTION, SITE_NAME } from "@/lib/site";
import { Section } from "@/components/Section";
import { TargetTable } from "@/components/TargetTable";
import { DownloadBlock } from "@/components/DownloadBlock";
import { JsonLd } from "@/components/JsonLd";

export const metadata = pageMetadata({
  title: `${SITE_NAME}: open-source replacements for the software you rent`,
  description: SITE_DESCRIPTION,
  path: "/",
  absoluteTitle: true,
});

export const revalidate = 60;

export default async function Home() {
  const totals = await sniperListTotals();
  const items = await listTargets();
  const shipped = lastShipped();
  const release = await getCliRelease();
  const sitrep: [string, string][] = [
    ["TARGETS", String(totals.targets)],
    ["ROADMAPS OPEN", String(totals.roadmapsOpen)],
    ["MAPPED", formatPercent(totals.mappedBp)],
    ["SPECIFIED", formatPercent(totals.specifiedBp)],
    ["BUILT", formatPercent(totals.builtBp)],
    ["CONTRIBUTORS", String(programme.contributors)],
    ["ACCEPTED WORK", String(programme.acceptedContributions)],
    ["TOKENS ISSUED", String(programme.tokensIssued)],
  ];

  return (
    <>
      <div className="title">
        <p className="label">OPERATION ORDER // <span>warOnSaaS</span></p>
        <h1>Open-source replacements for the software you rent.</h1>
        <p className="lead">
          warOnSaaS builds one open-source suite that replaces the biggest rented business software: one account, one
          web app, one phone app for iPhone and Android. Built one feature at a time by AI coding agents that
          contributors run on their own subscriptions.
        </p>
        <div className="cmds-row">
          <a className="cmd" href="#targets">SNIPER LIST</a>
          <Link className="cmd" href="/briefing">FULL BRIEFING</Link>
          <Link className="cmd" href="/contribute">HOW TO CONTRIBUTE</Link>
        </div>
      </div>

      <Section n="01" title="SITREP" id="sitrep" aside="STATUS: STANDBY">
        <dl className="cells">
          {sitrep.map(([k, v]) => (
            <div key={k}>
              <dt>{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
        <p>Nothing has started. The numbers are real. The war starts at zero.</p>
        {shipped ? (
          <p className="fine">
            LAST SHIPPED: {shipped.day} — <a href={shipped.url}>{shipped.short}</a> <code data-verbatim="">{shipped.subject}</code>.{" "}
            <Link href="/log">Build log</Link>.
          </p>
        ) : null}
      </Section>

      <Section n="02" title="THE SNIPER LIST" id="targets" aside="TGT-00 TO TGT-10">
        <TargetTable items={items} />
        <p className="fine">
          Each target is a parity profile: what the suite must do to fully replace that product, on web, iPhone and
          Android. Mapped: share on its roadmap. Specified: share with an agreed Feature Contract. Built: share merged.
        </p>
      </Section>

      <Section n="03" title="PROCEDURE" id="procedure" aside={<Link href="/how-it-works">FULL PROCEDURE</Link>}>
        <ol className="rules">
          <li>
            <span aria-hidden="true">01</span>
            <span>Each target gets one public roadmap. Two AI reviewers from two labs must both find no gaps.</span>
          </li>
          <li>
            <span aria-hidden="true">02</span>
            <span>Each feature gets a contract, cut into tasks small enough for one AI agent.</span>
          </li>
          <li>
            <span aria-hidden="true">03</span>
            <span>A contributor presses BUILD. Someone else reviews it. Only then does wOS open the PR.</span>
          </li>
        </ol>
        <div className="cmds-row">
          <Link className="cmd" href="/how-it-works">PROCEDURE AND RULES</Link>
          <Link className="cmd" href="/briefing">FULL BRIEFING</Link>
          <Link className="cmd" href="/tokens">TOKENS</Link>
          <Link className="cmd" href="/faq">FAQ</Link>
        </div>
      </Section>

      <Section n="04" title="EQUIPMENT" id="equipment" aside={<Link href="/contribute">SETUP</Link>}>
        <DownloadBlock release={release} />
      </Section>

      <JsonLd data={targetListLd(targets)} />
      <JsonLd data={desktopAppLd} />
    </>
  );
}
