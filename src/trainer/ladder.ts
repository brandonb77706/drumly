/**
 * The tempo ladder: start slow, loop, and only speed up once the fill is clean. Pure logic;
 * the caller applies BPM changes at the next pass boundary.
 */

export interface LadderSettings {
  startBpm: number;
  targetBpm: number;
  /** BPM added on each speed-up and removed on each slow-down. */
  stepBpm: number;
  /** Accuracy (%) a pass needs to count as clean. */
  passThreshold: number;
  /** Clean passes in a row needed to speed up (or, at the target, to finish). */
  passesNeeded: number;
}

/** A pass below this accuracy (%) counts as bad. */
export const SLOW_DOWN_BELOW = 70;
/** Bad passes in a row that trigger a slow-down. */
export const SLOW_DOWN_AFTER = 2;

export function defaultLadderSettings(lesson: { defaultBpm: number }): LadderSettings {
  return {
    startBpm: Math.round(lesson.defaultBpm * 0.6),
    targetBpm: lesson.defaultBpm,
    stepBpm: 5,
    passThreshold: 90,
    passesNeeded: 2,
  };
}

export interface LadderState {
  bpm: number;
  /** Clean passes in a row at the current BPM. */
  cleanStreak: number;
  /** Bad (< SLOW_DOWN_BELOW) passes in a row at the current BPM. */
  badStreak: number;
  /** Passes judged so far. */
  passes: number;
  /** The target was reached with the required clean passes. */
  done: boolean;
}

export type LadderChangeKind = 'none' | 'speedUp' | 'slowDown' | 'finished';

export interface LadderStep {
  state: LadderState;
  change: LadderChangeKind;
  /** Short message for the player about this pass. */
  message: string;
}

export function initialLadderState(settings: LadderSettings): LadderState {
  return { bpm: Math.min(settings.startBpm, settings.targetBpm), cleanStreak: 0, badStreak: 0, passes: 0, done: false };
}

/**
 * Judge one pass. Clean (>= passThreshold) passes count toward a speed-up; once there are
 * `passesNeeded` in a row, BPM goes up by a step (never above the target), or at the target the
 * session is done. Two passes in a row below SLOW_DOWN_BELOW drop BPM by a step (never below the
 * start BPM). Anything in between breaks both streaks.
 */
export function nextLadderState(state: LadderState, pass: { accuracy: number | null }, settings: LadderSettings): LadderStep {
  if (state.done) return { state, change: 'none', message: `Fill learned at ${fmt(state.bpm)} BPM` };
  const accuracy = pass.accuracy ?? 0;
  const passes = state.passes + 1;
  const floor = Math.min(settings.startBpm, settings.targetBpm);

  if (accuracy >= settings.passThreshold) {
    const cleanStreak = state.cleanStreak + 1;
    if (cleanStreak < settings.passesNeeded) {
      return {
        state: { ...state, cleanStreak, badStreak: 0, passes },
        change: 'none',
        message: `Clean! ${cleanStreak} of ${settings.passesNeeded}`,
      };
    }
    if (state.bpm >= settings.targetBpm) {
      return { state: { ...state, cleanStreak, badStreak: 0, passes, done: true }, change: 'finished', message: `Fill learned at ${fmt(state.bpm)} BPM` };
    }
    const bpm = Math.min(settings.targetBpm, state.bpm + settings.stepBpm);
    return { state: { bpm, cleanStreak: 0, badStreak: 0, passes, done: false }, change: 'speedUp', message: `Clean! Speeding up to ${fmt(bpm)} BPM` };
  }

  if (accuracy < SLOW_DOWN_BELOW) {
    const badStreak = state.badStreak + 1;
    if (badStreak < SLOW_DOWN_AFTER) {
      return { state: { ...state, cleanStreak: 0, badStreak, passes }, change: 'none', message: 'Rough pass. Keep going.' };
    }
    const bpm = Math.max(floor, state.bpm - settings.stepBpm);
    if (bpm === state.bpm) {
      return { state: { ...state, cleanStreak: 0, badStreak: 0, passes }, change: 'none', message: `Staying at ${fmt(bpm)} BPM. Take it slow.` };
    }
    return { state: { bpm, cleanStreak: 0, badStreak: 0, passes, done: false }, change: 'slowDown', message: `Slowing down to ${fmt(bpm)} BPM` };
  }

  return { state: { ...state, cleanStreak: 0, badStreak: 0, passes }, change: 'none', message: `Almost: ${settings.passThreshold}% counts as clean.` };
}

/** E.g. "75 → 85 BPM, 1 of 2 clean passes". */
export function ladderProgress(state: LadderState, settings: LadderSettings): string {
  if (state.done) return `Fill learned at ${fmt(state.bpm)} BPM`;
  return `${fmt(state.bpm)} → ${fmt(settings.targetBpm)} BPM, ${state.cleanStreak} of ${settings.passesNeeded} clean passes`;
}

function fmt(bpm: number): string {
  return String(Number(bpm.toFixed(2)));
}
