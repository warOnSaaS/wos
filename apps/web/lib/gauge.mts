/**
 * Score gauges (the ring around a number, as in Lighthouse's score circles), in the site's monochrome system: an
 * off-white arc on a dim track, the number in the centre. This file is the pure model (no React, no imports) so
 * tests/self-assessment.test.ts can check the arc maths, the states and the labels; components/Gauge.tsx draws it.
 *
 * Honesty rules:
 *  - a score is drawn on its own scale (82 of 100, 6 of 10); a 0-10 score is never re-expressed as a percentage;
 *  - a missing value is "n/a", never a filled-in number;
 *  - "pending" (no run recorded yet) draws the ring empty and dashed, with no number at all.
 */

/** Ring geometry, in the SVG's own units (viewBox 0 0 100 100). */
export const GAUGE_R = 42;
export const GAUGE_STROKE = 7;
export const GAUGE_C = 2 * Math.PI * GAUGE_R;

export type GaugeState = "value" | "na" | "pending";

export type GaugeInput = {
  label: string;
  /** Null or undefined when the run has no such field ("n/a"). Ignored when pending. */
  value: number | null | undefined;
  /** The score's own scale: 100, 20 or 10. */
  max: number;
  pending?: boolean;
};

export type GaugeModel = {
  state: GaugeState;
  label: string;
  max: number;
  /** The value as recorded (only in the "value" state). */
  value: number | null;
  /** 0..1: the share of the ring drawn, clamped. */
  fraction: number;
  /** stroke-dasharray for the arc: drawn length, then the rest of the circumference. */
  dasharray: string;
  /** What the centre shows: the number, "n/a" or "PENDING". */
  centre: string;
  ariaLabel: string;
  /** Faint tick marks, as fractions of the ring (at 50 and 90 on a 0-100 scale; none on other scales). */
  ticks: number[];
};

const round = (n: number) => Math.round(n * 1000) / 1000;

/** The share of the ring a value fills: value / max, clamped to 0..1. Non-finite values and max <= 0 give 0. */
export function gaugeFraction(value: number, max: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(max) || max <= 0) return 0;
  return Math.min(1, Math.max(0, value / max));
}

/** Where tick t (a fraction of the ring) sits: the inner and outer ends of a short radial line, 12 o'clock is 0. */
export function tickLine(t: number): { x1: number; y1: number; x2: number; y2: number } {
  const a = 2 * Math.PI * t - Math.PI / 2;
  const r1 = GAUGE_R - GAUGE_STROKE / 2 - 1;
  const r2 = GAUGE_R + GAUGE_STROKE / 2 + 1;
  return {
    x1: round(50 + r1 * Math.cos(a)),
    y1: round(50 + r1 * Math.sin(a)),
    x2: round(50 + r2 * Math.cos(a)),
    y2: round(50 + r2 * Math.sin(a)),
  };
}

export function gaugeModel(g: GaugeInput): GaugeModel {
  const ticks = g.max === 100 ? [0.5, 0.9] : [];
  if (g.pending) {
    return {
      state: "pending",
      label: g.label,
      max: g.max,
      value: null,
      fraction: 0,
      dasharray: `0 ${round(GAUGE_C)}`,
      centre: "PENDING",
      ariaLabel: `${g.label}: self-assessment pending, no score yet`,
      ticks,
    };
  }
  if (g.value === null || g.value === undefined || !Number.isFinite(g.value)) {
    return {
      state: "na",
      label: g.label,
      max: g.max,
      value: null,
      fraction: 0,
      dasharray: `0 ${round(GAUGE_C)}`,
      centre: "n/a",
      ariaLabel: `${g.label}: not available in this run`,
      ticks,
    };
  }
  const fraction = gaugeFraction(g.value, g.max);
  const drawn = round(fraction * GAUGE_C);
  return {
    state: "value",
    label: g.label,
    max: g.max,
    value: g.value,
    fraction,
    dasharray: `${drawn} ${round(GAUGE_C - drawn)}`,
    centre: String(g.value),
    ariaLabel: `${g.label} ${g.value} out of ${g.max}`,
    ticks,
  };
}
