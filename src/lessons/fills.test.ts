import { afterEach, describe, expect, it, vi } from 'vitest';
import { InputManager, TestSource, type ScriptedHit } from '../input';
import { LiveGrader, type FinalGrade } from '../grading';
import { ClickScheduler } from '../metronome/ClickScheduler';
import { lessonToExpectedNotes } from './expected';
import { FILL_LESSONS } from './fills';
import { formatLessonText, lessonFromText } from './parse';
import { isInFocus } from './focus';
import type { ClickTime, Lesson } from './types';
import { ALL_LESSONS } from '.';

const snareFill = FILL_LESSONS.find((l) => l.id === 'fill-snare-sixteenths')!;
const tomsFill = FILL_LESSONS.find((l) => l.id === 'fill-around-toms')!;

/** Real metronome grid clicks (pure scheduler) for a lesson, with a 1-bar count-in, in ms. */
function metronomeClicks(lesson: Lesson, bpm: number): ClickTime[] {
  const s = new ClickScheduler({ bpm, beatsPerBar: lesson.beatsPerBar, subdivision: lesson.subdivision, countIn: true });
  s.start(1);
  const totalSeconds = ((lesson.bars + 1) * lesson.beatsPerBar * 60) / bpm + 1;
  return s.scheduleUntil(1 + totalSeconds).map((c) => ({ ...c, time: c.time * 1000 }));
}

/** Play a script through TestSource into a LiveGrader on fake timers, and return the final grade. */
async function playThroughGrader(lesson: Lesson, script: (notes: ReturnType<typeof lessonToExpectedNotes>, t0: number) => ScriptedHit[]): Promise<FinalGrade> {
  vi.useFakeTimers();
  const notes = lessonToExpectedNotes(lesson, metronomeClicks(lesson, lesson.defaultBpm));
  const manager = new InputManager();
  await manager.start();
  const t0 = 1000;
  const grader = new LiveGrader(manager, notes, {
    autoCheck: false,
    now: () => t0,
    ...(lesson.equivalentPads ? { config: { equivalentPads: lesson.equivalentPads } } : {}),
  });
  grader.start();
  const done = vi.fn();
  manager.add(new TestSource(script(notes, t0), { now: () => t0, onDone: done }));
  await vi.advanceTimersByTimeAsync(notes.at(-1)!.time - t0 + 10);
  expect(done).toHaveBeenCalled();
  return grader.stop(Infinity);
}

const perfectScript = (notes: ReturnType<typeof lessonToExpectedNotes>, t0: number): ScriptedHit[] =>
  notes.map((n) => ({ pad: n.pad, at: n.time - t0, velocity: n.velocity ?? 100 }));

afterEach(() => {
  vi.useRealTimers();
});

