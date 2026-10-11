import type { GradeResult } from '../grading';
import { clicksPerBeat } from '../metronome/timing';
import { noteIndex, notePass } from './expected';
import type { Lesson, LessonPosition } from './types';

/** Step number of a position within the lesson (0 = bar 0, beat 0, step 0). */
export function positionStep(p: LessonPosition, lesson: Pick<Lesson, 'beatsPerBar' | 'subdivision'>): number {
  const perBeat = clicksPerBeat(lesson.subdivision);
  return (p.bar * lesson.beatsPerBar + p.beat) * perBeat + p.subdivision;
}

/** True if the position is inside the lesson's focus range (inclusive). Without a focus, everything is. */
export function isInFocus(p: LessonPosition, lesson: Lesson): boolean {
  if (!lesson.focus) return true;
  const step = positionStep(p, lesson);
  return step >= positionStep(lesson.focus.start, lesson) && step <= positionStep(lesson.focus.end, lesson);
}

/** Indices into lesson.notes of the notes inside the focus range. */
export function focusNoteIndices(lesson: Lesson): ReadonlySet<number> {
  const out = new Set<number>();
  lesson.notes.forEach((n, i) => {
    if (isInFocus(n, lesson)) out.add(i);
  });
  return out;
}

/**
 * The part of a grade inside the focus range: notes whose lesson position is in focus, plus
 * extra hits that land within `windowMs` of a pass's focus notes (an extra hit during the
 * groove doesn't count against the fill). Without a focus, returns the result unchanged.
 */
export function focusResult(result: GradeResult, lesson: Lesson, windowMs: number): GradeResult {
  if (!lesson.focus) return result;
  const inFocus = focusNoteIndices(lesson);
  const notes = result.notes.filter((r) => {
    const index = noteIndex(r.note.id);
    return index !== null && inFocus.has(index);
  });

  // Time span of the focus notes, per pass.
  const spans = new Map<number, { from: number; to: number }>();
  for (const r of notes) {
    const pass = notePass(r.note.id) ?? 0;
    const span = spans.get(pass);
    if (span) {
      span.from = Math.min(span.from, r.note.time);
      span.to = Math.max(span.to, r.note.time);
    } else spans.set(pass, { from: r.note.time, to: r.note.time });
  }
  const ranges = [...spans.values()];
  const extras = result.extras.filter((e) => ranges.some((s) => e.hit.time >= s.from - windowMs && e.hit.time <= s.to + windowMs));
  return { notes, extras };
}
