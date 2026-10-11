import { describe, expect, it } from 'vitest';
import { grade, summarize } from './grading';
import { checkSummary, GRADE_SCENARIOS, rockBeatNotes, scriptToHits } from './gradeScenarios';

describe('grade test scenarios', () => {
  const downbeat = 12_345.678;

  for (const scenario of GRADE_SCENARIOS) {
    it(`${scenario.label} produces its expected summary`, () => {
      const summary = summarize(grade(rockBeatNotes(downbeat), scriptToHits(scenario.script, downbeat)));
      expect(checkSummary({
        accuracy: summary.accuracy ?? NaN,
        hit: summary.hit,
        wrongPad: summary.wrongPad,
        missed: summary.missed,
        extra: summary.extra,
        meanOffsetMs: summary.meanOffsetMs ?? NaN,
        stdDevOffsetMs: summary.stdDevOffsetMs ?? NaN,
      }, scenario.expected, 1e-6)).toEqual([]);
    });
  }

  it('perfect run: 100% accuracy and every offset 0', () => {
    const r = grade(rockBeatNotes(downbeat), scriptToHits(GRADE_SCENARIOS[0]!.script, downbeat));
    expect(r.notes).toHaveLength(24);
    for (const n of r.notes) expect(n).toMatchObject({ status: 'hit', timing: 'perfect' });
    for (const n of r.notes) if (n.status === 'hit') expect(n.offsetMs).toBeCloseTo(0, 9);
  });

  it('30 ms late: every hit good, mean +30, std dev ~0', () => {
    const s = summarize(grade(rockBeatNotes(downbeat), scriptToHits(GRADE_SCENARIOS[1]!.script, downbeat)));
    expect(s.timing).toEqual({ perfect: 0, good: 24, early: 0, late: 0 });
    expect(s.meanOffsetMs).toBeCloseTo(30, 9);
    expect(s.stdDevOffsetMs).toBeCloseTo(0, 6);
  });

  it('missed-snares run: the two snares missed and the kick is extra', () => {
    const r = grade(rockBeatNotes(downbeat), scriptToHits(GRADE_SCENARIOS[2]!.script, downbeat));
    expect(r.notes.filter((n) => n.status === 'missed').map((n) => [n.note.pad, n.note.time - downbeat])).toEqual([
      ['snare', 600],
      ['snare', 4200],
    ]);
    expect(r.extras.map((e) => [e.hit.pad, e.hit.time - downbeat])).toEqual([['kick', 900]]);
  });

  it('ride run: exactly one hi-hat note is wrongPad, hit by the ride', () => {
    const r = grade(rockBeatNotes(downbeat), scriptToHits(GRADE_SCENARIOS[3]!.script, downbeat));
    const wrong = r.notes.filter((n) => n.status === 'wrongPad');
    expect(wrong).toHaveLength(1);
    expect(wrong[0]).toMatchObject({ note: { pad: 'hihatClosed' }, hit: { pad: 'ride' } });
  });
});
