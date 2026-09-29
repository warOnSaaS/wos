import { ImageResponse } from "next/og";
import { ogFont } from "@/lib/og";
import { OgCard } from "@/lib/ogCard";

export const alt = "warOnSaaS: open-source replacements for the software you rent. The war starts at zero.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function Image() {
  return new ImageResponse(
    <OgCard
      kicker="The Sniper List"
      title="Open-source replacements for the software you rent"
      subtitle="Ten targets. 0% built. The war starts at zero."
    />,
    { ...size, fonts: await ogFont() },
  );
}
