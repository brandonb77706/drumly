import type { Pad } from '../input';
import type { GradeResult, MatchedNoteResult, TimingGrade } from './types';

export interface GradeStats {
  /** Number of expected notes. */
  expected: number;
  hit: number;
  wrongPad: number;
  missed: number;
  extra: number;
  /** hit / expected * 100, or null with no expected notes. */
  accuracy: number | null;
  /**
   * Mean of hit.time - note.time over matched notes (hit and wrongPad), ms.
   * Negative = rushing, positive = dragging. Null with no matched notes.
   */
  meanOffsetMs: number | null;
  /** Population standard deviation of those offsets, ms. Lower = more consistent. */
  stdDevOffsetMs: number | null;
  /** Timing grade counts over matched notes. */
  timing: Record<TimingGrade, number>;
}

export interface GradeSummary extends GradeStats {
  /** Same stats per pad. Notes count under the expected pad; extras under the pad that was hit. */
  perPad: Partial<Record<Pad, GradeStats>>;
}

export function summarize(result: GradeResult): GradeSummary {
  const perPad: Partial<Record<Pad, Bucket>> = {};
  const bucketFor = (pad: Pad) => (perPad[pad] ??= emptyBucket());
  const all = emptyBucket();

  for (const r of result.notes) {
    for (const bucket of [all, bucketFor(r.note.pad)]) {
      bucket.expected++;
      bucket[r.status]++;
      if (r.status !== 'missed') bucket.matched.push(r);
    }
  }
  for (const e of result.extras) {
    all.extra++;
    bucketFor(e.hit.pad).extra++;
  }

  const perPadStats: Partial<Record<Pad, GradeStats>> = {};
  for (const [pad, bucket] of Object.entries(perPad) as [Pad, Bucket][]) perPadStats[pad] = toStats(bucket);
  return { ...toStats(all), perPad: perPadStats };
}

/** Arithmetic mean, or null for an empty list. */
export function mean(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  let sum = 0;
  for (const v of values) sum += v;
  return sum / values.length;
}

/** Population standard deviation (divide by n), or null for an empty list. */
export function stdDev(values: readonly number[]): number | null {
  const m = mean(values);
  if (m === null) return null;
  let sq = 0;
  for (const v of values) sq += (v - m) ** 2;
  return Math.sqrt(sq / values.length);
}

interface Bucket {
  expected: number;
  hit: number;
  wrongPad: number;
  missed: number;
  extra: number;
  matched: MatchedNoteResult[];
}

function emptyBucket(): Bucket {
  return { expected: 0, hit: 0, wrongPad: 0, missed: 0, extra: 0, matched: [] };
}

function toStats(b: Bucket): GradeStats {
  const offsets = b.matched.map((r) => r.offsetMs);
  const timing: Record<TimingGrade, number> = { perfect: 0, good: 0, early: 0, late: 0 };
  for (const r of b.matched) timing[r.timing]++;
  return {
    expected: b.expected,
    hit: b.hit,
    wrongPad: b.wrongPad,
    missed: b.missed,
    extra: b.extra,
    accuracy: b.expected > 0 ? (b.hit / b.expected) * 100 : null,
    meanOffsetMs: mean(offsets),
    stdDevOffsetMs: stdDev(offsets),
    timing,
  };
}
