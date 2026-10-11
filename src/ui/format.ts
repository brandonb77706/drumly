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

/** A mean offset for stats: formatOffset, or "—" with nothing to average. */
export function formatMeanOffset(v: number | null): string {
  return v === null ? '—' : formatOffset(v);
}

/** An unsigned spread (std dev) in whole ms: "12 ms", or "—". */
export function formatSpread(v: number | null): string {
  return v === null ? '—' : `${Math.round(v)} ms`;
}

/** A percentage without a pointless ".0": "100%", "92.9%", or "—". */
export function formatPctShort(v: number | null): string {
  if (v === null) return '—';
  const fixed = Number(v.toFixed(1));
  return `${fixed}%`;
}

/**
 * CSS classes for a pass chip. The color is the ladder's own verdict (green clean, gray almost,
 * red rough), so a pass the trainer counted as clean never looks like a failed one. The session
 * best is marked separately and doesn't change the color.
 */
export function passChipClass(verdict: 'clean' | 'almost' | 'rough', isBest: boolean): string {
  return `pass-chip ${verdict}${isBest ? ' best' : ''}`;
}

/** Time played: "45 s" under a minute, "12 min", "1 h 05 min". */
export function formatDuration(ms: number): string {
  const totalMin = Math.floor(ms / 60_000);
  if (totalMin === 0) return ms <= 0 ? '0 min' : `${Math.max(1, Math.round(ms / 1000))} s`;
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return h > 0 ? `${h} h ${String(m).padStart(2, '0')} min` : `${m} min`;
}
