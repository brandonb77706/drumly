import { LessonParseError, parseLessonText, type Lesson } from '../lessons';
import { customLesson, kindForBars, landingFocus, wholeFocus, type CustomLessonData, type CustomOrigin } from '../record/customLessons';
import type { RecordSubdivision } from '../record/quantize';

export type ImportConfidence = 'high' | 'medium' | 'low';

/**
 * What any import (a recording, a notation image, a MIDI file) produces before review: lesson
 * text plus suggested settings. Nothing becomes a lesson until the player presses Save.
 */
export interface ImportDraft {
  readonly origin: CustomOrigin;
  readonly title: string;
  readonly bpm: number;
  readonly beatsPerBar: number;
  readonly subdivision: RecordSubdivision;
  readonly text: string;
  /** The last bar of the text holds only the landing (beat 1 after the imported bars). */
  readonly landing: boolean;
  /** Image imports: how sure Claude was, and what to check against the image. */
  readonly confidence?: ImportConfidence;
  readonly uncertain?: string;
  /** Anything else to check (a tempo change, unmapped MIDI notes...). */
  readonly warnings: readonly string[];
}

/** Draft settings that can be edited on the review screen. */
export type DraftEdits = Partial<Pick<ImportDraft, 'title' | 'bpm' | 'beatsPerBar' | 'subdivision' | 'text'>>;

/** The draft as lesson data and a lesson, or a LessonParseError saying what to fix (with line numbers). */
export function draftToLesson(draft: ImportDraft, id: string): { data: CustomLessonData; lesson: Lesson } {
  if (!(draft.bpm >= 30 && draft.bpm <= 300)) throw new LessonParseError('BPM must be between 30 and 300.');
  if (!Number.isInteger(draft.beatsPerBar) || draft.beatsPerBar < 1 || draft.beatsPerBar > 16) throw new LessonParseError('Beats per bar must be a whole number from 1 to 16.');
  const { notes, bars } = parseLessonText(draft.text, { beatsPerBar: draft.beatsPerBar, subdivision: draft.subdivision });
  if (notes.length === 0) throw new LessonParseError('The text has no notes.');
  // A landing bar only makes sense after at least one bar of the fill.
  const landing = draft.landing && bars >= 2;
  const kind = kindForBars(landing ? bars - 1 : bars);
  const data: CustomLessonData = {
    id,
    title: draft.title.trim() || 'Untitled',
    bpm: draft.bpm,
    bars,
    beatsPerBar: draft.beatsPerBar,
    subdivision: draft.subdivision,
    text: draft.text,
    kind,
    origin: draft.origin,
    ...(kind === 'fill' ? { focus: landing ? landingFocus(bars) : wholeFocus(bars, draft.beatsPerBar, draft.subdivision) } : {}),
  };
  return { data, lesson: customLesson(data) };
}
