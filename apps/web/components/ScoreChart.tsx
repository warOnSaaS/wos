import type { Evaluator, Marker, Metric, Run } from "@/lib/assessments";
import { evaluatorOf, runDate } from "@/lib/assessments";

/**
 * One small-multiple panel: one score over time, one series per evaluator. Server-rendered SVG, so it reads
 * without JavaScript.
 *
 * Built to the dataviz method, within the site's monochrome system (no hue anywhere):
 * - form: change over time, so a line with >=8px markers; one panel per score (small multiples), never two
 *   scales on one plot;
 * - identity: marker shape (circle, square, triangle, diamond; a fifth evaluator and beyond share a hollow
 *   OTHER marker) plus the shared legend above the panels, with the stroke alternating between the two ink steps
 *   (--fg, --dim). The palette validator fails hue-based checks by design (lightness band, chroma floor) and passes
 *   separation, CVD and contrast; shape and legend are the identity channel, never the gray alone;
 * - marks: 2px lines, 2px surface ring on markers, hairline solid grid at 0, half and max, recessive axis text;
 * - selective labels: only each series' latest value, skipped where it would collide;
 * - hover: every marker has a 24px hit area with a native tooltip (<title>); the table below is the full twin;
 * - paper versions: a hairline at the first run of each version, labelled.
 * Figures the page draws from data carry data-figure so scripts/check-numbers.mjs can check them.
 */

const W = 360;
const H = 196;
const M = { top: 22, right: 40, bottom: 24, left: 30 };
const PW = W - M.left - M.right;
const PH = H - M.top - M.bottom;

const day = (d: string) => Date.parse(`${d}T00:00:00Z`);

export function markerPath(m: Marker, cx: number, cy: number): React.ReactNode {
  switch (m) {
    case "circle":
      return <circle cx={cx} cy={cy} r={4.5} />;
    case "square":
      return <rect x={cx - 4} y={cy - 4} width={8} height={8} />;
    case "triangle":
      return <path d={`M${cx} ${cy - 5.5}L${cx + 5.5} ${cy + 4}L${cx - 5.5} ${cy + 4}Z`} />;
    case "diamond":
      return <path d={`M${cx} ${cy - 5.5}L${cx + 5.5} ${cy}L${cx} ${cy + 5.5}L${cx - 5.5} ${cy}Z`} />;
    default:
      return <circle cx={cx} cy={cy} r={4} className="chart__hollow" />;
  }
}

/** The ink step for an evaluator: alternates so neighbouring series never share both shape and gray. */
export const inkOf = (list: Evaluator[], e: Evaluator) => (list.indexOf(e) % 2 === 0 ? "chart__ink" : "chart__ink2");

export function ScoreChart({
  metric,
  runs,
  evaluators,
  versions,
  domain,
}: {
  metric: Metric;
  runs: Run[];
  evaluators: Evaluator[];
  versions: { version: string; date: string }[];
  domain: [string, string];
}) {
  const t0 = day(domain[0]);
  const t1 = day(domain[1]);
  const x = (d: string) => (t1 === t0 ? M.left + PW / 2 : M.left + ((day(d) - t0) / (t1 - t0)) * PW);
  const y = (v: number) => M.top + (1 - v / metric.max) * PH;
  const ticks = [0, metric.max / 2, metric.max];
  const labelled: number[] = [];
  const titleId = `chart-${metric.key}`;

  return (
    <figure className="chart">
      <figcaption className="label" id={titleId}>
        {metric.label} <span className="dim">/ {metric.max}</span>
      </figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-labelledby={titleId} className="chart__svg">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={M.left} x2={M.left + PW} y1={y(t)} y2={y(t)} className="chart__grid" />
            <text x={M.left - 6} y={y(t) + 3.5} textAnchor="end" className="chart__axis" data-axis="">
              {t}
            </text>
          </g>
        ))}
        {versions.map((v) => (
          <g key={v.version}>
            <line x1={x(v.date)} x2={x(v.date)} y1={M.top - 4} y2={M.top + PH} className="chart__version" />
            <text x={x(v.date) + 3} y={M.top - 8} className="chart__axis">
              v{v.version}
            </text>
          </g>
        ))}
        <text x={M.left} y={H - 6} className="chart__axis">
          {domain[0]}
        </text>
        {domain[1] !== domain[0] ? (
          <text x={M.left + PW} y={H - 6} textAnchor="end" className="chart__axis">
            {domain[1]}
          </text>
        ) : null}
        {evaluators.map((e) => {
          const pts = runs.filter((r) => evaluatorOf(r, evaluators) === e);
          if (!pts.length) return null;
          const ink = inkOf(evaluators, e);
          const last = pts[pts.length - 1]!;
          const lv = metric.get(last.block);
          const ly = y(lv);
          const showLabel = !labelled.some((o) => Math.abs(o - ly) < 11);
          if (showLabel) labelled.push(ly);
          return (
            <g key={e.key} data-series={e.key} className={`chart__series ${ink}`}>
              {pts.length > 1 ? (
                <polyline points={pts.map((r) => `${x(runDate(r))},${y(metric.get(r.block))}`).join(" ")} className="chart__line" />
              ) : null}
              {pts.map((r) => {
                const v = metric.get(r.block);
                return (
                  <g key={r.id} className="chart__pt">
                    <title>{`${r.block.evaluator.model}, ${runDate(r)}, paper v${r.servedPaperVersion}: ${v}/${metric.max}`}</title>
                    <circle cx={x(runDate(r))} cy={y(v)} r={12} className="chart__hit" />
                    {markerPath(e.marker, x(runDate(r)), y(v))}
                  </g>
                );
              })}
              {showLabel ? (
                <text x={x(runDate(last)) + 9} y={ly + 3.5} className="chart__val" data-figure={lv}>
                  {lv}
                </text>
              ) : null}
            </g>
          );
        })}
      </svg>
    </figure>
  );
}

/** A legend key: the evaluator's marker, drawn exactly as on the charts. */
export function MarkerKey({ evaluator, evaluators }: { evaluator: Evaluator; evaluators: Evaluator[] }) {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" className={`chart__key ${inkOf(evaluators, evaluator)}`}>
      {markerPath(evaluator.marker, 8, 8)}
    </svg>
  );
}
