import Link from "next/link";
import { notFound } from "next/navigation";
import { getTarget, roadmapState, roadmapStatus, roadmapTitle, targetStatus, targets } from "@/data/targets";
import { PROGRESS_METRICS } from "@/lib/content";
import { breadcrumbLd, pageMetadata } from "@/lib/seo";
import { LINKS, TOKEN_DISCLAIMER } from "@/lib/site";
import { Section } from "@/components/Section";
import { Bar } from "@/components/Bar";
import { JsonLd } from "@/components/JsonLd";

export const dynamicParams = false;

export function generateStaticParams() {
  return targets.map((t) => ({ slug: t.slug }));
}

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props) {
  const { slug } = await params;
  const t = getTarget(slug);
  if (!t) return {};
  return pageMetadata({
    title: `Open-source ${t.name} alternative`,
    description: `warOnSaaS is building an open-source, self-hostable ${t.name} alternative, one feature at a time. ${t.whatItIs} Progress today: mapped ${t.mapped}%, specified ${t.specified}%, built ${t.built}%.`,
    path: `/targets/${t.slug}`,
    defaultImage: false,
  });
}

export default async function TargetPage({ params }: Props) {
  const { slug } = await params;
  const t = getTarget(slug);
  if (!t) notFound();

  const header: [string, string][] = [
    ["ID", t.id],
    ["DESIGNATION", t.name],
    ["CATEGORY", t.category],
    ["STATUS", targetStatus(t)],
    ["ROADMAP", roadmapState(t)],
    ["SELF-HOSTED", t.selfHosted ? "Available" : "Not yet"],
    ["HOSTED", t.hosted ? "Running" : "Not yet"],
    ["CONTRIBUTORS", "0"],
  ];

  return (
    <>
      <div className="title">
        <nav className="crumbs" aria-label="Breadcrumb">
          <ol>
            <li><Link href="/">Home</Link></li>
            <li><Link href="/#targets">Targets</Link></li>
            <li><span aria-current="page">{t.id}</span></li>
          </ol>
        </nav>
        <p className="label">TARGET DOSSIER // {t.id}</p>
        <h1>Open-source {t.name} alternative</h1>
        <p>
          {t.name}: {t.whatItIs} warOnSaaS is building an open-source replacement you can run yourself, one feature at
          a time.
        </p>
      </div>

      <Section n="01" title="HEADER" id="header">
        <dl className="cells">
          {header.map(([k, v]) => (
            <div key={k}>
              <dt>{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
      </Section>

      <Section n="02" title="PROGRESS" id="progress" aside="THREE INDEPENDENT MEASURES">
        <div className="readout">
          {PROGRESS_METRICS.map((m) => (
            <div key={m.key}>
              <span className="label">{m.label.toUpperCase()}</span>
              <span className="readout__n">{t[m.key]}%</span>
              <Bar value={t[m.key]} cells={20} showValue={false} />
              <p className="fine">{m.means}</p>
            </div>
          ))}
        </div>
      </Section>

      <Section n="03" title="ROADMAP" id="roadmap">
        <dl className="kv">
          <div>
            <dt>Canonical PR</dt>
            <dd>“{roadmapTitle(t)}”</dd>
          </div>
          <div>
            <dt>State</dt>
            <dd>
              {t.roadmapPr ? <a href={t.roadmapPr}>{roadmapStatus(t)}</a> : roadmapStatus(t)}
            </dd>
          </div>
          <div>
            <dt>Consensus</dt>
            <dd>
              {t.roadmapPr ? "See the roadmap PR." : "Not reached."} Requires Fable and Astra to both report no material
              gaps.
            </dd>
          </div>
        </dl>
      </Section>

      <Section n="04" title="SCOPE" id="scope" aside="PROVISIONAL OUTLINE">
        <p>{t.name} is: {t.whatItIs.charAt(0).toLowerCase() + t.whatItIs.slice(1)} The replacement is expected to cover, in broad strokes:</p>
        <ul className="rules">
          {t.replacementCovers.map((c, i) => (
            <li key={c}>
              <span aria-hidden="true">S-{i + 1}</span>
              <span>{c}</span>
            </li>
          ))}
        </ul>
        <p className="fine">Provisional. The public roadmap sets the exact scope. This is not a feature commitment.</p>
      </Section>

      <Section n="05" title="HOW TO CONTRIBUTE" id="contribute">
        <ol className="proc">
          <li>
            <span className="proc__n" aria-hidden="true">01</span>
            <div>
              <h3>Find the roadmap</h3>
              <p>
                All work on this target goes into one pull request: “{roadmapTitle(t)}”.{" "}
                {t.roadmapPr ? (
                  <a href={t.roadmapPr}>Open it.</a>
                ) : (
                  <>
                    Not opened yet. It will appear in the <a href={LINKS.pullRequests}>warOnSaaS pull requests</a> and
                    on this page.
                  </>
                )}
              </p>
            </div>
          </li>
          <li>
            <span className="proc__n" aria-hidden="true">02</span>
            <div>
              <h3>Propose a change</h3>
              <p>Missing feature, wrong assumption, gap: propose a change to that roadmap. Do not start a separate one.</p>
            </div>
          </li>
          <li>
            <span className="proc__n" aria-hidden="true">03</span>
            <div>
              <h3>Review</h3>
              <p>
                Fable (Claude, by Anthropic) and Astra (ChatGPT, by OpenAI) each try to prove the roadmap incomplete,
                independently. Rounds continue until both report no material gaps.
              </p>
            </div>
          </li>
          <li>
            <span className="proc__n" aria-hidden="true">04</span>
            <div>
              <h3>Build</h3>
              <p>
                Once features have agreed contracts: <Link href="/download">download wOS</Link>, pick {t.name}, a
                feature and a task, press BUILD. Contributing requires a linked GitHub account. Accepted work earns WOS
                tokens. {TOKEN_DISCLAIMER}
              </p>
            </div>
          </li>
        </ol>
        <p className="fine">
          {t.name} is a trademark of its owner. warOnSaaS is not affiliated with it.{" "}
          <Link href="/how-it-works">Full procedure</Link>.
        </p>
      </Section>

      <JsonLd
        data={breadcrumbLd([
          { name: "Home", path: "/" },
          { name: `${t.name} alternative`, path: `/targets/${t.slug}` },
        ])}
      />
    </>
  );
}
