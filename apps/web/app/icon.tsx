import { ImageResponse } from "next/og";
import { Mark, markFont } from "@/lib/og";

/** The wOS mark as favicons: a 16px cut with tighter spacing and a 32px cut. */
export function generateImageMetadata() {
  return [
    { id: "16", size: { width: 16, height: 16 }, contentType: "image/png" },
    { id: "32", size: { width: 32, height: 32 }, contentType: "image/png" },
  ];
}

export default async function Icon({ id }: { id: Promise<string | number> }) {
  const px = Number(await id);
  return new ImageResponse(<Mark size={px} />, { width: px, height: px, fonts: await markFont() });
}
