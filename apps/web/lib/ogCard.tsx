import { OG } from "./og";

/** 1200x630 share card. `rows` renders the three progress numbers. */
export function OgCard({
  kicker,
  title,
  subtitle,
  rows,
}: {
  kicker: string;
  title: string;
  subtitle: string;
  rows?: { label: string; value: number }[];
}) {
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        background: OG.bg,
        color: OG.fg,
        padding: "64px 72px",
        fontFamily: "Archivo Black",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ display: "flex", fontSize: 40, letterSpacing: -1 }}>
          war<span style={{ color: OG.accent }}>On</span>SaaS
        </div>
        <div style={{ display: "flex", fontSize: 24, color: OG.accent, textTransform: "uppercase", letterSpacing: 3 }}>
          {kicker}
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column" }}>
        <div
          style={{
            display: "flex",
            fontSize: title.length > 26 ? 76 : 96,
            lineHeight: 1,
            letterSpacing: -3,
            textTransform: "uppercase",
          }}
        >
          {title}
        </div>
        <div style={{ display: "flex", fontSize: 32, color: OG.muted, marginTop: 24 }}>{subtitle}</div>
      </div>

      {rows ? (
        <div style={{ display: "flex", gap: 40 }}>
          {rows.map((r) => (
            <div key={r.label} style={{ display: "flex", flexDirection: "column", flex: 1 }}>
              <div style={{ display: "flex", fontSize: 22, color: OG.muted, textTransform: "uppercase", letterSpacing: 3 }}>
                {r.label}
              </div>
              <div style={{ display: "flex", fontSize: 88, lineHeight: 1, color: OG.accent }}>{r.value}%</div>
              <div style={{ display: "flex", height: 14, background: OG.track, marginTop: 12 }}>
                <div style={{ width: `${r.value}%`, background: OG.accent }} />
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div style={{ display: "flex", height: 14, background: OG.accent, width: 220 }} />
      )}
    </div>
  );
}