describe('fill lessons', () => {
  it('are fills, 3 bars long with an accented crash plus kick landing in bar 3', () => {
    for (const l of FILL_LESSONS) {
      expect(l.category).toBe('fill');
      expect(l.bars).toBe(3);
      expect(l.notes.filter((n) => n.bar === 2).map((n) => [n.pad, n.beat, n.subdivision, n.accent ?? false])).toEqual([
        ['kick', 0, 0, false],
        ['crash', 0, 0, true],
      ]);
    }
  });

  it('are sorted easiest to hardest, and beats come before fills', () => {
    expect(FILL_LESSONS.map((l) => l.id)).toEqual([
      'fill-snare-eighths',
      'fill-snare-sixteenths',
      'fill-snare-floor-tom',
      'fill-triplet',
      'fill-around-toms',
      'fill-full-bar-toms',
    ]);
    expect(ALL_LESSONS.map((l) => l.category)).toEqual(['beat', 'beat', 'beat', 'beat', 'fill', 'fill', 'fill', 'fill', 'fill', 'fill']);
    expect(lessonFromText({ id: 'x', title: '', description: '', defaultBpm: 60, beatsPerBar: 4, subdivision: 'quarter', text: 'SN: x---' }).category).toBe('beat');
  });

  it('each has the expected note count, grid and focus range (fill through the landing)', () => {
    const spec = Object.fromEntries(FILL_LESSONS.map((l) => [l.id, [l.notes.length, l.subdivision, l.focus]]));
    const focus = (bar: number, beat: number) => ({ start: { bar, beat, subdivision: 0 }, end: { bar: 2, beat: 0, subdivision: 0 } });
    expect(spec).toEqual({
      'fill-snare-eighths': [12 + 11 + 2, 'eighth', focus(1, 3)],
      'fill-snare-sixteenths': [12 + 13 + 2, 'sixteenth', focus(1, 3)],
      'fill-snare-floor-tom': [12 + 13 + 2, 'sixteenth', focus(1, 3)],
      'fill-triplet': [8 + 9 + 2, 'triplet', focus(1, 3)],
      'fill-around-toms': [12 + 14 + 2, 'sixteenth', focus(1, 2)],
      'fill-full-bar-toms': [12 + 16 + 2, 'sixteenth', focus(1, 0)],
    });
  });

  it('the fill parts play the right pads in the right places', () => {
    const fillPart = (id: string) => {
      const l = FILL_LESSONS.find((f) => f.id === id)!;
      return l.notes.filter((n) => n.bar === 1 && isInFocus(n, l)).map((n) => [n.pad, n.beat, n.subdivision]);
    };
    expect(fillPart('fill-snare-eighths')).toEqual([['snare', 3, 0], ['snare', 3, 1]]);
    expect(fillPart('fill-snare-floor-tom')).toEqual([['snare', 3, 0], ['snare', 3, 1], ['tom3', 3, 2], ['tom3', 3, 3]]);
    expect(fillPart('fill-triplet')).toEqual([['snare', 3, 0], ['tom1', 3, 1], ['tom2', 3, 2]]);
    expect(fillPart('fill-full-bar-toms').map((n) => n[0])).toEqual([
      ...Array(4).fill('snare'), ...Array(4).fill('tom1'), ...Array(4).fill('tom2'), ...Array(4).fill('tom3'),
    ]);
  });

  it('snare 16ths fill: beat bar, beats 1-3 of the beat then four 16th snares on beat 4, landing', () => {
    // Bar 1: 8 hats + 2 snares + 2 kicks. Bar 2: 6 hats + 1 snare + 4 fill snares + 2 kicks. Bar 3: kick + crash.
    expect(snareFill.notes).toHaveLength(12 + 13 + 2);
    const bar2 = snareFill.notes.filter((n) => n.bar === 1);
    expect(bar2.filter((n) => n.beat === 3).map((n) => [n.pad, n.subdivision])).toEqual([
      ['snare', 0],
      ['snare', 1],
      ['snare', 2],
      ['snare', 3],
    ]);
    expect(bar2.filter((n) => n.pad === 'hihatClosed').map((n) => n.beat)).toEqual([0, 0, 1, 1, 2, 2]);
  });

  it('around the toms: beat bar, then snare snare tom1 tom1 tom2 tom2 tom3 tom3 on beats 3 and 4, landing', () => {
    // Bar 1: 12. Bar 2: 4 hats + 1 snare + 1 kick + 8 fill notes. Bar 3: kick + crash.
    expect(tomsFill.notes).toHaveLength(12 + 14 + 2);
    const fill = tomsFill.notes.filter((n) => n.bar === 1 && n.beat >= 2);
    expect(fill.map((n) => n.pad)).toEqual(['snare', 'snare', 'tom1', 'tom1', 'tom2', 'tom2', 'tom3', 'tom3']);
    expect(fill.map((n) => n.beat * 4 + n.subdivision)).toEqual([8, 9, 10, 11, 12, 13, 14, 15]);
  });

  it('round-trip through the text format', () => {
    for (const lesson of FILL_LESSONS) {
      expect(lessonFromText({ ...lesson, text: formatLessonText(lesson) }).notes).toEqual(lesson.notes);
    }
  });

  for (const lesson of FILL_LESSONS) {
    it(`${lesson.title}: a scripted perfect run grades 100%`, async () => {
      const { summary } = await playThroughGrader(lesson, perfectScript);
      expect(summary).toMatchObject({ expected: lesson.notes.length, hit: lesson.notes.length, accuracy: 100, missed: 0, extra: 0, wrongPad: 0 });
      expect(summary.meanOffsetMs).toBeCloseTo(0, 9);
    });
  }

  it('around the toms with one tom played on the wrong drum grades exactly one wrongPad', async () => {
    const { results, summary } = await playThroughGrader(tomsFill, (notes, t0) => {
      const script = perfectScript(notes, t0);
      const firstTom2 = script.findIndex((h) => h.pad === 'tom2');
      script[firstTom2] = { ...script[firstTom2]!, pad: 'tom3' };
      return script;
    });
    expect(summary).toMatchObject({ expected: 28, hit: 27, wrongPad: 1, missed: 0, extra: 0 });
    const wrong = results.notes.filter((n) => n.status === 'wrongPad');
    expect(wrong).toHaveLength(1);
    expect(wrong[0]).toMatchObject({ note: { pad: 'tom2' }, hit: { pad: 'tom3' }, offsetMs: 0 });
  });
});
