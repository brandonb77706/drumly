import { describe, expect, it } from 'vitest';
import { barChart, lineChart, niceTicks, xAxisLabels, type ChartBox } from './chart';

const box: ChartBox = { width: 300, height: 120, left: 30, right: 10, top: 10, bottom: 10 };

describe('niceTicks', () => {
  it('round steps covering the range', () => {
    expect(niceTicks(0, 100, 4)).toEqual([0, 25, 50, 75, 100]);
    expect(niceTicks(72, 118, 4)).toEqual([60, 80, 100, 120]);
    expect(niceTicks(0, 7.3, 3)).toEqual([0, 2.5, 5, 7.5]);
  });

  it('a flat range still gets a span', () => {
    expect(niceTicks(90, 90, 4)).toEqual([89, 89.5, 90, 90.5, 91]);
  });
});

describe('lineChart', () => {
  it('spaces sessions evenly and maps values onto the ticks', () => {
    const c = lineChart([50, 75, 100], box, { yMin: 0, yMax: 100 });
    expect(c.xs).toEqual([30, 160, 290]);
    expect(c.yTicks[0]).toEqual({ value: 0, y: 110 });
    expect(c.yTicks.at(-1)).toEqual({ value: 100, y: 10 });
    expect(c.points.map((p) => [p.x, p.y])).toEqual([[30, 60], [160, 35], [290, 10]]);
    expect(c.path).toBe('M30 60 L160 35 L290 10');
  });

  it('missing values are skipped, not drawn as zero', () => {
    const c = lineChart([null, 90, null, 100], box);
    expect(c.points.map((p) => p.index)).toEqual([1, 3]);
    expect(c.path.split(' L')).toHaveLength(2);
  });

  it('one value sits in the middle; no values gives an empty path', () => {
    expect(lineChart([80], box).points[0]!.x).toBe(160);
    expect(lineChart([null, null], box)).toMatchObject({ path: '', points: [] });
  });
});

describe('barChart', () => {
  it('bars from zero, scaled to nice ticks', () => {
    const { bars, yTicks } = barChart([0, 10, 20], box, { gap: 10 });
    expect(yTicks.map((t) => t.value)).toEqual([0, 10, 20]);
    expect(bars.map((b) => Math.round(b.height))).toEqual([0, 50, 100]);
    expect(bars[2]!.y).toBe(10);
    expect(bars[0]!.width).toBeCloseTo(260 / 3 - 10);
  });

  it('an empty week still has an axis', () => {
    const { bars, yTicks } = barChart([0, 0, 0], box, { minMax: 5 });
    expect(bars.every((b) => b.height === 0)).toBe(true);
    expect(yTicks.at(-1)!.value).toBeGreaterThanOrEqual(5);
  });
});

describe('xAxisLabels', () => {
  /** Local time, 1-based month. */
  const at = (month: number, day: number, h = 12, m = 0) => new Date(2026, month - 1, day, h, m).getTime();
  // Some ICU versions put a narrow no-break space before AM/PM.
  const plain = (text: string) => text.replace(/\s/g, ' ');
  const texts = (times: number[], max?: number) => xAxisLabels(times, { locale: 'en-US', ...(max !== undefined ? { maxLabels: max } : {}) }).labels.map((l) => plain(l.text));

  it('all on one day: times, with the day for the caption', () => {
    const axis = xAxisLabels([at(10, 11, 13, 26), at(10, 11, 14, 5), at(10, 11, 21, 0)], { locale: 'en-US' });
    expect(axis.mode).toBe('time');
    expect(axis.day).toBe('Oct 11');
    expect(axis.labels.map((l) => plain(l.text))).toEqual(['1:26 PM', '2:05 PM', '9:00 PM']);
    expect(axis.labels.map((l) => l.anchor)).toEqual(['start', 'middle', 'end']);
  });

  it('spanning days: dates, each shown once', () => {
    const axis = xAxisLabels([at(10, 9), at(10, 11, 9), at(10, 11, 18), at(10, 12)], { locale: 'en-US' });
    expect(axis.mode).toBe('date');
    expect(axis.day).toBeNull();
    expect(axis.labels.map((l) => [l.index, l.text])).toEqual([[0, 'Oct 9'], [1, 'Oct 11'], [3, 'Oct 12']]);
  });

  it('11:59 pm and 12:01 am are different days', () => {
    expect(xAxisLabels([at(10, 11, 23, 59), at(10, 12, 0, 1)], { locale: 'en-US' }).mode).toBe('date');
  });

  it('never more than 6 labels, spread from first to last', () => {
    const many = Array.from({ length: 40 }, (_, i) => at(9, 1 + i));
    const axis = xAxisLabels(many, { locale: 'en-US' });
    expect(axis.labels).toHaveLength(6);
    expect(axis.labels[0]!.index).toBe(0);
    expect(axis.labels.at(-1)!.index).toBe(39);
    expect(axis.labels.map((l) => l.index)).toEqual([0, 8, 16, 23, 31, 39]);
    // Same on one day.
    const day = Array.from({ length: 25 }, (_, i) => at(10, 11, 8, i * 2));
    expect(texts(day)).toHaveLength(6);
    expect(texts(day, 3)).toEqual(['8:00 AM', '8:24 AM', '8:48 AM']);
  });

  it('sessions in the same minute share one label', () => {
    expect(texts([at(10, 11, 13, 59), at(10, 11, 13, 59), at(10, 11, 14, 30)])).toEqual(['1:59 PM', '2:30 PM']);
  });

  it('one session sits in the middle; none gives no labels', () => {
    const one = xAxisLabels([at(10, 11, 13, 26)], { locale: 'en-US' }).labels;
    expect(one.map((l) => ({ ...l, text: plain(l.text) }))).toEqual([{ index: 0, text: '1:26 PM', anchor: 'middle' }]);
    expect(xAxisLabels([]).labels).toEqual([]);
  });

  it('labels never overlap on the detail chart (6 labels across its 462-unit plot)', () => {
    const many = Array.from({ length: 30 }, (_, i) => at(10, 11, 8, i * 3));
    const c = lineChart(many.map(() => 50), { width: 520, height: 200, left: 44, right: 14, top: 14, bottom: 28 });
    const xs = xAxisLabels(many, { locale: 'en-US' }).labels.map((l) => c.xs[l.index]!);
    const gaps = xs.slice(1).map((x, i) => x - xs[i]!);
    // "12:59 PM" at 12px is about 50 units wide; centred labels need at least that much between them.
    expect(Math.min(...gaps)).toBeGreaterThan(60);
  });
});
