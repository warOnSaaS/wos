import { ImageResponse } from "next/og";
import { Mark, ogFont } from "@/lib/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default async function AppleIcon() {
  return new ImageResponse(<Mark size={180} />, { ...size, fonts: await ogFont() });
}
