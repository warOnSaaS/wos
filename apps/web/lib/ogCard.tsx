import { OG } from "./og";

/** 1200x630 share card: ops-console look, monochrome, hairline rules. */
export function OgCard({
  mark,
  kicker,
  id,
  title,
  subtitle,
  rows,
}: {
  /** data URL of the wOS mark (markDataUrl()). */
  mark: string;
  kicker: string;
  id?: string;
  title: string;
  subtitle: string;
  rows: { label: string; value: string }[];
}) {
  const rule = `1px solid ${OG.rule}`;
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        background: OG.bg,
        color: OG.fg,
        fontFamily: "JetBrains Mono",
        padding: 40,
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", flex: 1, border: rule }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            padding: "16px 24px",
            borderBottom: rule,
            fontSize: 22,
            letterSpacing: 3,
            color: OG.dim,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <div style={{ display: "flex", border: `1px solid ${OG.fg}` }}>
              <img src={mark} width={48} height={48} alt="" />
            </div>
            <span style={{ color: OG.fg, fontFamily: "Geist Mono", fontWeight: 700, letterSpacing: 0 }}>warOnSaaS</span>
          </div>
          <span>{kicker}</span>
        </div>

        <div style={{ display: "flex", flexDirection: "column", flex: 1, justifyContent: "center", padding: "0 24px" }}>
          {id ? (
            <div style={{ display: "flex", fontSize: 26, color: OG.dim, letterSpacing: 3, marginBottom: 12 }}>{id}</div>
          ) : null}
          <div style={{ display: "flex", fontFamily: "Geist Mono", fontSize: title.length > 30 ? 52 : 64, fontWeight: 700, lineHeight: 1.15 }}>
            {title}
          </div>
          <div style={{ display: "flex", fontSize: 26, color: OG.dim, marginTop: 16 }}>{subtitle}</div>
        </div>

        <div style={{ display: "flex", borderTop: rule }}>
          {rows.map((r, i) => (
            <div
              key={r.label}
              style={{
                display: "flex",
                flexDirection: "column",
                flex: 1,
                padding: "16px 24px",
                borderLeft: i === 0 ? "none" : rule,
              }}
            >
              <span style={{ fontSize: 18, color: OG.dim, letterSpacing: 3 }}>{r.label}</span>
              <span style={{ fontSize: 48, fontWeight: 700, marginTop: 4 }}>{r.value}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
