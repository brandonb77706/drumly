import { describe, expect, it } from 'vitest';
import type { Hit } from '../input';
import { FILL_LESSONS, lessonToExpectedNotes, noteId } from '../lessons';
import { HighwayModel } from '../highway';
import { scriptedPass } from '../coach/testSessions';
import { COMPARE_GAP_MS, compareSchedule, compareTimelines, moveResult, replayClicks, type PassTake } from './compare';

const fill = FILL_LESSONS.find((l) => l.id === 'fill-around-toms')!;
const hit = (pad: Hit['pad'], time: number, velocity = 90): Hit => ({ pad, time, velocity, source: 'keyboard' });

/** Pass 2 of a run: downbeat at 20 000 ms, next pass at 30 000 ms. */
function take(): PassTake {
  const { result } = scriptedPass(fill, 2, 60);
  // scriptedPass puts note i at 10 000 * pass + i * 100.
  return { lesson: fill, pass: 2, start: 20_000, end: 30_000, bpm: 60, result };
}

describe('compareTimelines', () => {
  it('correct and player timelines share one relative clock (0 = the pass downbeat); hits keep their real offsets', () => {
    const t = take();
    const recorded = [
      hit('kick', 19_850), // 150 ms before the downbeat: belongs to the previous pass
      hit('kick', 19_960), // 40 ms early for the downbeat: this pass
      hit('snare', 20_437, 127),
      hit('snare', 20_441), // a flam: both hits survive, 4 ms apart
      hit('tom1', 29_950), // early for the next pass's downbeat: not this pass
    ];
    const c = compareTimelines(t, recorded, 100);
    expect(c.correct[0]).toEqual({ pad: fill.notes[0]!.pad, velocity: fill.notes[0]!.accent ? 127 : 96, atMs: 0 });
    expect(c.correct).toHaveLength(fill.notes.length);
    expect(c.yours.map((e) => [e.pad, e.atMs, e.velocity])).toEqual([
      ['kick', -40, 90],
      ['snare', 437, 127],
      ['snare', 441, 90],
    ]);
    expect(c.lengthMs).toBe(10_000);
  });

  it('sequential: yours starts one pass plus a gap after the correct one; together: both at once', () => {
    const t = compareTimelines(take(), [hit('kick', 19_960), hit('snare', 21_000)], 100);
    const seq = compareSchedule(t, 'sequential');
    // An early first hit (-40 ms) moves both sides 40 ms later, keeping their relation.
    expect(seq.leadMs).toBe(40);
    expect(seq.correctStartMs).toBe(40);
    expect(seq.yoursStartMs).toBe(40 + 10_000 + COMPARE_GAP_MS);
    const together = compareSchedule(t, 'together');
    expect(together.yoursStartMs).toBe(together.correctStartMs);
    // Played at start + atMs, the player's kick is 40 ms ahead of the correct downbeat, as played.
    expect(together.yoursStartMs + t.yours[0]!.atMs - (together.correctStartMs + t.correct[0]!.atMs)).toBe(-40);
  });
});

describe('replay on the highway', () => {
  it('replayClicks put each pass on its own start time, start + n * interval', () => {
    const clicks = replayClicks(fill, 60, [1000, 20_000]);
    const perPass = fill.bars * 4 * 4;
    expect(clicks).toHaveLength(2 * perPass);
    expect(clicks[0]).toMatchObject({ bar: 0, beat: 0, subdivision: 0, time: 1000 });
    expect(clicks[5]!.time).toBeCloseTo(1000 + 5 * 250, 9);
    expect(clicks[perPass]).toMatchObject({ bar: fill.bars, beat: 0, subdivision: 0, time: 20_000 });
    const notes = lessonToExpectedNotes(fill, clicks, { passes: 2 });
    expect(notes).toHaveLength(2 * fill.notes.length);
  });

  it('moveResult renumbers a pass and shifts every note and hit by the same amount', () => {
    const t = take();
    const moved = moveResult(t.result, fill, 1, -15_000);
    expect(moved.notes[0]!.note.id).toBe(noteId(fill.id, 1, 0));
    expect(moved.notes[3]!.note.time).toBe(t.result.notes[3]!.note.time - 15_000);
    const r = moved.notes[3]!;
    const o = t.result.notes[3]!;
    expect(r.status !== 'missed' && o.status !== 'missed' && r.hit.time - r.note.time === o.hit.time - o.note.time).toBe(true);

    // On a two-pass replay highway, the moved grade lands on pass 1 (yours), pass 0 stays outlined.
    const model = new HighwayModel(fill, { passes: 2, pastMs: 1e9, futureMs: 1e9, passStyle: (p) => ({ label: p === 0 ? 'Correct' : 'Yours', outlined: p === 0 }) });
    model.refresh(0, () => replayClicks(fill, 60, [1000, 15_000]), true);
    model.syncResults(moveResult(t.result, fill, 1, 15_000 - t.start));
    expect(model.notes.filter((n) => n.outlined)).toHaveLength(fill.notes.length);
    expect(model.notes.filter((n) => !n.outlined && n.state === 'perfect')).toHaveLength(fill.notes.length);
    expect(model.turnMarks.map((m) => m.label)).toEqual(['Correct', 'Yours']);
  });
});
