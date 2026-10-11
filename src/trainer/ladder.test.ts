import { describe, expect, it } from 'vitest';
import { defaultLadderSettings, initialLadderState, ladderProgress, nextLadderState, passVerdict, type LadderSettings, type LadderState } from './ladder';

const settings: LadderSettings = { startBpm: 60, targetBpm: 70, stepBpm: 5, passThreshold: 90, passesNeeded: 2 };

/** Run accuracies through the ladder; returns every step. */
function run(accuracies: (number | null)[], s = settings, from: LadderState = initialLadderState(s)) {
  let state = from;
  return accuracies.map((accuracy) => {
    const step = nextLadderState(state, { accuracy }, s);
    state = step.state;
    return step;
  });
}

describe('ladder', () => {
  it('defaults: start at 60% of the lesson BPM, target the lesson BPM, +5, 90%, 2 passes', () => {
    expect(defaultLadderSettings({ defaultBpm: 100 })).toEqual({ startBpm: 60, targetBpm: 100, stepBpm: 5, passThreshold: 90, passesNeeded: 2 });
    expect(defaultLadderSettings({ defaultBpm: 75 }).startBpm).toBe(45);
    expect(initialLadderState(settings)).toEqual({ bpm: 60, cleanStreak: 0, badStreak: 0, passes: 0, done: false });
  });

  it('speeds up after the required clean passes in a row, not before', () => {
    const steps = run([95, 92]);
    expect(steps[0]).toMatchObject({ change: 'none', state: { bpm: 60, cleanStreak: 1 } });
    expect(steps[1]).toMatchObject({ change: 'speedUp', message: 'Clean! Speeding up to 65 BPM', state: { bpm: 65, cleanStreak: 0 } });
  });

  it('exactly the threshold counts as clean; a middling pass breaks the clean streak', () => {
    expect(run([90, 90]).at(-1)!.change).toBe('speedUp');
    const steps = run([95, 85, 95]);
    expect(steps.map((s) => s.change)).toEqual(['none', 'none', 'none']);
    expect(steps[2]!.state.cleanStreak).toBe(1);
  });

  it('never exceeds the target', () => {
    const s = { ...settings, targetBpm: 63 };
    const steps = run([100, 100, 100, 100, 100, 100], s);
    expect(steps.map((x) => x.state.bpm)).toEqual([60, 63, 63, 63, 63, 63]);
    expect(Math.max(...steps.map((x) => x.state.bpm))).toBe(63);
  });

  it('finishes at the target after the required clean passes there', () => {
    const steps = run([100, 100, 100, 100, 100, 100]);
    expect(steps.map((s) => s.change)).toEqual(['none', 'speedUp', 'none', 'speedUp', 'none', 'finished']);
    expect(steps[5]).toMatchObject({ message: 'Fill learned at 70 BPM', state: { bpm: 70, done: true } });
    // Once done, further passes change nothing.
    const after = nextLadderState(steps[5]!.state, { accuracy: 0 }, settings);
    expect(after.state).toBe(steps[5]!.state);
  });

  it('slows down after two bad passes in a row', () => {
    const at70 = { ...initialLadderState(settings), bpm: 70 };
    const steps = run([60, 50], settings, at70);
    expect(steps[0]).toMatchObject({ change: 'none', state: { bpm: 70, badStreak: 1 } });
    expect(steps[1]).toMatchObject({ change: 'slowDown', message: 'Slowing down to 65 BPM', state: { bpm: 65, badStreak: 0 } });
  });

  it('a bad pass then a clean or middling one resets the bad streak', () => {
    const at70 = { ...initialLadderState(settings), bpm: 70 };
    expect(run([60, 80, 60], settings, at70).map((s) => s.change)).toEqual(['none', 'none', 'none']);
    expect(run([60, 95, 60], settings, at70).map((s) => s.change)).toEqual(['none', 'none', 'none']);
  });

  it('never goes below the start BPM', () => {
    const steps = run([10, 10, 10, 10]);
    expect(steps.map((s) => s.state.bpm)).toEqual([60, 60, 60, 60]);
    expect(steps.every((s) => s.change !== 'slowDown')).toBe(true);
    const fromHigher = run([0, 0, 0, 0, 0, 0], { ...settings, stepBpm: 4 }, { ...initialLadderState(settings), bpm: 66 });
    expect(fromHigher.map((s) => s.state.bpm)).toEqual([66, 62, 62, 60, 60, 60]);
  });

  it('a pass with no gradable notes counts as 0%', () => {
    expect(run([null, null]).map((s) => s.state.badStreak)).toEqual([1, 0]);
  });

  it('starting at or above the target finishes after the clean passes', () => {
    const s = { ...settings, startBpm: 80, targetBpm: 70 };
    expect(initialLadderState(s).bpm).toBe(70);
    expect(run([100, 100], s).map((x) => x.change)).toEqual(['none', 'finished']);
  });

  it('describes progress', () => {
    const steps = run([95]);
    expect(ladderProgress(steps[0]!.state, settings)).toBe('60 → 70 BPM, 1 of 2 clean passes');
    expect(ladderProgress({ ...steps[0]!.state, done: true, bpm: 70 }, settings)).toBe('Fill learned at 70 BPM');
  });
});

describe('passVerdict', () => {
  it('matches the ladder: at the threshold is clean, below 70 is rough, in between is almost', () => {
    expect(passVerdict(100, settings)).toBe('clean');
    expect(passVerdict(90, settings)).toBe('clean');
    expect(passVerdict(89.9, settings)).toBe('almost');
    expect(passVerdict(70, settings)).toBe('almost');
    expect(passVerdict(69.9, settings)).toBe('rough');
    expect(passVerdict(null, settings)).toBe('rough');
  });

  it('a 90% pass at a 90% threshold is clean for both the ladder and the chip', () => {
    const step = nextLadderState(initialLadderState(settings), { accuracy: 90 }, settings);
    expect(step.state.cleanStreak).toBe(1);
    expect(passVerdict(90, settings)).toBe('clean');
  });
});
