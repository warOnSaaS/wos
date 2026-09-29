import { readFile } from "node:fs/promises";
import { join } from "node:path";

/** JetBrains Mono (SIL OFL, see assets/OFL-JetBrainsMono.txt). Read at build time for next/og. */
export async function ogFont() {
  const dir = join(process.cwd(), "assets");
  const [regular, bold, heavy] = await Promise.all([
    readFile(join(dir, "JetBrainsMono-400.ttf")),
    readFile(join(dir, "JetBrainsMono-700.ttf")),
    readFile(join(dir, "JetBrainsMono-800.ttf")),
  ]);
  return [
    { name: "JetBrains Mono", data: regular, style: "normal" as const, weight: 400 as const },
    { name: "JetBrains Mono", data: bold, style: "normal" as const, weight: 700 as const },
    { name: "JetBrains Mono", data: heavy, style: "normal" as const, weight: 800 as const },
  ];
}

/** Monochrome only. */
export const OG = {
  bg: "#0b0b0b",
  fg: "#e6e6e3",
  dim: "#a3a3a0",
  rule: "#3d3d3b",
};

/** Weight-800 cut of the same face, used only for the wOS mark at icon sizes. */
export async function markFont() {
  const data = await readFile(join(process.cwd(), "assets", "JetBrainsMono-800.ttf"));
  return [{ name: "JetBrains Mono", data, style: "normal" as const, weight: 800 as const }];
}

export const MARK_TEXT = "wOS";

/**
 * The mark: the letters wOS, exact casing, in JetBrains Mono ExtraBold, off-white on near-black.
 * No other art. Proportions tighten at small sizes so all three letters stay legible at 16px.
 */
export function markMetrics(size: number) {
  if (size <= 16) return { fontSize: size * 0.6, letterSpacing: -size * 0.045 };
  if (size <= 32) return { fontSize: size * 0.54, letterSpacing: -size * 0.035 };
  return { fontSize: size * 0.4, letterSpacing: -size * 0.02 };
}

/** Full-bleed mark for icon routes and exports. */
export function Mark({ size, fg = OG.fg, bg = OG.bg }: { size: number; fg?: string; bg?: string }) {
  const m = markMetrics(size);
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: bg,
        color: fg,
        fontFamily: "JetBrains Mono",
        fontWeight: 800,
        fontSize: m.fontSize,
        letterSpacing: m.letterSpacing,
        lineHeight: 1,
      }}
    >
      {MARK_TEXT}
    </div>
  );
}

/** The mark as a small bordered box inside OG cards. */
export function MarkInline({ height }: { height: number }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        height,
        padding: `0 ${Math.round(height * 0.22)}px`,
        border: `2px solid ${OG.fg}`,
        color: OG.fg,
        fontFamily: "JetBrains Mono",
        fontWeight: 800,
        fontSize: Math.round(height * 0.55),
        letterSpacing: -1,
      }}
    >
      {MARK_TEXT}
    </div>
  );
}
