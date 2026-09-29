import { ImageResponse } from "next/og";
import { targetStatus } from "@/data/targets";
import { wosTarget as t } from "@/data/wos-roadmap";
import { ogFont } from "@/lib/og";
import { OgCard } from "@/lib/ogCard";

export const alt = "warOnSaaS target dossier TGT-00: warOnSaaS builds itself. Mapped 0%, specified 0%, built 0%.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function Image() {
  return new ImageResponse(
    <OgCard
      kicker={`TARGET DOSSIER // ${targetStatus(t)}`}
      id="TGT-00 // DOGFOOD"
      title="warOnSaaS builds itself"
      subtitle="The wOS feature proposal, pending roadmap consensus."
      rows={[
        { label: "MAPPED", value: `${t.mapped}%` },
        { label: "SPECIFIED", value: `${t.specified}%` },
        { label: "BUILT", value: `${t.built}%` },
      ]}
    />,
    { ...size, fonts: await ogFont() },
  );
}
