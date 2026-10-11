import { LessonParseError, parseLessonText, type Lesson, type LessonFocus } from '../lessons';
import { clicksPerBeat } from '../metronome/timing';
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
  /** The focus range picked on the review screen (fills only). Default: what the import suggests. */
  readonly focus?: LessonFocus;
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
    ...(kind === 'fill'
      ? { focus: draft.focus ? clampFocus(draft.focus, { bars, beatsPerBar: draft.beatsPerBar, subdivision: draft.subdivision }) : suggestedFocus(bars, landing, draft) }
      : {}),
  };
  return { data, lesson: customLesson(data) };
}

function suggestedFocus(bars: number, landing: boolean, grid: { beatsPerBar: number; subdivision: RecordSubdivision }): LessonFocus {
  return landing ? landingFocus(bars) : wholeFocus(bars, grid.beatsPerBar, grid.subdivision);
}

export interface FocusGrid {
  readonly bars: number;
  readonly beatsPerBar: number;
  readonly subdivision: RecordSubdivision;
}

/** The focus range on the review's pickers: 1-based bars and beats, start and end inclusive. */
export interface FocusPick {
  readonly fromBar: number;
  readonly fromBeat: number;
  readonly toBar: number;
  readonly toBeat: number;
}

/** What the pickers show for a focus range. */
export function pickFromFocus(focus: LessonFocus): FocusPick {
  return { fromBar: focus.start.bar + 1, fromBeat: focus.start.beat + 1, toBar: focus.end.bar + 1, toBeat: focus.end.beat + 1 };
}

/**
 * The focus range for the pickers: from the start of the "from" beat to the end of the "to" beat
 * (its last step). Values are clamped into the grid. If the range is backwards, the end that wasn't
 * just edited moves along (like the song loop pickers), so the edit the player made always sticks.
 */
export function focusFromPick(pick: FocusPick, grid: FocusGrid, edited: 'from' | 'to'): LessonFocus {
  const bar = (v: number) => clampInt(v, 1, grid.bars) - 1;
  const beat = (v: number) => clampInt(v, 1, grid.beatsPerBar) - 1;
  let start = { bar: bar(pick.fromBar), beat: beat(pick.fromBeat) };
  let end = { bar: bar(pick.toBar), beat: beat(pick.toBeat) };
  if (start.bar * grid.beatsPerBar + start.beat > end.bar * grid.beatsPerBar + end.beat) {
    if (edited === 'from') end = start;
    else start = end;
  }
  return { start: { ...start, subdivision: 0 }, end: { ...end, subdivision: clicksPerBeat(grid.subdivision) - 1 } };
}

/** A stored or picked focus squeezed into the grid (the text may have lost bars since it was picked). */
export function clampFocus(focus: LessonFocus, grid: FocusGrid): LessonFocus {
  const perBeat = clicksPerBeat(grid.subdivision);
  const total = grid.bars * grid.beatsPerBar * perBeat;
  const toStep = (p: LessonFocus['start']) => clampInt((p.bar * grid.beatsPerBar + p.beat) * perBeat + p.subdivision, 0, total - 1);
  const fromStep = (step: number) => ({
    bar: Math.floor(step / (grid.beatsPerBar * perBeat)),
    beat: Math.floor(step / perBeat) % grid.beatsPerBar,
    subdivision: step % perBeat,
  });
  const a = toStep(focus.start);
  const b = toStep(focus.end);
  return { start: fromStep(Math.min(a, b)), end: fromStep(Math.max(a, b)) };
}

function clampInt(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(Number.isFinite(v) ? v : min)));
}
