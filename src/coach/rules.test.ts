import { describe, expect, it } from 'vitest';
import { FILL_LESSONS, focusNoteIndices } from '../lessons';
import { buildSessionReport } from './report';
import { scriptedPass } from './testSessions';
import { ruleBasedCoaching } from './rules';
import type { ProblemSpotReport, SessionReport } from './types';

/** A clean, unremarkable fill session to tweak per test. */
function base(): SessionReport {
  return {
    lesson: { title: 'Around the toms', category: 'fill', next: 'Full-bar tom run' },
    passes: 4,
    bpm: { min: 60, max: 60 },
    trainer: null,
    graded: 'fill',
    accuracy: { overall: 85, start: 85, end: 85, trend: 'flat', perPass: [60, 60, 60, 60].map((bpm) => ({ bpm, accuracy: 85 })) },
    timing: { meanMs: 0, spreadMs: 18, tendency: 'on time' },
    fill: { accuracy: 85, meanMs: 0, spreadMs: 18, tendency: 'on time', count: '3 e and a', beats: 'beats 3 and 4', firstPad: 'Snare' },
    groove: { accuracy: 100, meanMs: 0, spreadMs: 5, tendency: 'on time' },
    perPad: [],
    problemSpots: [],
  };
}

function spot(over: Partial<ProblemSpotReport>): ProblemSpotReport {
  return { pad: 'Tom 2', where: "the 'e' of beat 4 (bar 2)", passes: 4, offPasses: 3, missed: 0, wrongPad: 0, early: 0, late: 0, meanMs: 0, playedInstead: null, ...over };
}

