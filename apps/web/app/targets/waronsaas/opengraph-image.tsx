import { ImageResponse } from "next/og";
import { targetStatus } from "@/data/targets";
import { wosTarget as t } from "@/data/wos-roadmap";
import { formatPercent, getTarget } from "@/lib/data-source";
import { markDataUrl, ogFont } from "@/lib/og";
import { OgCard } from "@/lib/ogCard";

export const alt = "warOnSaaS target dossier TGT-00: warOnSaaS builds itself. Mapped 0%, specified 0%, built 0%.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function Image() {
  const p = getTarget(t.slug)!.data.progress;
  return new ImageResponse(
    <OgCard
      mark={await markDataUrl()}
      kicker={`TARGET DOSSIER // ${targetStatus(t)}`}
      id="TGT-00 // DOGFOOD"
      title="warOnSaaS builds itself"
      subtitle="The wOS roadmap, proposed, pending consensus."
      rows={[
        { label: "MAPPED", value: formatPercent(p.mappedBp) },
        { label: "SPECIFIED", value: formatPercent(p.specifiedBp) },
        { label: "BUILT", value: formatPercent(p.builtBp) },
      ]}
    />,
    { ...size, fonts: await ogFont() },
  );
}
