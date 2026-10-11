import { describe, expect, it } from 'vitest';
import { FILL_LESSONS, STARTER_LESSONS, focusNoteIndices } from '../lessons';
import { buildSessionReport, trend } from './report';
import { scriptedPass } from './testSessions';
import type { PracticeSession } from './types';

const toms = FILL_LESSONS.find((l) => l.id === 'fill-around-toms')!;
const fillNotes = [...focusNoteIndices(toms)];
/** The tom 2 on the 'e' of beat 4 in the fill. */
const TOM2_E = toms.notes.findIndex((n) => n.pad === 'tom2' && n.bar === 1 && n.beat === 3 && n.subdivision === 1);

describe('buildSessionReport', () => {
  it('a steadily improving session', () => {
    // Pass 1 misses 4 fill notes, pass 2 misses 2 of the same, then two clean passes.
    const [a, b, c, d] = fillNotes;
    const session: PracticeSession = {
      lesson: toms,
      passes: [
        scriptedPass(toms, 0, 60, (i) => ([a, b, c, d].includes(i) ? { status: 'missed' } : undefined)),
        scriptedPass(toms, 1, 60, (i) => ([a, b].includes(i) ? { status: 'missed' } : undefined)),
        scriptedPass(toms, 2, 60),
        scriptedPass(toms, 3, 60),
      ],
    };
    const r = buildSessionReport(session);
    expect(fillNotes).toHaveLength(10);
    expect(r.graded).toBe('fill');
    expect(r.accuracy).toEqual({
      overall: 85,
      start: 70,
      end: 100,
      trend: 'improving',
      perPass: [
        { bpm: 60, accuracy: 60 },
        { bpm: 60, accuracy: 80 },
        { bpm: 60, accuracy: 100 },
        { bpm: 60, accuracy: 100 },
      ],
    });
    expect(r.trainer).toBeNull();
    expect(r.passes).toBe(4);
    expect(r.bpm).toEqual({ min: 60, max: 60 });
    // Missed in 2 of 4 passes: a problem spot. Missed once: not.
    expect(r.problemSpots.map((s) => [s.pad, s.missed])).toEqual([
      ['Snare', 2],
      ['Snare', 2],
    ]);
    expect(r.timing).toEqual({ meanMs: 0, spreadMs: 0, tendency: 'on time' });
  });

  it('a session that rushes the fill', () => {
    const fill = new Set(fillNotes);
    const session: PracticeSession = {
      lesson: toms,
      passes: [0, 1, 2].map((p) => scriptedPass(toms, p, 70, (i) => (fill.has(i) ? { offset: -20 } : undefined))),
    };
    const r = buildSessionReport(session);
    expect(r.fill).toEqual({ accuracy: 100, meanMs: -20, spreadMs: 0, tendency: 'rushing', count: '3 e and a', beats: 'beats 3 and 4', bar: 2, firstPad: 'Snare' });
    expect(r.groove).toEqual({ accuracy: 100, meanMs: 0, spreadMs: 0, tendency: 'on time' });
    // 20 ms early is "perfect" at the threshold, so not a problem spot; the tendency still shows.
    expect(r.problemSpots).toEqual([]);
    expect(r.accuracy.trend).toBe('flat');
  });

  it('a session with a repeated wrong tom', () => {
    const session: PracticeSession = {
      lesson: toms,
      passes: [0, 1, 2, 3].map((p) => scriptedPass(toms, p, 65, (i) => (i === TOM2_E && p !== 1 ? { offset: 5, pad: 'tom3' } : undefined))),
    };
    const r = buildSessionReport(session);
    expect(r.problemSpots).toEqual([
      { pad: 'Tom 2', where: "the 'e' of beat 4 (bar 2)", bar: 2, beat: 4, passes: 4, offPasses: 3, missed: 0, wrongPad: 3, early: 0, late: 0, meanMs: 4, playedInstead: 'Tom 3' },
    ]);
    expect(r.perPad.find((p) => p.pad === 'Tom 2')).toMatchObject({ wrongPad: 3, missed: 0, accuracy: 62.5 });
  });

  it('a learned trainer session names the next fill', () => {
    const bpms = [60, 60, 65, 65, 70, 70];
    const session: PracticeSession = {
      lesson: toms,
      passes: bpms.map((bpm, p) => scriptedPass(toms, p, bpm)),
      trainer: { settings: { startBpm: 60, targetBpm: 70, stepBpm: 5, passThreshold: 90, passesNeeded: 2 }, learned: true, finalBpm: 70 },
    };
    const r = buildSessionReport(session);
    expect(r.trainer).toEqual({ startBpm: 60, targetBpm: 70, finalBpm: 70, learned: true });
    expect(r.bpm).toEqual({ min: 60, max: 70 });
    expect(r.lesson).toEqual({ title: 'Around the toms', category: 'fill', next: 'Full-bar tom run', mine: false });
  });

  it('a recorded fill is marked as the player\'s own, with no next lesson', () => {
    const mine = { ...toms, id: 'my-abc', title: 'My fill 1' };
    const r = buildSessionReport({ lesson: mine, passes: [scriptedPass(mine, 0, 60)] });
    expect(r.lesson).toEqual({ title: 'My fill 1', category: 'fill', next: null, mine: true });
  });

  it('a beat without a fill grades the whole lesson', () => {
    const beat = STARTER_LESSONS[0]!;
    const r = buildSessionReport({ lesson: beat, passes: [scriptedPass(beat, 0, 80, (i) => (i === 0 ? { offset: 30 } : undefined))] });
    expect(r.graded).toBe('whole lesson');
    expect(r.fill).toBeNull();
    expect(r.groove).toBeNull();
    expect(r.lesson.next).toBe(STARTER_LESSONS[1]!.title);
    expect(r.accuracy.trend).toBe('flat');
  });

  it('stays small enough to send cheaply', () => {
    // A long, messy trainer session: 20 passes, several pads off.
    const session: PracticeSession = {
      lesson: toms,
      passes: Array.from({ length: 20 }, (_, p) =>
        scriptedPass(toms, p, 60 + 5 * Math.floor(p / 4), (i) => (i % 3 === 0 ? { offset: 30 } : i % 7 === 0 ? { status: 'missed' } : i === TOM2_E ? { offset: 0, pad: 'tom3' } : undefined)),
      ),
      trainer: { settings: { startBpm: 60, targetBpm: 90, stepBpm: 5, passThreshold: 90, passesNeeded: 2 }, learned: false, finalBpm: 80 },
    };
    const json = JSON.stringify(buildSessionReport(session));
    // Roughly 4 characters per token: well under 1,000 tokens even for a long session.
    expect(json.length).toBeLessThan(3500);
    expect(JSON.stringify(buildSessionReport({ ...session, passes: session.passes.slice(0, 6) })).length).toBeLessThan(2400);
  });

  it('handles an empty session', () => {
    const r = buildSessionReport({ lesson: toms, passes: [] });
    expect(r).toMatchObject({ passes: 0, bpm: { min: 0, max: 0 }, accuracy: { overall: null, trend: 'flat' }, problemSpots: [] });
  });
});

describe('trend', () => {
  it('compares the first and second half, leaving out the middle pass', () => {
    expect(trend([60, 80, 100])).toEqual({ start: 60, end: 100, trend: 'improving' });
    expect(trend([90, 92, 88, 91])).toEqual({ start: 91, end: 89.5, trend: 'flat' });
    expect(trend([100, 100, 80, 80])).toEqual({ start: 100, end: 80, trend: 'getting worse' });
    expect(trend([75])).toEqual({ start: 75, end: 75, trend: 'flat' });
    expect(trend([])).toEqual({ start: null, end: null, trend: 'flat' });
  });
});
