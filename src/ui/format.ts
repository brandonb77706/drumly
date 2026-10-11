import { DEFAULT_TIMING_THRESHOLDS } from '../grading/types';

/** Whole milliseconds with a sign: "+12 ms", "-8 ms", "0 ms". Never "-0". */
export function formatOffset(ms: number): string {
  const r = Math.round(ms);
  if (r === 0) return '0 ms'; // also catches -0 and anything rounding to it
  return r > 0 ? `+${r} ms` : `${r} ms`;
}

/**
 * Timing in words, for wrong-pad hits where a grade like "perfect" would contradict the verdict:
 * "on time" within the perfect threshold, otherwise "12 ms late" / "8 ms early".
 */
export function formatTimingPhrase(ms: number, onTimeMs = DEFAULT_TIMING_THRESHOLDS.perfectMs): string {
  const r = Math.round(ms);
  if (Math.abs(r) <= onTimeMs) return 'on time';
  return r > 0 ? `${r} ms late` : `${-r} ms early`;
}

/** A signed ms value with one decimal for stats, without "-0.0". */
export function formatMsStat(v: number | null): string {
  if (v === null) return '—';
  const fixed = v.toFixed(1);
  if (Number(fixed) === 0) return '0.0';
  return v > 0 ? `+${fixed}` : fixed;
}
