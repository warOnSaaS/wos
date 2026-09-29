import { ImageResponse } from "next/og";
import { getTarget, targets } from "@/data/targets";
import { ogFont } from "@/lib/og";
import { OgCard } from "@/lib/ogCard";

export const alt = "Open-source alternative on warOnSaaS, with its mapped, specified and built progress.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export function generateStaticParams() {
  return targets.map((t) => ({ slug: t.slug }));
}

export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const t = getTarget(slug)!;
  const position = targets.findIndex((x) => x.slug === t.slug) + 1;
  return new ImageResponse(
    <OgCard
      kicker={`Target ${String(position).padStart(2, "0")} of ${targets.length}`}
      title={`Open-source ${t.name} alternative`}
      subtitle={t.whatItIs}
      rows={[
        { label: "Mapped", value: t.mapped },
        { label: "Specified", value: t.specified },
        { label: "Built", value: t.built },
      ]}
    />,
    { ...size, fonts: await ogFont() },
  );
}
