import { lessonFromText, type Lesson, type LessonFocus } from '../lessons';
import { clicksPerBeat } from '../metronome/timing';
import type { RecordSubdivision } from './quantize';

/** Where a custom lesson came from (for its description). */
export type CustomOrigin = 'recorded' | 'image' | 'midi';

/** What gets stored for a recorded or imported lesson. The notes live in `text`, the same format the player edits. */
export interface CustomLessonData {
  readonly id: string;
  readonly title: string;
  readonly bpm: number;
  /** Every bar of the text, the landing bar included. */
  readonly bars: number;
  readonly beatsPerBar: number;
  readonly subdivision: RecordSubdivision;
  readonly text: string;
  /** Default 'fill'. Imports longer than MAX_FILL_BARS are songs. */
  readonly kind?: 'fill' | 'song';
  /** Default: every bar. A recorded fill's focus ends on its landing. */
  readonly focus?: LessonFocus;
  /** Default 'recorded'. */
  readonly origin?: CustomOrigin;
}

/** Imports longer than this many bars (not counting a landing bar) are saved as songs. */
export const MAX_FILL_BARS = 4;

/** Fill or song for an import of `bars` bars (not counting a landing bar). */
export function kindForBars(bars: number): 'fill' | 'song' {
  return bars > MAX_FILL_BARS ? 'song' : 'fill';
}

/** Focus from the first step to the landing: beat 1 of the last bar (the bar holding only the landing). */
export function landingFocus(bars: number): LessonFocus {
  return { start: { bar: 0, beat: 0, subdivision: 0 }, end: { bar: bars - 1, beat: 0, subdivision: 0 } };
}

/** Focus over every step of every bar. */
export function wholeFocus(bars: number, beatsPerBar: number, subdivision: RecordSubdivision): LessonFocus {
  return {
    start: { bar: 0, beat: 0, subdivision: 0 },
    end: { bar: bars - 1, beat: beatsPerBar - 1, subdivision: clicksPerBeat(subdivision) - 1 },
  };
}

export const CUSTOM_ID_PREFIX = 'my-';
export const CUSTOM_LESSONS_KEY = 'drumly.customLessons';

export function isCustomLesson(lesson: Pick<Lesson, 'id'>): boolean {
  return lesson.id.startsWith(CUSTOM_ID_PREFIX);
}

/**
 * A custom lesson: category "fill" or "song". A fill's focus is the stored one (a recorded fill's
 * ends on its landing), or every bar for entries saved before focus was stored. A song has no
 * focus: everything is graded, and section looping picks the bars.
 * Throws LessonParseError if the text doesn't fit the grid.
 */
export function customLesson(data: CustomLessonData): Lesson {
  const kind = data.kind ?? 'fill';
  const grid = data.subdivision === 'triplet' ? 'triplets' : '16ths';
  const bars = `${data.bars} bar${data.bars === 1 ? '' : 's'}`;
  const description =
    kind === 'song'
      ? `Your imported song, at ${data.bpm} BPM. Pick bars to loop below.`
      : data.origin === 'image' || data.origin === 'midi'
        ? `Your imported fill (from ${data.origin === 'image' ? 'an image' : 'a MIDI file'}): ${bars} of ${grid} at ${data.bpm} BPM.`
        : `Your recorded fill: ${bars} of ${grid}, recorded at ${data.bpm} BPM.`;
  return lessonFromText({
    id: data.id,
    title: data.title,
    category: kind,
    description,
    defaultBpm: data.bpm,
    beatsPerBar: data.beatsPerBar,
    subdivision: data.subdivision,
    bars: data.bars,
    text: data.text,
    ...(kind === 'fill' ? { focus: data.focus ?? wholeFocus(data.bars, data.beatsPerBar, data.subdivision) } : {}),
  });
}

/** The parts of Storage the store uses. */
export type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

