import { DEFAULT_TIMING_THRESHOLDS, type TimingGrade, type TimingThresholds } from './types';

/**
 * Label a matched hit by its offset (hit.time - note.time, ms).
 * perfect: |offset| <= perfectMs, good: <= goodMs, otherwise early (negative) or late (positive).
 */
export function gradeTiming(offsetMs: number, thresholds: TimingThresholds = DEFAULT_TIMING_THRESHOLDS): TimingGrade {
  const abs = Math.abs(offsetMs);
  if (abs <= thresholds.perfectMs) return 'perfect';
  if (abs <= thresholds.goodMs) return 'good';
  return offsetMs < 0 ? 'early' : 'late';
}
