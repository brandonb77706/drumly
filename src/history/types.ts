import type { CoachResponse, SessionReport } from '../coach/types';
import type { Pad } from '../input';
import type { LessonCategory, LessonFocus } from '../lessons';
import type { Subdivision } from '../metronome/timing';

/**
 * Version of the stored shapes (session records, the export file). Bump it when a stored shape
 * changes, and teach `migrateSession` (and the IndexedDB upgrade) how to read the old one.
 */
export const SCHEMA_VERSION = 1;

/** How the session was played. "practice" is Start with or without Loop. */
export type SessionMode = 'practice' | 'trainer' | 'listen' | 'record';

/** Where the session's hits came from (the most common source), or 'none' with no hits. */
export type SessionSource = 'keyboard' | 'midi' | 'test' | 'none';

/** One graded pass, compact: numbers only, no hits. */
export interface PassRecord {
  /** Tempo the pass was played at, one decimal. */
  readonly bpm: number;
  /** The headline: accuracy on the focus range (the fill), or the whole lesson without one. Percent, one decimal. */
  readonly focusAccuracy: number | null;
  /** Accuracy over every note of the pass, groove included. */
  readonly accuracy: number | null;
  /** Mean offset and spread (std dev) of the matched hits, whole ms; negative is early. */
  readonly meanMs: number | null;
  readonly spreadMs: number | null;
  readonly counts: {
    readonly expected: number;
    readonly hit: number;
    readonly wrongPad: number;
    readonly missed: number;
    readonly extra: number;
    readonly perfect: number;
    readonly good: number;
    readonly early: number;
    readonly late: number;
  };
  /** Clean by the ladder (the trainer's threshold, or the default one outside the trainer). */
  readonly clean: boolean;
}

/** A hit of the best pass, in ms from the pass's first downbeat (negative: before it). */
export interface StoredHit {
  readonly pad: Pad;
  readonly velocity: number;
  readonly t: number;
}

/**
 * The bars that were played (a whole lesson, a song's loop, a listen section), as lesson text, so
 * the best pass can be replayed even after a custom lesson is deleted.
 */
export interface LessonSnapshot {
  readonly title: string;
  readonly beatsPerBar: number;
  readonly subdivision: Subdivision;
  readonly bars: number;
  readonly text: string;
  readonly focus: LessonFocus | null;
  readonly equivalentPads: readonly (readonly Pad[])[] | null;
  /** Where these bars sit in the full lesson (0-based first bar), or null for the whole lesson. */
  readonly section: { readonly firstBar: number; readonly totalBars: number } | null;
}

/** The session's best pass with every hit as played, for Compare. */
export interface BestPassRecord {
  /** Index into SessionRecord.passes. */
  readonly pass: number;
  /** Exact tempo played (not rounded), and the pass length in ms. */
  readonly bpm: number;
  readonly lengthMs: number;
  readonly lesson: LessonSnapshot;
  readonly hits: readonly StoredHit[];
}

/** One finished session, as saved. Plain JSON: no undefined fields, so an export round-trips exactly. */
export interface SessionRecord {
  readonly schemaVersion: number;
  readonly id: string;
  /** Wall-clock ms (Date.now()). */
  readonly startedAt: number;
  readonly endedAt: number;
  /** Time spent playing, from the first downbeat to the end, ms. */
  readonly playMs: number;
  readonly lessonId: string;
  /** Copied, since custom lessons can be deleted. */
  readonly lessonTitle: string;
  readonly category: LessonCategory;
  /** The lesson's default tempo when played (personal bests for accuracy need at least this). */
  readonly defaultBpm: number;
  readonly mode: SessionMode;
  readonly source: SessionSource;
  readonly passes: readonly PassRecord[];
  readonly trainer: {
    readonly startBpm: number;
    readonly targetBpm: number;
    /** Highest tempo with a clean pass in this session, or null. */
    readonly highestCleanBpm: number | null;
    readonly learned: boolean;
  } | null;
  /** The step 7 session report, and the coaching that was shown for it. */
  readonly report: SessionReport | null;
  readonly coaching: CoachResponse | null;
  readonly bestPass: BestPassRecord | null;
}

/**
 * App settings: remembered in this browser between page loads (history/settings.ts) and carried
 * in a history export. Every field is optional; a missing one keeps the app's default.
 */
export interface HistorySettings {
  readonly clickMode?: string;
  readonly hitSounds?: string;
  /** 0-100. */
  readonly drumsVolume?: number;
  /** 0-100. */
  readonly clickVolume?: number;
  readonly guideDrums?: boolean;
  readonly coachSpeak?: boolean;
  /** Practice speed, a fraction of the lesson's default BPM (e.g. 0.75). */
  readonly speed?: number;
  /** The lesson picked last. */
  readonly lessonId?: string;
  readonly loop?: boolean;
  readonly trainer?: boolean;
  readonly listen?: boolean;
  /** Trainer ladder settings that don't depend on the lesson (start and target BPM do). */
  readonly trainerStepBpm?: number;
  readonly trainerPassThreshold?: number;
  readonly trainerPassesNeeded?: number;
  /** Which tab was open, and the lesson whose Progress detail was open (null: the lesson list). */
  readonly tab?: 'practice' | 'progress';
  readonly progressLesson?: string | null;
}
