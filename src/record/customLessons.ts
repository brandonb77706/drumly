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

/** The parts of Storage the legacy reader uses. */
export type StorageLike = Pick<Storage, 'getItem' | 'setItem'> & Partial<Pick<Storage, 'removeItem'>>;

/** Where custom lessons are persisted (IndexedDB, see HistoryStore). Each call resolves to false if it wasn't saved. */
export interface LessonBackend {
  put(data: CustomLessonData): Promise<boolean>;
  delete(id: string): Promise<boolean>;
}

/**
 * Custom lessons. The list lives in memory, so reading it is instant and synchronous; changes are
 * written through to the backend, and `persisted` says whether that worked. Without a backend (or
 * when it fails) the lessons last for this page session.
 */
export class CustomLessonStore {
  private items: CustomLessonData[];

  constructor(items: readonly CustomLessonData[] = [], private readonly backend: LessonBackend | null = null) {
    this.items = items.filter(isCustomLessonData);
  }

  /** Every stored lesson that still parses, oldest first. */
  list(): Lesson[] {
    const out: Lesson[] = [];
    for (const data of this.items) {
      try {
        out.push(customLesson(data));
      } catch {
        // A damaged entry is skipped, not fatal.
      }
    }
    return out;
  }

  /** The raw entries, for a history export. */
  data(): CustomLessonData[] {
    return [...this.items];
  }

  /**
   * Save (or replace, by id). The lesson is validated first, synchronously: a bad text throws and
   * nothing is stored.
   */
  save(data: CustomLessonData): Promise<{ lesson: Lesson; persisted: boolean }> {
    const lesson = customLesson(data);
    this.items = [...this.items.filter((d) => d.id !== data.id), data];
    return this.write((b) => b.put(data)).then((persisted) => ({ lesson, persisted }));
  }

  /** Add or replace entries in memory only (they were already written, e.g. by a history import). */
  merge(items: readonly CustomLessonData[]): void {
    const incoming = items.filter(isCustomLessonData);
    const ids = new Set(incoming.map((d) => d.id));
    this.items = [...this.items.filter((d) => !ids.has(d.id)), ...incoming];
  }

  async remove(id: string): Promise<{ removed: boolean; persisted: boolean }> {
    const kept = this.items.filter((d) => d.id !== id);
    if (kept.length === this.items.length) return { removed: false, persisted: true };
    this.items = kept;
    return { removed: true, persisted: await this.write((b) => b.delete(id)) };
  }

  /** A fresh id that no stored lesson uses. */
  newId(now = Date.now()): string {
    const used = new Set(this.items.map((d) => d.id));
    let n = now;
    while (used.has(`${CUSTOM_ID_PREFIX}${n.toString(36)}`)) n++;
    return `${CUSTOM_ID_PREFIX}${n.toString(36)}`;
  }

  private async write(op: (backend: LessonBackend) => Promise<boolean>): Promise<boolean> {
    if (!this.backend) return false;
    try {
      return await op(this.backend);
    } catch {
      return false;
    }
  }
}

/**
 * Lessons saved by earlier versions in localStorage (before they moved to IndexedDB). `found` is
 * true if the key exists at all. Damaged entries and junk are skipped; blocked storage reads as empty.
 */
export function readLegacyLessons(storage: () => StorageLike | null, key = CUSTOM_LESSONS_KEY): { items: CustomLessonData[]; found: boolean } {
  let raw: string | null = null;
  try {
    raw = storage()?.getItem(key) ?? null;
  } catch {
    raw = null;
  }
  if (raw === null) return { items: [], found: false };
  let parsed: unknown = [];
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = [];
  }
  return { items: Array.isArray(parsed) ? parsed.filter(isCustomLessonData) : [], found: true };
}

/** Remove the old localStorage key. False if storage is blocked. */
export function removeLegacyLessons(storage: () => StorageLike | null, key = CUSTOM_LESSONS_KEY): boolean {
  try {
    const s = storage();
    if (!s?.removeItem) return false;
    s.removeItem(key);
    return true;
  } catch {
    return false;
  }
}

export function isCustomLessonData(v: unknown): v is CustomLessonData {
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
