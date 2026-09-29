import { readFile } from "node:fs/promises";
import { join } from "node:path";

/** JetBrains Mono (SIL OFL, see assets/OFL-JetBrainsMono.txt). Read at build time for next/og. */
export async function ogFont() {
  const dir = join(process.cwd(), "assets");
  const [regular, bold] = await Promise.all([
    readFile(join(dir, "JetBrainsMono-400.ttf")),
    readFile(join(dir, "JetBrainsMono-700.ttf")),
  ]);
  return [
    { name: "JetBrains Mono", data: regular, style: "normal" as const, weight: 400 as const },
    { name: "JetBrains Mono", data: bold, style: "normal" as const, weight: 700 as const },
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
 * The mark: a solid square with a stencil-cut W. Monochrome, geometric,
 * legible at 16px. A horizontal stencil bridge crosses the W at larger sizes.
 * Coordinates are on a 100 x 100 grid; `inset` is the dark margin around the square.
 */
export function MarkSvg({ size, fg = OG.fg, bg = OG.bg, inset = 12 }: { size: number; fg?: string; bg?: string; inset?: number }) {
  const bridge = size >= 48; // the bridge is lost below ~48px, so leave it out there
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
      <rect x="0" y="0" width="100" height="100" fill={bg} />
      <rect x={inset} y={inset} width={100 - 2 * inset} height={100 - 2 * inset} fill={fg} />
      <polygon points="20,26 30,26 36,58 45,26 55,26 64,58 70,26 80,26 70,76 59,76 50,44 41,76 30,76" fill={bg} />
      {bridge ? <rect x={inset} y="47" width={100 - 2 * inset} height="4" fill={fg} /> : null}
    </svg>
  );
}

/** Full-bleed mark for icon routes. Tighter margin at favicon size. */
export function Mark({ size }: { size: number }) {
  return (
    <div style={{ width: "100%", height: "100%", display: "flex" }}>
      <MarkSvg size={size} inset={size <= 32 ? 6 : 12} />
    </div>
  );
}
