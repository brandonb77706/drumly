import { describe, expect, it } from 'vitest';
import { barChart, lineChart, niceTicks, type ChartBox } from './chart';

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
