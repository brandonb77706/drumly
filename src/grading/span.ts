import type { Hit } from '../input';
import { grade } from './match';
import { resolveConfig, type ExpectedNote, type GradeResult, type GradingConfig } from './types';

/**
 * Batch-grade one span of a longer run (one loop pass): the notes with time in [fromTime, toTime),
 * or the notes `inSpan` picks. Pick a loop pass's notes by id (notePass): a note's stored time can
 * differ by a fraction of a millisecond from a downbeat read from the grid later (the metronome
 * refreshes its clock reference), and a time test would put a downbeat note in the wrong pass.
 *
 * Boundary hits are handled by grading a little context around the span: the notes within two
 * matching windows of either edge (from the neighbouring passes), and the hits within three. A
 * hit near the boundary can then go to whichever side's note the alignment prefers, as in a grade
 * of the whole run, instead of being taken by this span's first or last note just because the
 * neighbour wasn't there. Only the span's own notes are returned, plus the extras with time in
 * [fromTime - windowMs, toTime - windowMs), the same split as resultForPass: a hit slightly early
 * for a downbeat counts toward the pass that downbeat starts, so each extra is in one span only.
 *
 * Cheap: a pass is a few bars, so this is a small batch grade.
 */
export function gradeSpan(
  notes: readonly ExpectedNote[],
  hits: readonly Hit[],
  fromTime: number,
  toTime: number,
  config: Partial<GradingConfig> = {},
  inSpan: (note: ExpectedNote) => boolean = (n) => n.time >= fromTime && n.time < toTime,
): GradeResult {
  const w = resolveConfig(config).windowMs;
  const context = notes.filter((n) => n.time >= fromTime - 2 * w && n.time < toTime + 2 * w);
  const nearHits = hits.filter((h) => h.time >= fromTime - 3 * w && h.time < toTime + 3 * w);
  const result = grade(context, nearHits, config);
  return {
    notes: result.notes.filter((r) => inSpan(r.note)),
    extras: result.extras.filter((e) => e.hit.time >= fromTime - w && e.hit.time < toTime - w),
  };
}
