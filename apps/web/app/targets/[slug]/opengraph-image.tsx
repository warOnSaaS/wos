import { ImageResponse } from "next/og";
import { getTarget, targetStatus, targets } from "@/data/targets";
import { ogFont } from "@/lib/og";
import { OgCard } from "@/lib/ogCard";

export const alt = "warOnSaaS target dossier: target ID, name, and mapped, specified and built progress.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export function generateStaticParams() {
  return targets.map((t) => ({ slug: t.slug }));
}

export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const t = getTarget(slug)!;
  return new ImageResponse(
    <OgCard
      kicker={`TARGET DOSSIER // ${targetStatus(t)}`}
      id={`${t.id} // ${t.category.toUpperCase()}`}
      title={`Open-source ${t.name} alternative`}
      subtitle={t.whatItIs}
      rows={[
        { label: "Mapped", value: `${t.mapped}%` },
        { label: "Specified", value: `${t.specified}%` },
        { label: "Built", value: `${t.built}%` },
      ]}
    />,
    { ...size, fonts: await ogFont() },
  );
}
