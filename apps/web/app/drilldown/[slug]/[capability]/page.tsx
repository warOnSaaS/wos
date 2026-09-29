import Link from "next/link";
import { notFound } from "next/navigation";
import { formatPercent, getTarget, siteFields } from "@/lib/data-source";
import { pageMetadata } from "@/lib/seo";
import { Section } from "@/components/Section";
import { Bar } from "@/components/Bar";
import { Crumbs } from "@/components/Crumbs";
import { SourceNote } from "@/components/SourceNote";

export const dynamicParams = false;

export function generateStaticParams() {
  const t = getTarget("waronsaas")!.data;
  return t.capabilities.map((c) => ({ slug: "waronsaas", capability: c.key }));
}

type Props = { params: Promise<{ slug: string; capability: string }> };

function load(slug: string, capability: string) {
  const got = getTarget(slug);
  const cap = got?.data.capabilities.find((c) => c.key === capability);
  return got && cap ? { got, cap } : null;
}

export async function generateMetadata({ params }: Props) {
  const { slug, capability } = await params;
  const x = load(slug, capability);
  if (!x) return {};
  return pageMetadata({
    title: `${x.cap.title}: ${x.got.data.name} drilldown`,
    description: `${x.cap.title} (${x.got.data.name}): ${x.cap.summary} Weight ${x.cap.weightBp} basis points, with rationale, and every feature under it.`,
    path: `/drilldown/${slug}/${capability}`,
  });
}

export default async function DrillCapability({ params }: Props) {
  const { slug, capability } = await params;
  const x = load(slug, capability);
  const site = siteFields(slug);
  if (!x || !site) notFound();
  const { got, cap } = x;

  return (
    <>
      <div className="title">
        <Crumbs
          items={[
            { label: "Home", href: "/" },
            { label: site.id, href: `/targets/${slug}` },
            { label: "Drilldown", href: `/drilldown/${slug}` },
            { label: cap.title },
          ]}
        />
        <p className="label">DRILLDOWN // LEVEL 2 OF 6 // CAPABILITY</p>
        <h1>{cap.title}</h1>
        <p className="lead">{cap.summary}</p>
      </div>

      <Section n="01" title="WEIGHT" id="weight">
        <dl className="cells">
          <div><dt>WEIGHT</dt><dd>{cap.weightBp} bp</dd></div>
          <div><dt>SHARE OF TARGET</dt><dd>{formatPercent(cap.weightBp)}</dd></div>
          <div><dt>SPECIFIED</dt><dd>{formatPercent(cap.specifiedBp)}</dd></div>
          <div><dt>BUILT</dt><dd>{formatPercent(cap.builtBp)}</dd></div>
        </dl>
        <p><strong>Rationale:</strong> {cap.weightRationale}</p>
        <SourceNote source={got.source} />
      </Section>

      <Section n="02" title="FEATURES" id="features" aside="WEIGHT = SHARE OF THIS CAPABILITY">
        <table className="tbl">
          <thead>
            <tr>
              <th scope="col">FEATURE</th>
              <th scope="col">WEIGHT</th>
              <th scope="col">OF TARGET</th>
              <th scope="col">SPECIFIED</th>
              <th scope="col">BUILT</th>
            </tr>
          </thead>
          <tbody>
            {cap.features.map((f) => (
              <tr key={f.key}>
                <th scope="row" data-label="FEATURE">
                  <Link href={`/drilldown/${slug}/${cap.key}/${f.key}`}>{f.title}</Link>
                </th>
                <td data-label="WEIGHT">{f.weightBp} bp</td>
                <td data-label="OF TARGET">{f.effectiveAppWeightBp} bp</td>
                <td data-label="SPECIFIED"><Bar bp={f.specifiedBp} /></td>
                <td data-label="BUILT"><Bar bp={f.builtBp} /></td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="fine">“Of target” is the feature’s effective weight: capability weight × feature weight ÷ 10000.</p>
      </Section>
    </>
  );
}
