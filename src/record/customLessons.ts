import { lessonFromText, type Lesson } from '../lessons';
import { clicksPerBeat } from '../metronome/timing';
import type { RecordSubdivision } from './quantize';

/** What gets stored for a recorded fill. The notes live in `text`, the same format the player edits. */
export interface CustomLessonData {
  readonly id: string;
  readonly title: string;
  readonly bpm: number;
  readonly bars: number;
  readonly beatsPerBar: number;
  readonly subdivision: RecordSubdivision;
  readonly text: string;
}

export const CUSTOM_ID_PREFIX = 'my-';
export const CUSTOM_LESSONS_KEY = 'drumly.customLessons';

export function isCustomLesson(lesson: Pick<Lesson, 'id'>): boolean {
  return lesson.id.startsWith(CUSTOM_ID_PREFIX);
}

/**
 * A custom fill as a lesson: category "fill", with the focus range covering every recorded bar.
 * Throws LessonParseError if the text doesn't fit the grid.
 */
export function customLesson(data: CustomLessonData): Lesson {
  const perBeat = clicksPerBeat(data.subdivision);
  return lessonFromText({
    id: data.id,
    title: data.title,
    category: 'fill',
    description: `Your recorded fill: ${data.bars} bar${data.bars === 1 ? '' : 's'} of ${data.subdivision === 'triplet' ? 'triplets' : '16ths'}, recorded at ${data.bpm} BPM.`,
    defaultBpm: data.bpm,
    beatsPerBar: data.beatsPerBar,
    subdivision: data.subdivision,
    bars: data.bars,
    text: data.text,
    focus: {
      start: { bar: 0, beat: 0, subdivision: 0 },
      end: { bar: data.bars - 1, beat: data.beatsPerBar - 1, subdivision: perBeat - 1 },
    },
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
    typeof d.text === 'string'
  );
}
