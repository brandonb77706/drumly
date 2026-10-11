import { describe, expect, it } from 'vitest';
import type { Hit, Pad } from '../input';
import { grade } from './match';
import { mean, stdDev, summarize } from './summary';
import type { ExpectedNote } from './types';

const note = (id: string, pad: Pad, time: number): ExpectedNote => ({ id, pad, time });
const hit = (pad: Pad, time: number): Hit => ({ pad, time, velocity: 100, source: 'test' });

describe('mean and stdDev', () => {
  it('computes mean and population standard deviation', () => {
    expect(mean([2, 4, 4, 4, 5, 5, 7, 9])).toBe(5);
    expect(stdDev([2, 4, 4, 4, 5, 5, 7, 9])).toBe(2);
    expect(stdDev([30, 30, 30])).toBe(0);
  });

  it('returns null for empty input', () => {
    expect(mean([])).toBeNull();
    expect(stdDev([])).toBeNull();
  });
});

describe('summarize', () => {
  const notes = [
    note('k1', 'kick', 0),
    note('h1', 'hihatClosed', 0),
    note('h2', 'hihatClosed', 300),
    note('s1', 'snare', 600),
    note('h3', 'hihatClosed', 600),
    note('s2', 'snare', 1200),
  ];
  const hits = [
    hit('kick', 10), // hit, +10
    hit('hihatClosed', -10), // hit, -10
    hit('ride', 330), // wrongPad on h2, +30
    hit('snare', 650), // hit, +50 (late)
    hit('hihatClosed', 600), // hit, 0
    // s2 missed
    hit('tom1', 900), // extra
  ];
  const s = summarize(grade(notes, hits));

  it('counts statuses and accuracy (hits / expected)', () => {
    expect([s.expected, s.hit, s.wrongPad, s.missed, s.extra]).toEqual([6, 4, 1, 1, 1]);
    expect(s.accuracy).toBeCloseTo((4 / 6) * 100, 10);
  });

  it('computes mean and std dev over matched offsets (hit and wrongPad)', () => {
    const offsets = [10, -10, 30, 50, 0];
    expect(s.meanOffsetMs).toBeCloseTo(16, 10);
    expect(s.stdDevOffsetMs).toBeCloseTo(stdDev(offsets)!, 10);
    expect(s.timing).toEqual({ perfect: 3, good: 1, early: 0, late: 1 });
  });

  it('breaks the same numbers down per pad', () => {
    expect(s.perPad.kick).toMatchObject({ expected: 1, hit: 1, accuracy: 100, meanOffsetMs: 10, stdDevOffsetMs: 0 });
    expect(s.perPad.hihatClosed).toMatchObject({ expected: 3, hit: 2, wrongPad: 1, missed: 0 });
    expect(s.perPad.hihatClosed!.meanOffsetMs).toBeCloseTo(20 / 3, 10);
    expect(s.perPad.snare).toMatchObject({ expected: 2, hit: 1, missed: 1, accuracy: 50, meanOffsetMs: 50 });
    // Extras count under the pad that was hit.
    expect(s.perPad.tom1).toMatchObject({ expected: 0, extra: 1, accuracy: null, meanOffsetMs: null });
    // The ride was a wrong-pad hit on a hi-hat note, so it has no entry of its own.
    expect(s.perPad.ride).toBeUndefined();
  });

  it('handles an empty grade', () => {
    expect(summarize({ notes: [], extras: [] })).toMatchObject({ expected: 0, accuracy: null, meanOffsetMs: null, stdDevOffsetMs: null, perPad: {} });
  });
});
