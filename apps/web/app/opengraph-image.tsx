import { ImageResponse } from "next/og";
import { formatPercent, sniperListTotals } from "@/lib/data-source";
import { markDataUrl, ogFont } from "@/lib/og";
import { OgCard } from "@/lib/ogCard";

export const alt = "warOnSaaS: open-source replacements for the software you rent. Ten targets, all at 0%.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function Image() {
  const totals = sniperListTotals();
  return new ImageResponse(
    <OgCard
      mark={await markDataUrl()}
      kicker="OPERATION ORDER"
      title="Open-source replacements for the software you rent"
      subtitle={`${totals.targets} targets. One suite. ${totals.roadmapsOpen} roadmaps open. The war starts at zero.`}
      rows={[
        { label: "MAPPED", value: formatPercent(totals.mappedBp) },
        { label: "SPECIFIED", value: formatPercent(totals.specifiedBp) },
        { label: "BUILT", value: formatPercent(totals.builtBp) },
      ]}
    />,
    { ...size, fonts: await ogFont() },
  );
}
