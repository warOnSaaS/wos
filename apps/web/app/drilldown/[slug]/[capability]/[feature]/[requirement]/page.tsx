import Link from "next/link";
import { notFound } from "next/navigation";
import { getFeature, getTarget, proposedAcceptance, siteFields, SURFACE_LABEL } from "@/lib/data-source";
import { pageMetadata } from "@/lib/seo";
import { Section } from "@/components/Section";
import { Crumbs } from "@/components/Crumbs";
import { Empty } from "@/components/Empty";
import { SourceNote } from "@/components/SourceNote";

export const dynamicParams = false;

export function generateStaticParams() {
  const t = getTarget("waronsaas")!.data;
  return t.capabilities.flatMap((c) =>
    c.features.flatMap((f) =>
      (getFeature("waronsaas", f.key)?.data.requirements ?? []).map((r) => ({
        slug: "waronsaas",
        capability: c.key,
        feature: f.key,
        requirement: r.key.toLowerCase(),
      })),
    ),
  );
}

type Props = { params: Promise<{ slug: string; capability: string; feature: string; requirement: string }> };

function load(slug: string, capability: string, feature: string, requirement: string) {
  const got = getFeature(slug, feature);
  const cap = getTarget(slug)?.data.capabilities.find((c) => c.key === capability);
  const req = got?.data.requirements.find((r) => r.key.toLowerCase() === requirement);
  return got && cap && req && got.data.capability === capability ? { got, cap, req } : null;
}

export async function generateMetadata({ params }: Props) {
  const { slug, capability, feature, requirement } = await params;
  const x = load(slug, capability, feature, requirement);
  if (!x) return {};
  return pageMetadata({
    title: `${x.req.key} ${x.got.data.title}: drilldown`,
    description: `${x.got.data.title} requirement ${x.req.key}: ${x.req.statement}`,
    path: `/drilldown/${slug}/${capability}/${feature}/${requirement}`,
  });
}

export default async function DrillRequirement({ params }: Props) {
  const { slug, capability, feature, requirement } = await params;
  const x = load(slug, capability, feature, requirement);
  const site = siteFields(slug);
  if (!x || !site) notFound();
  const { got, cap, req } = x;
  const f = got.data;
  const acceptance = proposedAcceptance(f.key, req.key);
  const abus = f.abus.filter((a) => a.requirements.includes(req.key));

  return (
    <>
      <div className="title">
        <Crumbs
          items={[
            { label: "Home", href: "/" },
            { label: site.id, href: `/targets/${slug}` },
            { label: "Drilldown", href: `/drilldown/${slug}` },
            { label: cap.title, href: `/drilldown/${slug}/${cap.key}` },
            { label: f.title, href: `/drilldown/${slug}/${cap.key}/${f.key}` },
            { label: req.key },
          ]}
        />
        <p className="label">DRILLDOWN // LEVEL 4 OF 6 // REQUIREMENT</p>
        <h1>
          {req.key} {f.title}
        </h1>
        <p className="lead">{req.statement}</p>
      </div>

      <Section n="01" title="REQUIREMENT" id="requirement" aside="PROPOSED">
        <dl className="kv">
          <div><dt>Kind</dt><dd>{req.kind}</dd></div>
          <div><dt>Surfaces</dt><dd>{req.surfaces.map((s) => SURFACE_LABEL[s]).join(", ")}</dd></div>
          <div><dt>Built</dt><dd>{req.built ? "Yes" : "No"}</dd></div>
          <div><dt>Profiles</dt><dd>{req.profiles.length ? req.profiles.join(", ") : "None yet: a profile exists once the Feature Contract merges."}</dd></div>
        </dl>
        {acceptance.length ? (
          <>
            <h3>Acceptance</h3>
            <ol className="rules">
              {acceptance.map((a, i) => (
                <li key={a}>
                  <span aria-hidden="true">A-{i + 1}</span>
                  <span>{a}</span>
                </li>
              ))}
            </ol>
          </>
        ) : null}
        <SourceNote source={got.source} />
      </Section>

      <Section n="02" title="BUILD UNITS" id="abus" aside="LEVEL 5 OF 6">
        {abus.length ? null : (
          <Empty title="No build units">
            Atomic Build Units are cut from a merged Feature Contract. The contract for {f.title} has not been written, so no
            unit covers {req.key}.
          </Empty>
        )}
      </Section>

      <Section n="03" title="PULL REQUESTS" id="prs" aside="LEVEL 6 OF 6">
        <Empty title="No pull requests">
          PRs are opened by the wOS GitHub App for qualified build units. There are no units, so there are no PRs.
        </Empty>
        <p>
          <Link href={`/drilldown/${slug}/${cap.key}/${f.key}`}>Back to {f.title}</Link>
        </p>
      </Section>
    </>
  );
}
