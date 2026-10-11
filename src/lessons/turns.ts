import type { ExpectedNote } from '../grading';
import { notePass } from './expected';
import type { Lesson, LessonNote } from './types';

/**
 * The section of a lesson that "Listen, then play" repeats: the whole bars that hold the focus
 * range (e.g. bars 2 and 3 of a fill lesson: the lead-in, the fill and its landing), or the whole
 * lesson if there is no focus. Bars are renumbered from 0; the focus moves with them, and
 * `section` remembers where they came from, so labels keep the full lesson's bar numbers. Whole
 * bars keep every turn on the metronome's bar grid, so turns are back-to-back sections of one timeline.
 */
export function sectionLesson(lesson: Lesson): Lesson {
  const focus = lesson.focus;
  if (!focus) return lesson;
  return barsLesson(lesson, focus.start.bar, focus.end.bar);
}

/**
 * Bars `first` to `last` (0-based, inclusive) of a lesson as a lesson of their own, e.g. a song's
 * A-B loop. Bars are renumbered from 0 and `section` records the original numbering (it stacks:
 * a section of a section still points at the full lesson). The focus is kept if it lies inside
 * the bars, otherwise dropped (the whole section is graded). The whole lesson comes back unchanged.
 */
export function barsLesson(lesson: Lesson, first: number, last: number): Lesson {
  if (!Number.isInteger(first) || !Number.isInteger(last) || first < 0 || last >= lesson.bars || first > last) {
    throw new RangeError(`Bars ${first + 1} to ${last + 1} are outside "${lesson.title}" (${lesson.bars} bars).`);
  }
  if (first === 0 && last === lesson.bars - 1) return lesson;
  const shift = <T extends { bar: number }>(p: T): T => ({ ...p, bar: p.bar - first });
  const notes: LessonNote[] = lesson.notes.filter((n) => n.bar >= first && n.bar <= last).map(shift);
  const focus = lesson.focus;
  const keepFocus = focus !== undefined && focus.start.bar >= first && focus.end.bar <= last;
  const { focus: _dropped, ...rest } = lesson;
  return {
    ...rest,
    bars: last - first + 1,
    notes,
    ...(keepFocus ? { focus: { start: shift(focus.start), end: shift(focus.end) } } : {}),
    section: {
      firstBar: (lesson.section?.firstBar ?? 0) + first,
      totalBars: lesson.section?.totalBars ?? lesson.bars,
    },
  };
}

export type TurnKind = 'listen' | 'play';

/**
 * Which passes of a looping run the player plays and which are graded. In "Listen, then play"
 * the passes alternate: even passes are the app's turn (drums play, nothing is graded), odd
 * passes are the player's turn. Both are consecutive sections of the same click timeline.
 */
export interface TurnPlan {
  readonly listen: boolean;
  /** Bars in one full cycle: one pass, or a listen turn plus a player turn. */
  readonly cycleBars: number;
  turn(pass: number): TurnKind;
  isGraded(pass: number): boolean;
  /** The first graded pass. */
  readonly firstGraded: number;
  /** The graded pass after `pass`. */
  nextGraded(pass: number): number;
  /** 1-based number of a graded pass among graded passes ("Pass 2" is the player's 2nd turn). */
  gradedNumber(pass: number): number;
  /**
   * The bar to apply a tempo change at: the first cycle start whose downbeat isn't scheduled yet.
   * In listen mode that's a listen turn, so the player hears the new tempo before playing it.
   */
  changeBar(nextUnscheduledBar: number): number;
}

export function turnPlan(lessonBars: number, listen: boolean): TurnPlan {
  const step = listen ? 2 : 1;
  const cycleBars = lessonBars * step;
  const turn = (pass: number): TurnKind => (listen && pass % 2 === 0 ? 'listen' : 'play');
  return {
    listen,
    cycleBars,
    turn,
    isGraded: (pass) => turn(pass) === 'play',
    firstGraded: listen ? 1 : 0,
    nextGraded: (pass) => pass + step,
    gradedNumber: (pass) => (listen ? (pass + 1) / 2 : pass + 1),
    changeBar: (bar) => Math.ceil(bar / cycleBars) * cycleBars,
  };
}

/** Wrap a note source so only graded passes' notes reach the grader. */
export function gradedNotesOnly(
  source: (fromTime: number, toTime: number) => ExpectedNote[],
  plan: TurnPlan,
): (fromTime: number, toTime: number) => ExpectedNote[] {
  if (!plan.listen) return source;
  return (from, to) => source(from, to).filter((n) => plan.isGraded(notePass(n.id) ?? 0));
}

/** Quiet level of the guide drums under the player's own playing. */
export const GUIDE_GAIN = 0.3;

/**
 * Drum level for each pass: full on the app's turns, the guide level on the player's turns if the
 * guide is on, otherwise silent. Reads `guide()` each time, so the toggle works mid-run.
 */
export function drumGainForPass(plan: TurnPlan, guide: () => boolean): (pass: number) => number {
  return (pass) => (plan.turn(pass) === 'listen' ? 1 : guide() ? GUIDE_GAIN : 0);
}