/**
 * Custom lessons in localStorage. Every storage access is wrapped: if storage is blocked (private
 * mode, disabled site data) or throws, the store keeps working in memory for this page session,
 * and `persisted` says the change wasn't saved.
 */
export class CustomLessonStore {
  private items: CustomLessonData[] | null = null;

  constructor(
    /** A getter, because merely reading `window.localStorage` can throw when it's blocked. */
    private readonly storage: () => StorageLike | null,
    private readonly key = CUSTOM_LESSONS_KEY,
  ) {}

  /** Every stored lesson that still parses, oldest first. */
  list(): Lesson[] {
    const out: Lesson[] = [];
    for (const data of this.load()) {
      try {
        out.push(customLesson(data));
      } catch {
        // A damaged entry is skipped, not fatal.
      }
    }
    return out;
  }

  /** Save (or replace, by id). The lesson is validated first, so a bad text throws and nothing is stored. */
  save(data: CustomLessonData): { lesson: Lesson; persisted: boolean } {
    const lesson = customLesson(data);
    const items = this.load().filter((d) => d.id !== data.id);
    items.push(data);
    this.items = items;
    return { lesson, persisted: this.write(items) };
  }

  /** Returns false if there was no such lesson. */
  remove(id: string): { removed: boolean; persisted: boolean } {
    const items = this.load();
    const kept = items.filter((d) => d.id !== id);
    if (kept.length === items.length) return { removed: false, persisted: true };
    this.items = kept;
    return { removed: true, persisted: this.write(kept) };
  }

  /** A fresh id that no stored lesson uses. */
  newId(now = Date.now()): string {
    const used = new Set(this.load().map((d) => d.id));
    let n = now;
    while (used.has(`${CUSTOM_ID_PREFIX}${n.toString(36)}`)) n++;
    return `${CUSTOM_ID_PREFIX}${n.toString(36)}`;
  }

  private load(): CustomLessonData[] {
    if (this.items) return this.items;
    let raw: string | null = null;
    try {
      raw = this.storage()?.getItem(this.key) ?? null;
    } catch {
      raw = null;
    }
    let parsed: unknown = [];
    try {
      parsed = raw ? JSON.parse(raw) : [];
    } catch {
      parsed = [];
    }
    this.items = Array.isArray(parsed) ? parsed.filter(isCustomLessonData) : [];
    return this.items;
  }

  private write(items: readonly CustomLessonData[]): boolean {
    try {
      const storage = this.storage();
      if (!storage) return false;
      storage.setItem(this.key, JSON.stringify(items));
      return true;
    } catch {
      return false;
    }
  }
}

function isCustomLessonData(v: unknown): v is CustomLessonData {
  if (typeof v !== 'object' || v === null) return false;
  const d = v as Record<string, unknown>;
  return (
    typeof d.id === 'string' && d.id.startsWith(CUSTOM_ID_PREFIX) &&
    typeof d.title === 'string' &&
    typeof d.bpm === 'number' && Number.isFinite(d.bpm) &&
    typeof d.bars === 'number' && Number.isInteger(d.bars) && d.bars >= 1 &&
    typeof d.beatsPerBar === 'number' && Number.isInteger(d.beatsPerBar) &&
    (d.subdivision === 'sixteenth' || d.subdivision === 'triplet') &&
    typeof d.text === 'string' &&
    (d.kind === undefined || d.kind === 'fill' || d.kind === 'song') &&
    (d.origin === undefined || d.origin === 'recorded' || d.origin === 'image' || d.origin === 'midi') &&
    (d.focus === undefined || isFocus(d.focus))
  );
}

function isFocus(v: unknown): boolean {
  if (typeof v !== 'object' || v === null) return false;
  const f = v as Record<string, unknown>;
  const isPos = (p: unknown) => {
    if (typeof p !== 'object' || p === null) return false;
    const o = p as Record<string, unknown>;
    return [o.bar, o.beat, o.subdivision].every((n) => typeof n === 'number' && Number.isInteger(n));
  };
  return isPos(f.start) && isPos(f.end);
}
