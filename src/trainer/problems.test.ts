import { describe, expect, it } from 'vitest';
import type { NoteResult } from '../grading';
import type { Pad } from '../input';
import { FILL_LESSONS, noteId } from '../lessons';
import { ProblemTracker } from './problems';

const toms = FILL_LESSONS.find((l) => l.id === 'fill-around-toms')!;
const label = (p: Pad) => ({ tom1: 'Tom 1', tom2: 'Tom 2', tom3: 'Tom 3', snare: 'Snare', kick: 'Kick', crash: 'Crash' } as Record<string, string>)[p] ?? p;

/** Index into toms.notes of the n-th (0-based) note on a pad within the fill bar. */
function fillIndex(pad: Pad, n: number): number {
  const matches = toms.notes.map((note, i) => ({ note, i })).filter(({ note }) => note.bar === 1 && note.beat >= 2 && note.pad === pad);
  return matches[n]!.i;
}

/** One pass: every focus note perfect, except overrides by lesson note index. */
function pass(p: number, overrides: Record<number, { status: 'missed' } | { offset: number; pad?: Pad }> = {}): NoteResult[] {
  return toms.notes.map((n, i): NoteResult => {
    const note = { id: noteId(toms.id, p, i), pad: n.pad, time: 1000 * p + i * 100 };
    const o = overrides[i];
    if (o && 'status' in o) return { note, status: 'missed' };
    const offset = o?.offset ?? 0;
    const pad = o && 'pad' in o && o.pad ? o.pad : n.pad;
    return {
      note,
      status: pad === n.pad ? 'hit' : 'wrongPad',
      hit: { pad, time: note.time + offset, velocity: 100, source: 'test' },
      offsetMs: offset,
      timing: Math.abs(offset) <= 20 ? 'perfect' : Math.abs(offset) <= 40 ? 'good' : offset < 0 ? 'early' : 'late',
    };
  });
}

describe('ProblemTracker', () => {
  it('tracks only focus notes, with correct counts and averages across passes', () => {
    const t = new ProblemTracker(toms);
    const tom2e = fillIndex('tom2', 1);
    const offsets = [35, 30, 0, 40, 36, 2];
    offsets.forEach((offset, p) => t.recordPass(pass(p, { [tom2e]: { offset } })));
    const stats = t.stats();
    expect(stats).toHaveLength(10); // fill + landing only
    const s = stats.find((x) => x.index === tom2e)!;
    expect(s).toMatchObject({ passes: 6, late: 4, early: 0, missed: 0, wrongPad: 0, offsetCount: 6 });
    expect(s.offsetSum / s.offsetCount).toBeCloseTo(143 / 6, 9);
  });

  it('describes a consistently late note in drummer counting', () => {
    const t = new ProblemTracker(toms);
    const tom2e = fillIndex('tom2', 1);
    for (const [p, offset] of [35, 32, 38, 35, 0, 0].entries()) t.recordPass(pass(p, { [tom2e]: { offset } }));
    const [top] = t.worst();
    expect(top!.stats.index).toBe(tom2e);
    expect(t.describe(top!, label)).toBe("Tom 2 on the 'e' of beat 4 (bar 2): late in 4 of 6 passes, about 23 ms late on average");
  });

  it('describes wrong pads and misses', () => {
    const t = new ProblemTracker(toms);
    const snare = fillIndex('snare', 0);
    const tom3 = fillIndex('tom3', 1);
    t.recordPass(pass(0, { [snare]: { offset: 0, pad: 'tom1' }, [tom3]: { status: 'missed' } }));
    t.recordPass(pass(1, { [snare]: { offset: 5, pad: 'tom1' } }));
    t.recordPass(pass(2, { [snare]: { offset: -50, pad: 'tom2' } }));
    const [first, second] = t.worst();
    expect(t.describe(first!, label)).toBe("Snare on beat 3 (bar 2): hit as Tom 1 twice; hit as Tom 2 once; early in 1 of 3 passes");
    expect(t.describe(second!, label)).toBe("Tom 3 on the 'a' of beat 4 (bar 2): missed in 1 of 3 passes");
  });

  it('ranks the worst 3: misses and wrong pads over timing, then larger offset, then lesson order', () => {
    const t = new ProblemTracker(toms);
    const [a, b, c, d, e] = [fillIndex('snare', 1), fillIndex('tom1', 0), fillIndex('tom1', 1), fillIndex('tom2', 0), fillIndex('tom3', 0)];
    t.recordPass(pass(0, { [a]: { offset: 30 }, [b]: { offset: 25 }, [c]: { status: 'missed' }, [d]: { offset: 30 }, [e]: { offset: 30 } }));
    t.recordPass(pass(1, { [a]: { offset: 30 }, [b]: { offset: 25 } }));
    // Scores: c 1 (missed), a 1 (2 x late, mean 30), b 1 (2 x late, mean 25), d 0.5, e 0.5.
    expect(t.worst().map((p) => p.stats.index)).toEqual([a, b, c]);
    // d and e tie on score and mean offset: lesson order breaks it.
    expect(t.worst(5).map((p) => p.stats.index)).toEqual([a, b, c, d, e]);
  });

  it('a clean session has no problem spots', () => {
    const t = new ProblemTracker(toms);
    t.recordPass(pass(0));
    t.recordPass(pass(1, { [fillIndex('tom1', 0)]: { offset: 15 } }));
    expect(t.worst()).toEqual([]);
  });

  it('focusOnly: false tracks every note', () => {
    const t = new ProblemTracker(toms, { focusOnly: false });
    t.recordPass(pass(0));
    expect(t.stats()).toHaveLength(toms.notes.length);
  });
});
