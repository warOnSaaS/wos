import Link from "next/link";
import { notFound } from "next/navigation";
import { formatPercent, getTarget, listTargets, siteFields, SURFACE_LABEL } from "@/lib/data-source";
import { pageMetadata } from "@/lib/seo";
import { Section } from "@/components/Section";
import { Bar } from "@/components/Bar";
import { Crumbs } from "@/components/Crumbs";
import { Empty } from "@/components/Empty";
import { SourceNote } from "@/components/SourceNote";

export const dynamicParams = false;

export async function generateStaticParams() {
  return (await listTargets()).map((t) => ({ slug: t.slug }));
}

export const revalidate = 60;

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props) {
  const { slug } = await params;
  const got = await getTarget(slug);
  if (!got) return {};
  const t = got.data;
  const meta = pageMetadata({
    title: `Drilldown: ${t.name}`,
    description: `${t.name} drilldown: capabilities, features, requirements, build units and PRs, with weights, rationales and progress per surface.`,
    path: `/drilldown/${slug}`,
  });
  // Levels with no data yet are not offered to search engines.
  return t.capabilities.length ? meta : { ...meta, robots: { index: false, follow: true } };
}

export default async function DrillTarget({ params }: Props) {
  const { slug } = await params;
  const got = await getTarget(slug);
  const site = siteFields(slug, got?.data.rank);
  if (!got || !site) notFound();
  const t = got.data;

  return (
    <>
      <div className="title">
        <Crumbs items={[{ label: "Home", href: "/" }, { label: site.id, href: `/targets/${slug}` }, { label: "Drilldown" }]} />
        <p className="label">DRILLDOWN // LEVEL 1 OF 6 // TARGET</p>
        <h1>{t.name}</h1>
        <p className="lead">Target → capability → feature → requirement → build unit → PR.</p>
      </div>

      <Section n="01" title="PROGRESS" id="progress">
        <dl className="cells">
          <div><dt>MAPPED</dt><dd>{formatPercent(t.progress.mappedBp)}</dd></div>
          <div><dt>SPECIFIED</dt><dd>{formatPercent(t.progress.specifiedBp)}</dd></div>
          <div><dt>BUILT</dt><dd>{formatPercent(t.progress.builtBp)}</dd></div>
          <div><dt>ROADMAP VERSION</dt><dd>{t.progress.roadmapVersion ?? "NONE MERGED"}</dd></div>
        </dl>
        <SourceNote source={got.source} />
      </Section>

      <Section n="02" title="SURFACES" id="surfaces">
        {t.surfaces.length ? (
          <table className="tbl">
            <thead>
              <tr>
                <th scope="col">SURFACE</th>
                <th scope="col">STATUS</th>
                <th scope="col">REPOSITORY</th>
                <th scope="col">SPECIFIED</th>
                <th scope="col">BUILT</th>
              </tr>
            </thead>
            <tbody>
              {t.surfaces.map((s) => (
                <tr key={s.surface}>
                  <th scope="row" data-label="SURFACE">{SURFACE_LABEL[s.surface]}</th>
                  <td data-label="STATUS">{s.status === "in_scope" ? "IN SCOPE" : "EXCLUDED"}</td>
                  <td data-label="REPOSITORY">{s.repo ?? "—"}</td>
                  <td data-label="SPECIFIED"><Bar bp={s.specifiedBp} /></td>
                  <td data-label="BUILT"><Bar bp={s.builtBp} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <Empty title="No surfaces inventoried">
            The roadmap inventories every surface {t.name} ships, with public evidence. No roadmap exists yet.
          </Empty>
        )}
      </Section>

      <Section n="03" title="CAPABILITIES" id="capabilities" aside="WEIGHTS IN BASIS POINTS OF THE TARGET">
        {t.capabilities.length ? (
          <ol className="caps">
            {t.capabilities.map((c) => (
              <li key={c.key}>
                <div className="cap-h">
                  <h3>
                    <Link href={`/drilldown/${slug}/${c.key}`}>{c.title}</Link>
                  </h3>
                  <span className="tag tag--dim">WEIGHT {c.weightBp} BP</span>
                  <span className="tag tag--dim">{c.mapped ? "MAPPED" : "NOT MERGED"}</span>
                </div>
                <p>{c.summary}</p>
                <p className="fine">RATIONALE: {c.weightRationale}</p>
                <p className="fine">
                  {c.features.length} features. Specified {formatPercent(c.specifiedBp)}, built {formatPercent(c.builtBp)}.
                </p>
              </li>
            ))}
          </ol>
        ) : (
          <Empty title="No capabilities yet">
            Capabilities come from the merged roadmap. The “{t.name} Replacement Roadmap” has not been opened.
          </Empty>
        )}
      </Section>

      {t.excluded.length ? (
        <Section n="04" title="EXCLUDED" id="excluded">
          <dl className="kv">
            {t.excluded.map((e) => (
              <div key={e.item}>
                <dt>{e.title}</dt>
                <dd>{e.reason}</dd>
              </div>
            ))}
          </dl>
        </Section>
      ) : null}
    </>
  );
}
