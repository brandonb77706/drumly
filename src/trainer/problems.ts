import { DEFAULT_TIMING_THRESHOLDS, type NoteResult } from '../grading';
import type { Pad } from '../input';
import { clicksPerBeat } from '../metronome/timing';
import { focusNoteIndices, noteIndex, positionLabel, type Lesson } from '../lessons';

/** How one note of the lesson has gone across a session's passes. */
export interface NoteProblemStats {
  /** Index into lesson.notes. */
  readonly index: number;
  readonly pad: Pad;
  readonly bar: number;
  readonly beat: number;
  readonly subdivision: number;
  passes: number;
  missed: number;
  wrongPad: number;
  /** Which pads were played instead, and how often. */
  readonly wrongPads: Map<Pad, number>;
  /** Matched hits more than `onTimeMs` early / late. */
  early: number;
  late: number;
  /** Passes where the note was off in any way (missed, wrong pad, early or late), counted once per pass. */
  offPasses: number;
  offsetSum: number;
  offsetCount: number;
}

export interface ProblemSpot {
  readonly stats: NoteProblemStats;
  readonly score: number;
  /** Mean offset of matched hits, ms, or null if never matched. */
  readonly meanOffsetMs: number | null;
}

export interface ProblemTrackerOptions {
  /** Only track notes in the lesson's focus range. Default true. */
  focusOnly?: boolean;
  /**
   * Hits within this many ms count as on time for problem spots. Default: the perfect
   * threshold, so a note that is consistently "good but 30 ms late" still shows up.
   */
  onTimeMs?: number;
  /** A note is a problem spot only if it was off in at least this many passes. Default 2. */
  minOffPasses?: number;
  /** ...and in at least this share of the passes it was graded in. Default 1/3. */
  minOffShare?: number;
}

export const MIN_OFF_PASSES = 2;
export const MIN_OFF_SHARE = 1 / 3;

/**
 * Tracks each note across passes and ranks the worst ones. One slip isn't a problem spot: a note
 * qualifies only when it was off in at least `minOffPasses` passes and in at least `minOffShare`
 * of the passes it was graded in.
 * Score: misses and wrong pads count 1 each, early or late hits 0.5 each. Ties go to the larger
 * average offset, then to the earlier note in the lesson, so the ranking is deterministic.
 */
export class ProblemTracker {
  private readonly byIndex = new Map<number, NoteProblemStats>();
  private readonly tracked: ReadonlySet<number>;
  private readonly onTimeMs: number;
  private readonly minOffPasses: number;
  private readonly minOffShare: number;

  constructor(
    readonly lesson: Lesson,
    options: ProblemTrackerOptions = {},
  ) {
    this.tracked = options.focusOnly === false ? new Set(lesson.notes.keys()) : focusNoteIndices(lesson);
    this.onTimeMs = options.onTimeMs ?? DEFAULT_TIMING_THRESHOLDS.perfectMs;
    this.minOffPasses = options.minOffPasses ?? MIN_OFF_PASSES;
    this.minOffShare = options.minOffShare ?? MIN_OFF_SHARE;
  }

  /** Add one pass's note results (any notes outside the tracked set are ignored). */
  recordPass(notes: readonly NoteResult[]): void {
    for (const r of notes) {
      const index = noteIndex(r.note.id);
      if (index === null || !this.tracked.has(index)) continue;
      const s = this.statsFor(index);
      s.passes++;
      if (r.status === 'missed') {
        s.missed++;
        s.offPasses++;
        continue;
      }
      let off = false;
      if (r.status === 'wrongPad') {
        s.wrongPad++;
        s.wrongPads.set(r.hit.pad, (s.wrongPads.get(r.hit.pad) ?? 0) + 1);
        off = true;
      }
      s.offsetSum += r.offsetMs;
      s.offsetCount++;
      if (r.offsetMs < -this.onTimeMs) {
        s.early++;
        off = true;
      } else if (r.offsetMs > this.onTimeMs) {
        s.late++;
        off = true;
      }
      if (off) s.offPasses++;
    }
  }

  stats(): NoteProblemStats[] {
    return [...this.byIndex.values()].sort((a, b) => a.index - b.index);
  }

  /** True if the note was off often enough to count as a problem spot (see the class comment). */
  qualifies(s: NoteProblemStats): boolean {
    return s.offPasses >= this.minOffPasses && s.offPasses >= this.minOffShare * s.passes;
  }

  /** The `count` worst notes that qualify as problem spots, worst first. */
  worst(count = 3): ProblemSpot[] {
    return this.stats()
      .filter((stats) => stats.offPasses > 0 && this.qualifies(stats))
      .map((stats) => ({
        stats,
        score: stats.missed + stats.wrongPad + 0.5 * (stats.early + stats.late),
        meanOffsetMs: stats.offsetCount > 0 ? stats.offsetSum / stats.offsetCount : null,
      }))
      .sort((a, b) => b.score - a.score || Math.abs(b.meanOffsetMs ?? 0) - Math.abs(a.meanOffsetMs ?? 0) || a.stats.index - b.stats.index)
      .slice(0, count);
  }

  /**
   * Plain-language description, e.g.
   * "Tom 2 on the 'e' of beat 4 (bar 2): late in 4 of 6 passes, about 35 ms late on average".
   */
  describe(spot: ProblemSpot, padLabel: (pad: Pad) => string): string {
    const s = spot.stats;
    const where = positionLabel(s.bar, s.beat, s.subdivision, clicksPerBeat(this.lesson.subdivision));
    const parts: { count: number; text: string }[] = [];
    if (s.missed > 0) parts.push({ count: s.missed, text: `missed in ${s.missed} of ${s.passes} passes` });
    for (const [pad, n] of [...s.wrongPads].sort((a, b) => b[1] - a[1])) parts.push({ count: n, text: `hit as ${padLabel(pad)} ${times(n)}` });
    const mean = spot.meanOffsetMs;
    const average = mean !== null && Math.abs(mean) > this.onTimeMs ? `, about ${Math.round(Math.abs(mean))} ms ${mean > 0 ? 'late' : 'early'} on average` : '';
    if (s.late > 0) parts.push({ count: s.late, text: `late in ${s.late} of ${s.passes} passes${mean !== null && mean > 0 ? average : ''}` });
    if (s.early > 0) parts.push({ count: s.early, text: `early in ${s.early} of ${s.passes} passes${mean !== null && mean < 0 ? average : ''}` });
    parts.sort((a, b) => b.count - a.count); // stable: ties keep the order above
    return `${padLabel(s.pad)} on ${where}: ${parts.map((p) => p.text).join('; ')}`;
  }

  private statsFor(index: number): NoteProblemStats {
    let s = this.byIndex.get(index);
    if (!s) {
      const note = this.lesson.notes[index]!;
      s = {
        index,
        pad: note.pad,
        bar: note.bar,
        beat: note.beat,
        subdivision: note.subdivision,
        passes: 0,
        missed: 0,
        wrongPad: 0,
        wrongPads: new Map(),
        early: 0,
        late: 0,
        offPasses: 0,
        offsetSum: 0,
        offsetCount: 0,
      };
      this.byIndex.set(index, s);
    }
    return s;
  }
}

function times(n: number): string {
  return n === 1 ? 'once' : n === 2 ? 'twice' : `${n} times`;
}
