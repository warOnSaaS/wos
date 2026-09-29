import { ImageResponse } from "next/og";
import { getTarget, targetStatus, targets } from "@/data/targets";
import { formatPercent, getTarget as getDetail, listTargets as listDetails } from "@/lib/data-source";
import { markDataUrl, ogFont } from "@/lib/og";
import { OgCard } from "@/lib/ogCard";

export const alt = "warOnSaaS target dossier: target ID, name, and mapped, specified and built progress.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export async function generateStaticParams() {
  return (await listDetails()).filter((t) => t.rank > 0).map((t) => ({ slug: t.slug }));
}

export const revalidate = 60;

export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const t = getTarget(slug)!;
  const p = (await getDetail(slug))!.data.progress;
  return new ImageResponse(
    <OgCard
      mark={await markDataUrl()}
      kicker={`TARGET DOSSIER // ${targetStatus(t)}`}
      id={`${t.id} // ${t.category.toUpperCase()}`}
      title={`Open-source ${t.name} alternative`}
      subtitle={t.whatItIs}
      rows={[
        { label: "MAPPED", value: formatPercent(p.mappedBp) },
        { label: "SPECIFIED", value: formatPercent(p.specifiedBp) },
        { label: "BUILT", value: formatPercent(p.builtBp) },
      ]}
    />,
    { ...size, fonts: await ogFont() },
  );
}
