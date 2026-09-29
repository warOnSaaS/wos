import { readFile } from "node:fs/promises";
import { join } from "node:path";

/** JetBrains Mono for text and Geist Mono for headings and the wordmark (both SIL OFL, see assets/OFL-*.txt). */
export async function ogFont() {
  const dir = join(process.cwd(), "assets");
  const [regular, bold, head] = await Promise.all([
    readFile(join(dir, "JetBrainsMono-400.ttf")),
    readFile(join(dir, "JetBrainsMono-700.ttf")),
    readFile(join(dir, "GeistMono-700.ttf")),
  ]);
  return [
    { name: "JetBrains Mono", data: regular, style: "normal" as const, weight: 400 as const },
    { name: "JetBrains Mono", data: bold, style: "normal" as const, weight: 700 as const },
    { name: "Geist Mono", data: head, style: "normal" as const, weight: 700 as const },
  ];
}

/** Monochrome only. */
export const OG = {
  bg: "#0b0b0b",
  fg: "#e6e6e3",
  dim: "#a3a3a0",
  rule: "#3d3d3b",
};

/**
 * The wOS mark (Geist Mono Bold, off-white on near-black, natural spacing, centred on the ink box).
 * Rendered once to PNG by scripts/render-mark.mjs; favicons are app/icon1.png (16), app/icon2.png (32)
 * and app/apple-icon.png (180). OG cards embed the 96px render.
 */
export async function markDataUrl() {
  const png = await readFile(join(process.cwd(), "assets", "wos-mark-96.png"));
  return `data:image/png;base64,${png.toString("base64")}`;
}
