/** Pure chart geometry for the Progress view. The DOM side only turns these numbers into SVG. */

export interface ChartBox {
  readonly width: number;
  readonly height: number;
  /** Room for axis labels: the plot area is inside these margins. */
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
}

export interface Tick {
  readonly value: number;
  /** y in SVG units. */
  readonly y: number;
}

/**
 * Round tick values covering [min, max], about `count` of them, on steps of 1, 2, 2.5 or 5 times a
 * power of ten. A flat range is widened so there is always a span.
 */
export function niceTicks(min: number, max: number, count = 4): number[] {
  let lo = min;
  let hi = max;
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return [0, 1];
  if (hi - lo < 1e-9) {
    lo -= 1;
    hi += 1;
  }
  const raw = (hi - lo) / Math.max(1, count);
  const power = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * power).find((s) => s >= raw) ?? 10 * power;
  const first = Math.floor(lo / step + 1e-9) * step;
  const last = Math.ceil(hi / step - 1e-9) * step;
  const n = Math.max(1, Math.round((last - first) / step));
  return Array.from({ length: n + 1 }, (_, i) => round(first + i * step));
}

function round(v: number): number {
  return Math.round(v * 1e6) / 1e6;
}

export interface LinePoint {
  readonly x: number;
  readonly y: number;
  readonly value: number;
  /** Index into the input values. */
  readonly index: number;
}

export interface LineChart {
  /** SVG path data through the points with a value. Points without one are skipped, not zeroed. */
  readonly path: string;
  readonly points: LinePoint[];
  readonly yTicks: Tick[];
  /** x of each input value (evenly spaced, oldest left), with or without a value. */
  readonly xs: number[];
}

/**
 * A line chart of values in order (sessions, oldest first), evenly spaced across the plot. The y
 * range comes from nice ticks over the values, widened to include `yMin`/`yMax` if given (e.g.
 * 0–100 for accuracy). A single value sits in the middle.
 */
export function lineChart(values: readonly (number | null)[], box: ChartBox, options: { yMin?: number; yMax?: number; ticks?: number } = {}): LineChart {
  const present = values.filter((v): v is number => v !== null);
  const lo = Math.min(...present, ...(options.yMin !== undefined ? [options.yMin] : []));
  const hi = Math.max(...present, ...(options.yMax !== undefined ? [options.yMax] : []));
  const ticks = present.length === 0 && options.yMin === undefined ? [0, 1] : niceTicks(lo, hi, options.ticks ?? 4);
  const t0 = ticks[0]!;
  const t1 = ticks.at(-1)!;
  const plotW = box.width - box.left - box.right;
  const plotH = box.height - box.top - box.bottom;
  const yOf = (v: number) => box.top + plotH * (1 - (v - t0) / (t1 - t0 || 1));
  const xs = values.map((_, i) => (values.length === 1 ? box.left + plotW / 2 : box.left + (plotW * i) / (values.length - 1)));
  const points: LinePoint[] = [];
  values.forEach((v, i) => {
    if (v !== null) points.push({ x: xs[i]!, y: yOf(v), value: v, index: i });
  });
  const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${fmt(p.x)} ${fmt(p.y)}`).join(' ');
  return { path, points, yTicks: ticks.map((value) => ({ value, y: yOf(value) })), xs };
}

export interface Bar {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly value: number;
}

/** Vertical bars from 0, one per value, with a gap between them. The y axis is nice ticks from 0. */
export function barChart(values: readonly number[], box: ChartBox, options: { minMax?: number; gap?: number } = {}): { bars: Bar[]; yTicks: Tick[] } {
  const ticks = niceTicks(0, Math.max(options.minMax ?? 1, ...values), 3);
  const top = ticks.at(-1)!;
  const plotW = box.width - box.left - box.right;
  const plotH = box.height - box.top - box.bottom;
  const slot = plotW / Math.max(1, values.length);
  const gap = Math.min(options.gap ?? 8, slot / 2);
  const bars = values.map((value, i) => {
    const height = top > 0 ? (plotH * Math.max(0, value)) / top : 0;
    return { x: box.left + i * slot + gap / 2, y: box.top + plotH - height, width: slot - gap, height, value };
  });
  return { bars, yTicks: ticks.map((value) => ({ value, y: box.top + plotH * (1 - value / (top || 1)) })) };
}

function fmt(v: number): string {
  return String(Math.round(v * 100) / 100);
}
