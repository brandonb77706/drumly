import { describe, expect, it } from 'vitest';
import { grade, summarize } from '../grading';
import type { Hit, Pad } from '../input';
import { ClickScheduler } from '../metronome/ClickScheduler';
import { lessonToExpectedNotes, resultForPass } from './expected';
import { FILL_LESSONS } from './fills';
import { focusNoteIndices, focusResult, isInFocus, positionStep } from './focus';
import { LessonParseError, lessonFromText } from './parse';
import { countSyllable, positionLabel } from './position';
import type { Lesson } from './types';

const toms = FILL_LESSONS.find((l) => l.id === 'fill-around-toms')!;
const hit = (pad: Pad, time: number): Hit => ({ pad, time, velocity: 100, source: 'test' });

function clicksFor(lesson: Lesson, bars = lesson.bars) {
  const s = new ClickScheduler({ bpm: lesson.defaultBpm, beatsPerBar: lesson.beatsPerBar, subdivision: lesson.subdivision, countIn: true });
  s.start(1);
  const seconds = ((bars + 1) * lesson.beatsPerBar * 60) / lesson.defaultBpm + 1;
  return s.scheduleUntil(1 + seconds).map((c) => ({ ...c, time: c.time * 1000 }));
}

describe('focus range', () => {
  it('is inclusive at both ends and covers fill plus landing', () => {
    expect(isInFocus({ bar: 1, beat: 1, subdivision: 3 }, toms)).toBe(false);
    expect(isInFocus({ bar: 1, beat: 2, subdivision: 0 }, toms)).toBe(true);
    expect(isInFocus({ bar: 2, beat: 0, subdivision: 0 }, toms)).toBe(true);
    expect(isInFocus({ bar: 2, beat: 0, subdivision: 1 }, toms)).toBe(false);
    // 8 fill notes + crash + kick landing.
    expect(focusNoteIndices(toms).size).toBe(10);
    expect(positionStep({ bar: 1, beat: 2, subdivision: 0 }, toms)).toBe(16 + 8);
  });

  it('without a focus, everything is in focus and focusResult is a no-op', () => {
    const plain = lessonFromText({ id: 'p', title: '', description: '', defaultBpm: 60, beatsPerBar: 4, subdivision: 'quarter', text: 'SN: xxxx' });
    expect(isInFocus({ bar: 0, beat: 3, subdivision: 0 }, plain)).toBe(true);
    const r = { notes: [], extras: [] };
    expect(focusResult(r, plain, 100)).toBe(r);
  });

  it('only notes inside it count toward headline accuracy; notes outside are still graded', () => {
    const notes = lessonToExpectedNotes(toms, clicksFor(toms));
    // Miss every groove note before the fill, play the fill and landing perfectly.
    const hits = notes.filter((n) => isInFocus(toms.notes[Number(n.id.split('.')[1])]!, toms)).map((n) => hit(n.pad, n.time));
    const result = grade(notes, hits);
    const full = summarize(result);
    const focus = summarize(focusResult(result, toms, 100));
    expect(full).toMatchObject({ expected: 28, hit: 10, missed: 18 });
    expect(focus).toMatchObject({ expected: 10, hit: 10, missed: 0, accuracy: 100 });
    // The groove notes outside the focus are still in the full result, graded as missed.
    expect(result.notes.filter((r) => r.status === 'missed')).toHaveLength(18);
  });

  it('a wrong tom in the fill lowers focus accuracy more than full accuracy', () => {
    const notes = lessonToExpectedNotes(toms, clicksFor(toms));
    const firstTom2 = notes.findIndex((n) => n.pad === 'tom2');
    const hits = notes.map((n, i) => hit(i === firstTom2 ? 'tom3' : n.pad, n.time));
    const result = grade(notes, hits, { equivalentPads: toms.equivalentPads ?? [] });
    expect(summarize(focusResult(result, toms, 100)).accuracy).toBeCloseTo(90, 9);
    expect(summarize(result).accuracy).toBeCloseTo((27 / 28) * 100, 9);
  });

  it('extras count only near the focus notes of their own pass', () => {
    const clicks = clicksFor(toms, 2 * toms.bars);
    const notes = lessonToExpectedNotes(toms, clicks, { passes: 2 });
    const hits = notes.map((n) => hit(n.pad, n.time));
    const pass1Notes = notes.filter((n) => n.id.includes('#1.'));
    const groove1 = pass1Notes[1]!.time + 30; // during pass 2's groove
    const fill1 = pass1Notes.find((n) => n.pad === 'tom2')!.time + 60; // during pass 2's fill
    hits.push(hit('ride', groove1), hit('ride', fill1));
    const result = grade(notes, hits, { equivalentPads: toms.equivalentPads ?? [] });
    const pass1 = resultForPass(result, 1, -Infinity, Infinity);
    const focus = focusResult(pass1, toms, 100);
    expect(focus.notes).toHaveLength(10);
    expect(focus.extras.map((e) => e.hit.time)).toEqual([fill1]);
  });

  it('is validated when a lesson is built', () => {
    const base = { id: 'f', title: '', description: '', defaultBpm: 60, beatsPerBar: 4, subdivision: 'eighth' as const, text: 'SN: xxxxxxxx' };
    expect(() => lessonFromText({ ...base, focus: { start: { bar: 0, beat: 2, subdivision: 0 }, end: { bar: 0, beat: 1, subdivision: 0 } } })).toThrow(
      'Focus start is after focus end.',
    );
    expect(() => lessonFromText({ ...base, focus: { start: { bar: 0, beat: 0, subdivision: 2 }, end: { bar: 0, beat: 1, subdivision: 0 } } })).toThrow(LessonParseError);
    expect(() => lessonFromText({ ...base, focus: { start: { bar: 0, beat: 0, subdivision: 0 }, end: { bar: 1, beat: 0, subdivision: 0 } } })).toThrow(
      'Focus end (bar 1, beat 0, step 0) is outside the lesson\'s grid.',
    );
  });
});

describe('positionLabel', () => {
  it('names beats', () => {
    expect(positionLabel(0, 0, 0, 4)).toBe('beat 1 (bar 1)');
    expect(positionLabel(1, 2, 0, 1)).toBe('beat 3 (bar 2)');
  });

  it('names 16ths as e, and, a', () => {
    expect(positionLabel(1, 3, 1, 4)).toBe("the 'e' of beat 4 (bar 2)");
    expect(positionLabel(1, 3, 2, 4)).toBe("the 'and' of beat 4 (bar 2)");
    expect(positionLabel(1, 3, 3, 4)).toBe("the 'a' of beat 4 (bar 2)");
  });

  it('names 8th offbeats as and', () => {
    expect(positionLabel(0, 1, 1, 2)).toBe("the 'and' of beat 2 (bar 1)");
  });

  it('names triplets as trip and let', () => {
    expect(positionLabel(1, 3, 1, 3)).toBe("the 'trip' of beat 4 (bar 2)");
    expect(positionLabel(1, 3, 2, 3)).toBe("the 'let' of beat 4 (bar 2)");
    expect(countSyllable(0, 3)).toBeNull();
  });
});
