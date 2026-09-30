import { GAUGE_R, GAUGE_STROKE, type GaugeInput, gaugeModel, tickLine } from "@/lib/gauge.mts";

/**
 * One score ring. Server-rendered inline SVG, no script, no chart library (lib/gauge.mts has the maths and the rules).
 * Monochrome: an --fg arc on a --rule track; the number in Geist Mono (--font-head). The arc starts at 12 o'clock and
 * runs clockwise. The value carries data-figure, so scripts/check-numbers.mjs can prove it is a recorded score.
 */
export function Gauge({ size = "big", ...input }: GaugeInput & { size?: "big" | "small" }) {
  const m = gaugeModel(input);
  return (
    <figure className={`gauge gauge--${size} gauge--${m.state}`}>
      <svg
        viewBox="0 0 100 100"
        role="img"
        aria-label={m.ariaLabel}
        {...(m.state === "value" ? { "data-figure": String(m.value) } : {})}
      >
        <circle className="gauge__track" cx="50" cy="50" r={GAUGE_R} strokeWidth={GAUGE_STROKE} fill="none" />
        {m.ticks.map((t) => {
          const l = tickLine(t);
          return <line key={t} className="gauge__tick" {...l} />;
        })}
        {m.state === "value" && m.fraction > 0 ? (
          <circle
            className="gauge__arc"
            cx="50"
            cy="50"
            r={GAUGE_R}
            strokeWidth={GAUGE_STROKE}
            fill="none"
            strokeDasharray={m.dasharray}
            transform="rotate(-90 50 50)"
          />
        ) : null}
        <text className="gauge__num" x="50" y="50" textAnchor="middle" dominantBaseline="central" aria-hidden="true">
          {m.centre}
        </text>
      </svg>
      <figcaption>
        <span className="gauge__label">{m.label}</span>
        <span className="gauge__scale">OF {m.max}</span>
      </figcaption>
    </figure>
  );
}
