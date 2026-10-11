import type { Hit, ScriptedHit } from './input';
import type { ExpectedNote } from './grading';
import { rockBeat } from './patterns';

/** The graded exercise: the 100 BPM rock beat, 2 bars, starting on bar 0. */
export const GRADE_BPM = 100;
export const GRADE_BARS = 2;

const BEAT_MS = 60_000 / GRADE_BPM;
const BAR_MS = 4 * BEAT_MS;

/** Expected notes for the exercise, with bar 0 beat 1 at `downbeat` (performance.now() ms). */
export function rockBeatNotes(downbeat: number): ExpectedNote[] {
  return rockBeat(GRADE_BPM, GRADE_BARS).map((h, i) => ({
    id: `rock-${i}-${h.pad}`,
    pad: h.pad,
    time: downbeat + h.at,
    ...(h.velocity !== undefined ? { velocity: h.velocity } : {}),
  }));
}

/** Turn a script into the hits TestSource would emit when started at `startTime`. */
export function scriptToHits(script: readonly ScriptedHit[], startTime: number): Hit[] {
  return script.map((s) => ({ pad: s.pad, velocity: s.velocity ?? 100, time: startTime + s.at, source: 'test' }));
}

export interface ExpectedSummary {
  accuracy: number;
  hit: number;
  wrongPad: number;
  missed: number;
  extra: number;
  meanOffsetMs: number;
  stdDevOffsetMs: number;
}

export interface GradeScenario {
  id: string;
  label: string;
  /** Offsets relative to bar 0 beat 1. */
  script: ScriptedHit[];
  expected: ExpectedSummary;
}

const isSnareAt = (h: ScriptedHit, at: number) => h.pad === 'snare' && h.at === at;

function buildScenarios(): GradeScenario[] {
  const base = rockBeat(GRADE_BPM, GRADE_BARS); // 16 hi-hats, 4 kicks, 4 snares
  const total = base.length;

  // Two snares dropped (bar 1 beat 2, bar 2 beat 4) and one extra kick on the "&" of 2 in bar 1,
  // 300 ms from any snare note, so it can't be taken as a wrong-pad hit for a missed snare.
  const missedSnareTimes = [BEAT_MS, BAR_MS + 3 * BEAT_MS];
  const withMisses = base.filter((h) => !missedSnareTimes.some((t) => isSnareAt(h, t)));
  withMisses.push({ pad: 'kick', at: 1.5 * BEAT_MS, velocity: 110 });

  // One hi-hat (the "&" of 1 in bar 1) played on the ride instead.
  const rideIndex = base.findIndex((h) => h.pad === 'hihatClosed' && h.at === BEAT_MS / 2);
  const withRide = base.map((h, i) => (i === rideIndex ? { ...h, pad: 'ride' as const } : h));

  return [
    {
      id: 'perfect',
      label: 'Perfect run',
      script: base,
      expected: { accuracy: 100, hit: total, wrongPad: 0, missed: 0, extra: 0, meanOffsetMs: 0, stdDevOffsetMs: 0 },
    },
    {
      id: 'late30',
      label: '30 ms late',
      script: base.map((h) => ({ ...h, at: h.at + 30 })),
      expected: { accuracy: 100, hit: total, wrongPad: 0, missed: 0, extra: 0, meanOffsetMs: 30, stdDevOffsetMs: 0 },
    },
    {
      id: 'missed',
      label: '2 missed snares + extra kick',
      script: withMisses.sort((a, b) => a.at - b.at),
      expected: { accuracy: ((total - 2) / total) * 100, hit: total - 2, wrongPad: 0, missed: 2, extra: 1, meanOffsetMs: 0, stdDevOffsetMs: 0 },
    },
    {
      id: 'ride',
      label: 'Hi-hat played as ride',
      script: withRide,
      expected: { accuracy: ((total - 1) / total) * 100, hit: total - 1, wrongPad: 1, missed: 0, extra: 0, meanOffsetMs: 0, stdDevOffsetMs: 0 },
    },
  ];
}

export const GRADE_SCENARIOS: readonly GradeScenario[] = buildScenarios();

/** Compare a summary with what a scenario should produce. Returns mismatches (empty = pass). */
export function checkSummary(actual: ExpectedSummary, expected: ExpectedSummary, toleranceMs = 0.5): string[] {
  const problems: string[] = [];
  for (const key of ['hit', 'wrongPad', 'missed', 'extra'] as const) {
    if (actual[key] !== expected[key]) problems.push(`${key}: expected ${expected[key]}, got ${actual[key]}`);
  }
  if (Math.abs(actual.accuracy - expected.accuracy) > 0.01) problems.push(`accuracy: expected ${expected.accuracy.toFixed(2)}%, got ${actual.accuracy.toFixed(2)}%`);
  if (Math.abs(actual.meanOffsetMs - expected.meanOffsetMs) > toleranceMs) problems.push(`mean offset: expected ${expected.meanOffsetMs} ms, got ${actual.meanOffsetMs.toFixed(2)} ms`);
  if (Math.abs(actual.stdDevOffsetMs - expected.stdDevOffsetMs) > toleranceMs) problems.push(`std dev: expected ${expected.stdDevOffsetMs} ms, got ${actual.stdDevOffsetMs.toFixed(2)} ms`);
  return problems;
}