describe('ruleBasedCoaching', () => {
  it('rushing into the fill: count it out loud', () => {
    const r = base();
    r.fill = { ...r.fill!, meanMs: -18, tendency: 'rushing' };
    const c = ruleBasedCoaching(r);
    expect(c.fixThis).toEqual(["You're rushing into the fill (about 18 ms early). Count '3 e and a' out loud and land the first snare on time."]);
    expect(c.nextExercise).toBe("Play it at 60 BPM counting '3 e and a' out loud, until the fill sits on the click 5 passes in a row.");
    expect(c.headline).toBe('Good work. One thing to tighten up.');
  });

  it('15 ms early is not called rushing; dragging is called out the other way', () => {
    const r = base();
    r.fill = { ...r.fill!, meanMs: -15 };
    expect(ruleBasedCoaching(r).fixThis).toEqual([]);
    r.fill = { ...r.fill!, meanMs: 22 };
    expect(ruleBasedCoaching(r).fixThis[0]).toBe("You're dragging the fill (about 22 ms late). Count '3 e and a' out loud and keep the fill moving with the click.");
  });

  it('no fill: rushing applies to the whole lesson', () => {
    const r = { ...base(), fill: null, groove: null, graded: 'whole lesson' as const, timing: { meanMs: -20, spreadMs: 10, tendency: 'rushing' as const } };
    expect(ruleBasedCoaching(r).fixThis[0]).toBe("You're rushing (about 20 ms early on average). Relax and let the click come to you.");
  });

  it('repeated wrong pad on one note: isolate those beats', () => {
    const r = base();
    r.problemSpots = [spot({ wrongPad: 3, playedInstead: 'Tom 3' })];
    const c = ruleBasedCoaching(r);
    expect(c.fixThis[0]).toBe("Tom 2 on the 'e' of beat 4 (bar 2) keeps landing on Tom 3. Play just beats 3 and 4 slowly until your hand finds Tom 2.");
    expect(c.nextExercise).toBe('Loop just beats 3 and 4 at 50 BPM until Tom 2 is right 5 times in a row, then play the whole thing again.');
  });

  it('a single wrong pad is not enough', () => {
    const r = base();
    r.problemSpots = [spot({ wrongPad: 1, playedInstead: 'Tom 3', late: 0, early: 0 })];
    expect(ruleBasedCoaching(r).fixThis).toEqual([]);
  });

  it('repeated miss', () => {
    const r = base();
    r.problemSpots = [spot({ pad: 'Tom 3', missed: 2, where: "the 'a' of beat 4 (bar 2)" })];
    expect(ruleBasedCoaching(r).fixThis[0]).toBe("Tom 3 on the 'a' of beat 4 (bar 2) keeps dropping out (missed in 2 of 4 passes). Slow down until every note sounds.");
  });

  it('loose timing: drop 10 BPM and use "Count-in only"', () => {
    const r = base();
    r.timing = { meanMs: 3, spreadMs: 31, tendency: 'on time' };
    const c = ruleBasedCoaching(r);
    expect(c.fixThis).toEqual(['Your timing is loose (hits spread about 31 ms). Drop 10 BPM to 50 and try the "Count-in only" click mode.']);
    expect(c.nextExercise).toContain('"Count-in only"');
    // 25 ms is still fine.
    r.timing.spreadMs = 25;
    expect(ruleBasedCoaching(r).fixThis).toEqual([]);
  });

  it('a consistently late note on the right pad', () => {
    const r = base();
    r.problemSpots = [spot({ late: 4, meanMs: 23 })];
    expect(ruleBasedCoaching(r).fixThis[0]).toBe("Tom 2 on the 'e' of beat 4 (bar 2) comes in late (4 of 4 passes, about 23 ms).");
  });

  it('getting worse at one tempo: take a break; not when the tempo went up', () => {
    const r = base();
    r.accuracy = { ...r.accuracy, start: 95, end: 75, trend: 'getting worse' };
    expect(ruleBasedCoaching(r).fixThis[0]).toBe('Accuracy dropped from 95% to 75% as you went. Shake out your hands and take a short break.');
    r.bpm = { min: 60, max: 70 };
    expect(ruleBasedCoaching(r).fixThis).toEqual([]);
  });

  it('fill learned: suggest the next fill', () => {
    const r = base();
    r.trainer = { startBpm: 60, targetBpm: 70, finalBpm: 70, learned: true };
    r.bpm = { min: 60, max: 70 };
    r.accuracy.overall = 100;
    const c = ruleBasedCoaching(r);
    expect(c.headline).toBe('Fill learned at 70 BPM. Nice work.');
    expect(c.nextExercise).toBe('Move on to "Full-bar tom run". Start it in the Trainer and let it bring you up to speed.');
    expect(c.wentWell.slice(0, 3)).toEqual(['You learned it at 70 BPM.', 'You climbed from 60 to 70 BPM.', 'Right drums, right place: 100% on the fill.']);
  });

  it('the last fill learned: push the target up', () => {
    const r = base();
    r.lesson.next = null;
    r.trainer = { startBpm: 40, targetBpm: 65, finalBpm: 65, learned: true };
    expect(ruleBasedCoaching(r).nextExercise).toBe("That's the hardest fill here. Run it in the Trainer again with the target at 75 BPM.");
  });

  it('at most 2 fixes, most important first', () => {
    const r = base();
    r.problemSpots = [spot({ wrongPad: 3, playedInstead: 'Tom 3' })];
    r.fill = { ...r.fill!, meanMs: -18 };
    r.timing.spreadMs = 40;
    const c = ruleBasedCoaching(r);
    expect(c.fixThis).toHaveLength(2);
    expect(c.fixThis[0]).toContain('keeps landing on Tom 3');
    expect(c.fixThis[1]).toContain('rushing into the fill');
    expect(c.headline).toBe('Good work. Two things to tighten up.');
  });

  it('always finds something that went well', () => {
    const r = base();
    r.accuracy = { ...r.accuracy, overall: 40 };
    r.fill = { ...r.fill!, accuracy: 40 };
    r.timing.spreadMs = 20;
    const c = ruleBasedCoaching(r);
    expect(c.wentWell).toEqual(['You put in 4 passes. Reps are how this sticks.']);
    expect(c.headline).toBe("Tough one, but you're putting in the reps.");
  });

  it('end to end: a scripted session with a repeated wrong tom', () => {
    const toms = FILL_LESSONS.find((l) => l.id === 'fill-around-toms')!;
    const tom2e = toms.notes.findIndex((n) => n.pad === 'tom2' && n.bar === 1 && n.beat === 3 && n.subdivision === 1);
    const passes = [0, 1, 2].map((p) => scriptedPass(toms, p, 60, (i) => (i === tom2e ? { offset: 0, pad: 'tom3' } : undefined)));
    const c = ruleBasedCoaching(buildSessionReport({ lesson: toms, passes }));
    expect(c.fixThis).toEqual(["Tom 2 on the 'e' of beat 4 (bar 2) keeps landing on Tom 3. Play just beats 3 and 4 slowly until your hand finds Tom 2."]);
    expect(focusNoteIndices(toms).has(tom2e)).toBe(true);
  });
});
