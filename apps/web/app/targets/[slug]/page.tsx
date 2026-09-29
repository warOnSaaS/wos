import Link from "next/link";
import { notFound } from "next/navigation";
import { roadmapState, roadmapStatus, roadmapTitle, targetStatus, targets } from "@/data/targets";
import { PROGRESS_METRICS, SUITE } from "@/lib/content";
import { formatPercent, getTarget, SURFACE_LABEL, siteFields, suiteSurfaceProgress } from "@/lib/data-source";
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

const KEY = { mapped: "mappedBp", specified: "specifiedBp", built: "builtBp" } as const;

export async function generateMetadata({ params }: Props) {
  const { slug } = await params;
  const got = getTarget(slug);
  if (!got) return {};
  const t = got.data;
  return pageMetadata({
    title: `Open-source ${t.name} alternative`,
    description: `warOnSaaS is building an open-source, self-hostable ${t.name} alternative as part of one suite, one feature at a time. ${t.whatItIs} Progress today: mapped ${formatPercent(t.progress.mappedBp)}, specified ${formatPercent(t.progress.specifiedBp)}, built ${formatPercent(t.progress.builtBp)}.`,
    path: `/targets/${t.slug}`,
    defaultImage: false,
  });
}

export default async function TargetPage({ params }: Props) {
  const { slug } = await params;
  const got = getTarget(slug);
  const site = siteFields(slug);
  if (!got || !site) notFound();
  const t = got.data;
  const surfaces = suiteSurfaceProgress(t);

  const header: [string, string][] = [
    ["ID", site.id],
    ["DESIGNATION", t.name],
    ["CATEGORY", site.category],
    ["STATUS", targetStatus(site)],
    ["ROADMAP", t.roadmap ? "OPEN" : roadmapState(site)],
    ["SELF-HOSTED", t.selfHostable ? "Available" : "Not yet"],
    ["HOSTED", t.hosted.available ? "Running" : "Not yet"],
    ["CONTRIBUTORS", "0"],
  ];

  return (
    <>
      <div className="title">
        <nav className="crumbs" aria-label="Breadcrumb">
          <ol>
            <li><Link href="/">Home</Link></li>
            <li><Link href="/#targets">Targets</Link></li>
            <li><span aria-current="page">{site.id}</span></li>
          </ol>
        </nav>
        <p className="label">TARGET DOSSIER // {site.id} // PARITY PROFILE</p>
        <h1>Open-source {t.name} alternative</h1>
        <p className="lead">
          {t.name}: {t.whatItIs} warOnSaaS replaces it with modules of one open-source suite you can run yourself, one
          feature at a time.
        </p>
      </div>

      <Section n="01" title="HEADER" id="header">
        <dl className="cells cells--text">
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
              <span className="readout__n">{formatPercent(t.progress[KEY[m.key]])}</span>
              <Bar bp={t.progress[KEY[m.key]]} cells={20} showValue={false} />
              <p className="fine">{m.means}</p>
            </div>
          ))}
        </div>
      </Section>

      <Section n="03" title="PROGRESS PER SURFACE" id="surfaces" aside="WEB // IPHONE // ANDROID">
        <table className="tbl">
          <caption>The suite ships one web app and one phone app. {t.name} parity is tracked on each.</caption>
          <thead>
            <tr>
              <th scope="col">SURFACE</th>
              <th scope="col">SPECIFIED</th>
              <th scope="col">BUILT</th>
            </tr>
          </thead>
          <tbody>
            {surfaces.map((s) => (
              <tr key={s.surface}>
                <th scope="row" data-label="SURFACE">{SURFACE_LABEL[s.surface]}</th>
                <td data-label="SPECIFIED"><Bar bp={s.specifiedBp} /></td>
                <td data-label="BUILT"><Bar bp={s.builtBp} /></td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="fine">
          The roadmap will list every surface {t.name} ships, with public evidence, and exclude any it does not cover with
          a reason. No roadmap exists yet.
        </p>
      </Section>

      <Section n="04" title="PARITY PROFILE" id="profile" aside="PROVISIONAL OUTLINE">
        <p>{SUITE.profile}</p>
        <p>What the suite must do to fully replace {t.name}, in broad strokes:</p>
        <ul className="rules">
          {site.replacementCovers.map((c, i) => (
            <li key={c}>
              <span aria-hidden="true">P-{i + 1}</span>
              <span>{c}</span>
            </li>
          ))}
        </ul>
        <p>{SUITE.parity}</p>
        <p className="fine">Provisional. The public roadmap sets the exact profile. This is not a feature commitment.</p>
      </Section>

      <Section n="05" title="ROADMAP" id="roadmap">
        <dl className="kv">
          <div>
            <dt>Canonical PR</dt>
            <dd>“{roadmapTitle(site)}” in waronsaas/product</dd>
          </div>
          <div>
            <dt>State</dt>
            <dd>{t.roadmap?.prUrl ? <a href={t.roadmap.prUrl}>{roadmapStatus(site)}</a> : roadmapStatus(site)}</dd>
          </div>
          <div>
            <dt>Consensus</dt>
            <dd>
              {t.roadmap ? "See the roadmap PR." : "Not reached."} Requires Fable and Astra to both report no material
              gaps.
            </dd>
          </div>
        </dl>
      </Section>

      <Section n="06" title="HOW TO CONTRIBUTE" id="contribute">
        <ol className="proc">
          <li>
            <span className="proc__n" aria-hidden="true">01</span>
            <div>
              <h3>Find the roadmap</h3>
              <p>
                All work on this target goes into one pull request: “{roadmapTitle(site)}”.{" "}
                {t.roadmap?.prUrl ? (
                  <a href={t.roadmap.prUrl}>Open it.</a>
                ) : (
                  <>
                    Not opened yet. It will appear in the <a href={LINKS.productPullRequests}>waronsaas/product pull requests</a>{" "}
                    and on this page.
                  </>
                )}
              </p>
            </div>
          </li>
          <li>
            <span className="proc__n" aria-hidden="true">02</span>
            <div>
              <h3>Propose a change</h3>
              <p>Missing feature, missing surface, wrong assumption, gap: propose a change to that roadmap. Do not start a separate one.</p>
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
