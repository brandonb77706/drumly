import { describe, expect, it } from 'vitest';
import {
  clickAt,
  clicksInWindow,
  contextToPerformanceTime,
  isAccentClick,
  isCountInBar,
  performanceToContextTime,
  secondsPerClick,
  type ClockReference,
  type GridSegment,
} from './timing';

const ms = (s: number) => s * 1000;

function segment(overrides: Partial<GridSegment> = {}): GridSegment {
  return {
    startIndex: 0,
    startTime: 10,
    bar: 0,
    beat: 0,
    bpm: 120,
    beatsPerBar: 4,
    subdivision: 'quarter',
    accent: true,
    countIn: false,
    ...overrides,
  };
}

describe('beat interval math', () => {
  it('120 BPM: quarter 500 ms, 8th 250 ms, 16th 125 ms, triplet 166.67 ms', () => {
    expect(ms(secondsPerClick(120, 'quarter'))).toBe(500);
    expect(ms(secondsPerClick(120, 'eighth'))).toBe(250);
    expect(ms(secondsPerClick(120, 'sixteenth'))).toBe(125);
    expect(ms(secondsPerClick(120, 'triplet'))).toBeCloseTo(166.667, 3);
  });

  it('scales with BPM at the range limits', () => {
    expect(ms(secondsPerClick(30, 'quarter'))).toBe(2000);
    expect(ms(secondsPerClick(300, 'quarter'))).toBe(200);
  });
});

describe('clicksInWindow', () => {
  it('returns every click in a whole window', () => {
    const times = clicksInWindow(segment(), 10, 12).map((c) => c.time);
    expect(times).toEqual([10, 10.5, 11, 11.5]);
  });

  it('handles partial windows: start inclusive, end exclusive', () => {
    const seg = segment({ subdivision: 'eighth' });
    expect(clicksInWindow(seg, 10.3, 11.1).map((c) => c.time)).toEqual([10.5, 10.75, 11]);
    expect(clicksInWindow(seg, 10.25, 10.5).map((c) => c.time)).toEqual([10.25]);
  });

  it('returns nothing for windows before the start or with no clicks', () => {
    expect(clicksInWindow(segment(), 0, 9.99)).toEqual([]);
    expect(clicksInWindow(segment(), 10.1, 10.4)).toEqual([]);
    expect(clicksInWindow(segment(), 12, 11)).toEqual([]);
  });

  it('respects the segment end index', () => {
    expect(clicksInWindow(segment(), 10, 20, 3).map((c) => c.index)).toEqual([0, 1, 2]);
  });

  it('keeps triplet times exact far into a session (no accumulated drift)', () => {
    const seg = segment({ subdivision: 'triplet' });
    const click = clickAt(seg, 3 * 4 * 1000); // bar 1000, beat 0
    expect(click.time).toBeCloseTo(10 + 1000 * 2, 9);
    expect([click.bar, click.beat, click.subdivision]).toEqual([1000, 0, 0]);
  });
});

describe('accent and count-in flags', () => {
  it('accents only beat 1, on the beat, when enabled', () => {
    expect(isAccentClick(0, 0, true)).toBe(true);
    expect(isAccentClick(0, 1, true)).toBe(false);
    expect(isAccentClick(1, 0, true)).toBe(false);
    expect(isAccentClick(0, 0, false)).toBe(false);
  });

  it('marks bars before 0 as count-in', () => {
    expect(isCountInBar(-1)).toBe(true);
    expect(isCountInBar(0)).toBe(false);
  });

  it('labels bar, beat, subdivision and accent correctly across bar boundaries', () => {
    const seg = segment({ subdivision: 'eighth', beatsPerBar: 3 });
    const labels = clicksInWindow(seg, 10, 13.25).map((c) => `${c.bar}.${c.beat}.${c.subdivision}${c.isAccent ? '!' : ''}`);
    expect(labels).toEqual(['0.0.0!', '0.0.1', '0.1.0', '0.1.1', '0.2.0', '0.2.1', '1.0.0!', '1.0.1', '1.1.0', '1.1.1', '1.2.0', '1.2.1', '2.0.0!']);
  });
});

describe('clock conversion', () => {
  const ref: ClockReference = { contextTime: 2, performanceTime: 5000, latencyMs: 0 };

  it('maps context seconds to performance ms using the reference pair', () => {
    expect(contextToPerformanceTime(2, ref)).toBe(5000);
    expect(contextToPerformanceTime(2.5, ref)).toBe(5500);
    expect(contextToPerformanceTime(1, ref)).toBe(4000);
  });

  it('adds output latency (fallback path) and the manual offset', () => {
    expect(contextToPerformanceTime(2.5, { ...ref, latencyMs: 12 })).toBe(5512);
    expect(contextToPerformanceTime(2.5, ref, 30)).toBe(5530);
    expect(contextToPerformanceTime(2.5, { ...ref, latencyMs: 12 }, -5)).toBe(5507);
  });

  it('round-trips in both directions', () => {
    const r: ClockReference = { contextTime: 3.217, performanceTime: 81234.56, latencyMs: 23.4 };
    for (const t of [0, 3.217, 4.1, 100.003]) {
      expect(performanceToContextTime(contextToPerformanceTime(t, r, 17), r, 17)).toBeCloseTo(t, 9);
    }
    for (const p of [81000, 90000.25]) {
      expect(contextToPerformanceTime(performanceToContextTime(p, r, -8), r, -8)).toBeCloseTo(p, 6);
    }
  });
});
