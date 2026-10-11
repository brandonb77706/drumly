import type { GradeResult } from '../grading';
import type { Lesson, LessonCategory } from '../lessons';
import type { LadderChangeKind, LadderSettings } from '../trainer/ladder';

/** One graded pass of a practice or trainer session. */
export interface SessionPass {
  /** Tempo the pass was actually played at. */
  readonly bpm: number;
  /** This pass's grade (a single pass's slice of the live grade). */
  readonly result: GradeResult;
  /** Trainer only: what the ladder did after this pass. */
  readonly change?: LadderChangeKind;
}

/** A finished session, as the coach sees it. */
export interface PracticeSession {
  readonly lesson: Lesson;
  readonly passes: readonly SessionPass[];
  /** Set for trainer sessions. */
  readonly trainer?: {
    readonly settings: LadderSettings;
    /** The ladder reached the target with the required clean passes. */
    readonly learned: boolean;
    /** The ladder's tempo when the session ended. */
    readonly finalBpm: number;
  };
}

export type Tendency = 'rushing' | 'dragging' | 'on time' | 'no data';
export type Trend = 'improving' | 'flat' | 'getting worse';

/** Timing over a set of notes. All ms are whole numbers; negative means early. */
export interface TimingReport {
  /** Mean offset, or null with no matched hits. */
  meanMs: number | null;
  /** Standard deviation of the offsets: lower is steadier. */
  spreadMs: number | null;
  tendency: Tendency;
}

export interface PartReport extends TimingReport {
  /** Percent of notes hit on the right pad, one decimal. */
  accuracy: number | null;
}

export interface PadReport extends PartReport {
  pad: string;
  wrongPad: number;
  missed: number;
}

export interface ProblemSpotReport {
  /** E.g. "Tom 2". */
  pad: string;
  /** E.g. "the 'e' of beat 4 (bar 2)". */
  where: string;
  /** 1-based bar and beat of the note, as counted. */
  bar: number;
  beat: number;
  /** Passes this note was graded in, and how often it was off. */
  passes: number;
  offPasses: number;
  missed: number;
  wrongPad: number;
  early: number;
  late: number;
  /** Mean offset of the matched hits, whole ms. */
  meanMs: number | null;
  /** The pad most often played instead, if any. */
  playedInstead: string | null;
}

/**
 * The compact summary of a session that both coaches work from. Small enough to send to the API
 * as JSON (a few hundred tokens). Hands (left/right) are not known from MIDI, so they never appear.
 */
export interface SessionReport {
  lesson: {
    title: string;
    category: LessonCategory;
    /** The next lesson of the same kind in difficulty order, if any. */
    next: string | null;
  };
  passes: number;
  bpm: { min: number; max: number };
  /** Trainer sessions only. */
  trainer: { startBpm: number; targetBpm: number; finalBpm: number; learned: boolean } | null;
  /** What the accuracy numbers cover: the fill for lessons with one, otherwise the whole lesson. */
  graded: 'fill' | 'whole lesson';
  accuracy: {
    overall: number | null;
    /** Mean accuracy of the first and second half of the passes (the middle pass of an odd count is left out). */
    start: number | null;
    end: number | null;
    trend: Trend;
    perPass: { bpm: number; accuracy: number | null }[];
  };
  /** Every note, all passes. */
  timing: TimingReport;
  /** Lessons with a fill: the fill (focus range) and the groove around it. */
  fill: (PartReport & {
    /** How to count the fill out loud, e.g. "3 e and a". */
    count: string;
    /** E.g. "beats 3 and 4". */
    beats: string;
    /** 1-based bar the fill starts in. */
    bar: number;
    /** The first drum of the fill, e.g. "Snare". */
    firstPad: string;
  }) | null;
  groove: PartReport | null;
  perPad: PadReport[];
  /** Notes that went wrong repeatedly, worst first (at most 3). */
  problemSpots: ProblemSpotReport[];
}

/** What a coach says. The rule-based and the Claude coach both return this shape. */
export interface Coaching {
  headline: string;
  wentWell: string[];
  fixThis: string[];
  nextExercise: string;
}

export type CoachSource = 'claude' | 'rules';

/** Why the Claude coach wasn't used. */
export type FallbackReason = 'no-key' | 'timeout' | 'invalid-response' | 'api-rejected' | 'bad-key' | 'api-error' | 'unreachable';

export interface CoachResponse {
  source: CoachSource;
  coaching: Coaching;
  /** Set when source is 'rules' because the Claude coach was asked for but couldn't answer. */
  reason?: FallbackReason;
  /** The API's own error message, for 'api-rejected' and 'bad-key'. */
  detail?: string;
}
