import Link from "next/link";
import { notFound } from "next/navigation";
import { formatPercent, getFeature, proposedCapabilities, siteFields, SURFACE_LABEL } from "@/lib/data-source";
import { pageMetadata } from "@/lib/seo";
import { Section } from "@/components/Section";
import { Bar } from "@/components/Bar";
import { Crumbs } from "@/components/Crumbs";
import { Empty } from "@/components/Empty";
import { SourceNote } from "@/components/SourceNote";

export const dynamicParams = false;

export function generateStaticParams() {
  return proposedCapabilities().flatMap((c) => c.features.map((f) => ({ slug: "waronsaas", capability: c.key, feature: f.key })));
}

type Props = { params: Promise<{ slug: string; capability: string; feature: string }> };

function load(slug: string, capability: string, feature: string) {
  const got = getFeature(slug, feature);
  const cap = slug === "waronsaas" ? proposedCapabilities().find((c) => c.key === capability) : undefined;
  return got && cap && got.data.capability === capability ? { got, target: { name: "warOnSaaS" }, cap } : null;
}

export async function generateMetadata({ params }: Props) {
  const { slug, capability, feature } = await params;
  const x = load(slug, capability, feature);
  if (!x) return {};
  return pageMetadata({
    title: `${x.got.data.title}: ${x.target.name} drilldown`,
    description: `${x.got.data.title}: ${x.got.data.summary} Weights and rationales, progress per surface, user journeys and requirements.`,
    path: `/drilldown/${slug}/${capability}/${feature}`,
  });
}

export default async function DrillFeature({ params }: Props) {
  const { slug, capability, feature } = await params;
  const x = load(slug, capability, feature);
  const site = siteFields(slug);
  if (!x || !site) notFound();
  const { got, target, cap } = x;
  const f = got.data;
  const surfaces = [...new Set(f.journeys.map((j) => j.surface))];

  return (
    <>
      <div className="title">
        <Crumbs
          items={[
            { label: "Home", href: "/" },
            { label: site.id, href: `/targets/${slug}` },
            { label: "Drilldown", href: `/drilldown/${slug}` },
            { label: cap.title, href: `/drilldown/${slug}/${cap.key}` },
            { label: f.title },
          ]}
        />
        <p className="label">DRILLDOWN // LEVEL 3 OF 6 // FEATURE</p>
        <h1>{f.title}</h1>
        <p className="lead">{f.summary}</p>
      </div>

      <Section n="01" title="WEIGHT" id="weight">
        <dl className="cells">
          <div><dt>SHARE OF {cap.title.toUpperCase()}</dt><dd>{f.weightBp} bp</dd></div>
          <div><dt>SHARE OF {target.name}</dt><dd>{f.effectiveAppWeightBp} bp</dd></div>
          <div><dt>SPECIFIED</dt><dd>{formatPercent(f.specifiedBp)}</dd></div>
          <div><dt>BUILT</dt><dd>{formatPercent(f.builtBp)}</dd></div>
        </dl>
        <p><strong>Rationale:</strong> {f.weightRationale}</p>
        <p className="fine">
          Build units relevant: {f.relevantPoints} points, merged: {f.mergedPoints}. Shared with other targets:{" "}
          {f.sharedWith.length ? f.sharedWith.join(", ") : "none recorded"}.
        </p>
        <SourceNote source={got.source} />
      </Section>

      <Section n="02" title="PROGRESS PER SURFACE" id="surfaces" aside="WEIGHT = SHARE OF THIS FEATURE">
        {f.surfaces.length ? (
          <>
            <table className="tbl">
              <thead>
                <tr>
                  <th scope="col">SURFACE</th>
                  <th scope="col">WEIGHT</th>
                  <th scope="col">SPECIFIED</th>
                  <th scope="col">BUILT</th>
                  <th scope="col">ACCEPTANCE</th>
                </tr>
              </thead>
              <tbody>
                {f.surfaces.map((s) => (
                  <tr key={s.surface}>
                    <th scope="row" data-label="SURFACE">{SURFACE_LABEL[s.surface]}</th>
                    <td data-label="WEIGHT">{s.weightBp} bp</td>
                    <td data-label="SPECIFIED"><Bar bp={s.specifiedBp} /></td>
                    <td data-label="BUILT"><Bar bp={s.builtBp} /></td>
                    <td data-label="ACCEPTANCE">{s.acceptancePassed ? "PASSED" : "NOT RUN"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <dl className="kv">
              {f.surfaces.map((s) => (
                <div key={s.surface}>
                  <dt>{SURFACE_LABEL[s.surface]}</dt>
                  <dd>{s.weightRationale}</dd>
                </div>
              ))}
            </dl>
          </>
        ) : (
          <Empty title="No surfaces">This feature lists no surfaces in the roadmap.</Empty>
        )}
      </Section>

      <Section n="03" title="JOURNEYS" id="journeys" aside={`${f.journeys.length} ON ${surfaces.length} SURFACES`}>
        {f.journeys.length ? (
          <div className="two">
            {f.journeys.map((j) => (
              <div key={j.key}>
                <h3>
                  <span className="dim">{j.key}</span> {SURFACE_LABEL[j.surface].toUpperCase()}
                </h3>
                <p>{j.title}</p>
                <ol className="rules">
                  {j.steps.map((st, i) => (
                    <li key={`${j.key}-${i}`}>
                      <span aria-hidden="true">{String(i + 1).padStart(2, "0")}</span>
                      <span>{st}</span>
                    </li>
                  ))}
                </ol>
                <p className="fine">ENTRY: {j.entryPoints.join(", ")}. BEHAVIOUR: {j.platformBehaviour}</p>
              </div>
            ))}
          </div>
        ) : (
          <Empty title="No journeys">The roadmap lists no journeys for this feature.</Empty>
        )}
      </Section>

      <Section n="04" title="REQUIREMENTS" id="requirements" aside="PROPOSED">
        {f.requirements.length ? (
          <ol className="rules">
            {f.requirements.map((r) => (
              <li key={r.key}>
                <span>
                  <Link href={`/drilldown/${slug}/${cap.key}/${f.key}/${r.key.toLowerCase()}`}>{r.key}</Link>
                </span>
                <span>
                  {r.statement} <span className="dim">[{r.kind.toUpperCase()} // {r.surfaces.map((s) => SURFACE_LABEL[s]).join(", ")}]</span>
                </span>
              </li>
            ))}
          </ol>
        ) : (
          <Empty title="No requirements">No requirements are proposed for this feature yet.</Empty>
        )}
        <p className="fine">Proposed requirements. They become this target’s profile when the Feature Contract merges.</p>
      </Section>

      <Section n="05" title="FEATURE CONTRACT" id="contract">
        {f.contract ? (
          <p>
            Version {f.contract.version}, {f.contract.state}.{" "}
            {f.contract.prUrl ? <a href={f.contract.prUrl}>Contract PR</a> : null}
          </p>
        ) : (
          <Empty title="No contract workflow yet">A Feature Contract opens after the roadmap merges. This roadmap is proposed, not merged.</Empty>
        )}
      </Section>

      <Section n="06" title="BUILD UNITS" id="abus">
        {f.abus.length ? null : (
          <Empty title="No build units">
            Atomic Build Units come from the merged Feature Contract’s Build Graph. None exists for this feature.
          </Empty>
        )}
      </Section>
    </>
  );
}
