import type { Hit, Pad } from '../input';

export interface ExpectedNote {
  /** Stable, unique id (used to dedupe notes and to report results). */
  readonly id: string;
  readonly pad: Pad;
  /** ms on the performance.now() clock, same as Hit.time. */
  readonly time: number;
  /** Optional target velocity, for accent checks later. */
  readonly velocity?: number;
}

export type TimingGrade = 'perfect' | 'good' | 'early' | 'late';

export interface TimingThresholds {
  /** |offset| <= perfectMs is perfect. */
  perfectMs: number;
  /** |offset| <= goodMs is good. Beyond that (inside the window) is early or late. */
  goodMs: number;
}

export type MatchedNoteResult = {
  readonly note: ExpectedNote;
  readonly status: 'hit' | 'wrongPad';
  readonly hit: Hit;
  /** hit.time - note.time. Negative = early. */
  readonly offsetMs: number;
  readonly timing: TimingGrade;
};

export type MissedNoteResult = {
  readonly note: ExpectedNote;
  readonly status: 'missed';
};

export type NoteResult = MatchedNoteResult | MissedNoteResult;

export interface ExtraHit {
  readonly hit: Hit;
  readonly status: 'extra';
}

export interface GradeResult {
  /** One result per expected note, in time order. */
  readonly notes: readonly NoteResult[];
  /** Hits that matched no note, in time order. */
  readonly extras: readonly ExtraHit[];
}

/** What a single hit turned into: a matched note result, or an extra. */
export type HitVerdict = MatchedNoteResult | ExtraHit;

export interface GradingConfig {
  /** A hit can match a note only if |offset| <= windowMs. */
  windowMs: number;
  timing: TimingThresholds;
  /**
   * Groups of pads that count as the same pad. Empty by default, so e.g. hihatOpen on a
   * hihatClosed note is a wrong pad. Pass [ANY_HIHAT] for "any hi-hat is fine".
   */
  equivalentPads: readonly (readonly Pad[])[];
}

export const DEFAULT_TIMING_THRESHOLDS: TimingThresholds = { perfectMs: 20, goodMs: 40 };

export const DEFAULT_GRADING_CONFIG: GradingConfig = {
  windowMs: 100,
  timing: DEFAULT_TIMING_THRESHOLDS,
  equivalentPads: [],
};

/** Equivalence presets for lessons that don't care about the exact zone. */
export const ANY_HIHAT: readonly Pad[] = ['hihatClosed', 'hihatOpen'];
export const ANY_SNARE: readonly Pad[] = ['snare', 'snareRim'];

export function resolveConfig(config: Partial<GradingConfig> = {}): GradingConfig {
  return {
    windowMs: config.windowMs ?? DEFAULT_GRADING_CONFIG.windowMs,
    timing: { ...DEFAULT_TIMING_THRESHOLDS, ...config.timing },
    equivalentPads: config.equivalentPads ?? DEFAULT_GRADING_CONFIG.equivalentPads,
  };
}
