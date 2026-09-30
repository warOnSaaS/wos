import { ImageResponse } from "next/og";
import { markDataUrl, ogFont } from "@/lib/og";
import { OgCard } from "@/lib/ogCard";
import { lastUpdatedDay, whitepaper } from "@/lib/whitepaper";

export const alt = "The warOnSaaS white paper: a living document on budget-based Proof of Contribution and one open business product.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function Image() {
  const wp = whitepaper();
  return new ImageResponse(
    <OgCard
      mark={await markDataUrl()}
      kicker="WHITE PAPER"
      title="Budget-based Proof of Contribution"
      subtitle="An open execution layer for business software. For agents to evaluate."
      rows={[
        { label: "VERSION", value: wp.version },
        { label: "STATUS", value: "LIVING" },
        { label: "UPDATED", value: lastUpdatedDay ?? "NONE" },
      ]}
    />,
    { ...size, fonts: await ogFont() },
  );
}
