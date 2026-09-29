import Link from "next/link";
import { overall, programme, roadmapsOpen, targets } from "@/data/targets";
import { FAQ, OBJECTIVE, TOKENS } from "@/lib/content";
import { desktopAppLd, faqLd, pageMetadata, targetListLd } from "@/lib/seo";
import { SITE_DESCRIPTION, SITE_NAME } from "@/lib/site";
import { Section } from "@/components/Section";
import { TargetTable } from "@/components/TargetTable";
import { Procedure } from "@/components/Procedure";
import { Rules } from "@/components/Rules";
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
  const sitrep: [string, string][] = [
    ["Targets", String(targets.length)],
    ["Roadmaps open", String(roadmapsOpen())],
    ["Mapped", `${overall("mapped")}%`],
    ["Specified", `${overall("specified")}%`],
    ["Built", `${overall("built")}%`],
    ["Contributors", String(programme.contributors)],
    ["Accepted work", String(programme.acceptedContributions)],
    ["Tokens issued", String(programme.tokensIssued)],
  ];

  return (
    <>
      <div className="title">
        <p className="label">Operation order // warOnSaaS</p>
        <h1>Open-source replacements for the software you rent.</h1>
        <p>{SITE_DESCRIPTION}</p>
      </div>

      <Section n="01" title="Sitrep" id="sitrep" aside="Status: standby">
        <dl className="cells">
          {sitrep.map(([k, v]) => (
            <div key={k}>
              <dt>{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
        <p className="dim">Nothing has started. The numbers are real. The war starts at zero.</p>
      </Section>

      <Section n="02" title="Objective" id="objective">
        <p>{OBJECTIVE}</p>
      </Section>

      <Section n="03" title="Targets" id="targets" aside="The Sniper List">
        <TargetTable targets={targets} />
        <p className="fine">
          Mapped: share of the product on the roadmap. Specified: share with an agreed Feature Contract. Built: share
          merged. Measured separately.
        </p>
      </Section>

      <Section n="04" title="Procedure" id="procedure" aside={<Link href="/how-it-works">Full procedure</Link>}>
        <Procedure />
      </Section>

      <Section n="05" title="Rules of engagement" id="roe">
        <Rules />
      </Section>

      <Section n="06" title="Equipment" id="equipment" aside={<Link href="/download">Setup</Link>}>
        <DownloadBlock />
      </Section>

      <Section n="07" title="Tokens" id="tokens" aside={<Link href="/tokens">Detail</Link>}>
        <p>{TOKENS.intro} {TOKENS.rule}</p>
        <p><strong>{TOKENS.disclaimer}</strong> {TOKENS.notCrypto.replace("WOS tokens are not", "They are not")}</p>
      </Section>

      <Section n="08" title="FAQ" id="faq">
        <FaqList faq={FAQ} />
      </Section>

      <JsonLd data={targetListLd(targets)} />
      <JsonLd data={desktopAppLd} />
      <JsonLd data={faqLd(FAQ)} />
    </>
  );
}
