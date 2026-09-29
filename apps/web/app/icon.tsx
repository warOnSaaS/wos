import { ImageResponse } from "next/og";
import { Mark, ogFont } from "@/lib/og";

export const size = { width: 32, height: 32 };
export const contentType = "image/png";

export default async function Icon() {
  return new ImageResponse(<Mark size={32} />, { ...size, fonts: await ogFont() });
}
