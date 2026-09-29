import { ImageResponse } from "next/og";
import { overall, roadmapsOpen, targets } from "@/data/targets";
import { ogFont } from "@/lib/og";
import { OgCard } from "@/lib/ogCard";

export const alt = "warOnSaaS: open-source replacements for the software you rent. Ten targets, all at 0%.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function Image() {
  return new ImageResponse(
    <OgCard
      kicker="OPERATION ORDER"
      title="Open-source replacements for the software you rent"
      subtitle={`${targets.length} targets. ${roadmapsOpen()} roadmaps open. The war starts at zero.`}
      rows={[
        { label: "Mapped", value: `${overall("mapped")}%` },
        { label: "Specified", value: `${overall("specified")}%` },
        { label: "Built", value: `${overall("built")}%` },
      ]}
    />,
    { ...size, fonts: await ogFont() },
  );
}
