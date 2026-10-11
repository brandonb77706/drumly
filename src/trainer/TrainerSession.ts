import { DEFAULT_GRADING_CONFIG, summarize, type GradeResult, type GradeSummary } from '../grading';
import { focusResult, type Lesson } from '../lessons';
import { initialLadderState, ladderProgress, nextLadderState, type LadderChangeKind, type LadderSettings, type LadderState } from './ladder';
import { ProblemTracker } from './problems';

/** Tempo a pass was played at, from its first downbeat and the next pass's (ms). */
export function passBpm(lesson: Pick<Lesson, 'bars' | 'beatsPerBar'>, passStart: number, nextPassStart: number): number {
  return (lesson.bars * lesson.beatsPerBar * 60_000) / (nextPassStart - passStart);
}

export interface TrainerPassReport {
  pass: number;
  /** Tempo the pass was actually played at. */
  bpm: number;
  /** Headline: notes in the focus range only. */
  focus: GradeSummary;
  /** Every note of the pass. */
  full: GradeSummary;
  /** False if the pass was played at a tempo other than the ladder's current one (see recordPass). */
  counted: boolean;
  change: LadderChangeKind;
  message: string;
  /** The ladder after this pass. */
  state: LadderState;
}

/**
 * One trainer session: the ladder plus problem-spot tracking. Pure: the caller feeds each
 * pass's grade and applies the BPM the ladder asks for at the next pass boundary.
 */
export class TrainerSession {
  state: LadderState;
  readonly problems: ProblemTracker;
  readonly reports: TrainerPassReport[] = [];

  constructor(
    readonly lesson: Lesson,
    readonly settings: LadderSettings,
    private readonly windowMs = DEFAULT_GRADING_CONFIG.windowMs,
  ) {
    this.state = initialLadderState(settings);
    this.problems = new ProblemTracker(lesson);
  }

  get bpm(): number {
    return this.state.bpm;
  }

  get done(): boolean {
    return this.state.done;
  }

  progress(): string {
    return ladderProgress(this.state, this.settings);
  }

  /**
   * Record one pass (a single pass's slice of the grade). Problem spots always count it. The
   * ladder only judges it if it was played at the ladder's current BPM: a tempo change that
   * couldn't be applied in time for the very next pass leaves that pass at the old tempo, and
   * it must not count toward the new rung.
   */
  recordPass(pass: number, result: GradeResult, playedBpm: number): TrainerPassReport {
    const focus = summarize(focusResult(result, this.lesson, this.windowMs));
    const full = summarize(result);
    this.problems.recordPass(result.notes);

    const counted = Math.abs(playedBpm - this.state.bpm) < 0.5 && !this.state.done;
    let change: LadderChangeKind = 'none';
    let message: string;
    if (counted) {
      const step = nextLadderState(this.state, { accuracy: focus.accuracy }, this.settings);
      this.state = step.state;
      change = step.change;
      message = step.message;
    } else {
      message = `Played at ${Number(playedBpm.toFixed(1))} BPM before the tempo change; not counted.`;
    }
    const report: TrainerPassReport = { pass, bpm: playedBpm, focus, full, counted, change, message, state: this.state };
    this.reports.push(report);
    return report;
  }
}
