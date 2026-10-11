import { FILL_LESSONS } from './fills';
import { STARTER_LESSONS } from './starters';
import type { Lesson } from './types';

export * from './types';
export { parseLessonText, lessonFromText, formatLessonText, LessonParseError, PAD_ALIASES } from './parse';
export type { LessonGrid, LessonSpec } from './parse';
export { lessonToExpectedNotes, lessonNoteSource, noteId, noteIndex, notePass, resultForPass, NOTE_FETCH_OVERLAP_MS } from './expected';
export { positionStep, isInFocus, focusNoteIndices, focusResult } from './focus';
export { positionLabel, countSyllable } from './position';
export type { LessonTiming } from './expected';
export { STARTER_LESSONS } from './starters';
export { FILL_LESSONS } from './fills';
export { SPEED_OPTIONS, lessonBpmAt } from './tempo';
export type { Speed } from './tempo';
export { sectionLesson, turnPlan, gradedNotesOnly, drumGainForPass, GUIDE_GAIN } from './turns';
export type { TurnPlan, TurnKind } from './turns';

/** Every built-in lesson: beats first, then fills. */
export const ALL_LESSONS: readonly Lesson[] = [...STARTER_LESSONS, ...FILL_LESSONS];
