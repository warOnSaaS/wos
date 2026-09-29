import { readFile } from "node:fs/promises";
import { join } from "node:path";

/** Archivo Black (SIL OFL, see assets/OFL.txt). Read at build time for next/og. */
export async function ogFont() {
  const data = await readFile(join(process.cwd(), "assets/ArchivoBlack-Regular.ttf"));
  return [{ name: "Archivo Black", data, style: "normal" as const, weight: 400 as const }];
}

export const OG = {
  bg: "#0a0a0a",
  fg: "#f2f2f0",
  muted: "#a8a8a8",
  accent: "#ff5747",
  track: "#2a2a2a",
};

/** The square mark used for favicons: "w" on black with a red bar. */
export function Mark({ size }: { size: number }) {
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        background: OG.bg,
        color: OG.fg,
        fontFamily: "Archivo Black",
        fontSize: size * 0.78,
        lineHeight: 1,
      }}
    >
      <div style={{ display: "flex", marginTop: -size * 0.12 }}>w</div>
      <div
        style={{
          position: "absolute",
          left: size * 0.16,
          right: size * 0.16,
          bottom: size * 0.14,
          height: Math.max(2, size * 0.1),
          background: OG.accent,
        }}
      />
    </div>
  );
}
