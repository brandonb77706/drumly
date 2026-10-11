import { describe, expect, it } from 'vitest';
import { ClickScheduler } from '../metronome/ClickScheduler';
import { lessonToExpectedNotes } from './expected';
import { ALL_LESSONS } from '.';
import { SPEED_OPTIONS, lessonBpmAt } from './tempo';
import type { Lesson } from './types';

/** Expected notes for one pass on real scheduler click times at a BPM (1-bar count-in), ms. */
function notesAt(lesson: Lesson, bpm: number) {
  const s = new ClickScheduler({ bpm, beatsPerBar: lesson.beatsPerBar, subdivision: lesson.subdivision, countIn: true });
  s.start(2);
  const seconds = ((lesson.bars + 1) * lesson.beatsPerBar * 60) / bpm + 1;
  const clicks = s.scheduleUntil(2 + seconds).map((c) => ({ ...c, time: c.time * 1000 }));
  return lessonToExpectedNotes(lesson, clicks);
}

describe('slow-down', () => {
  it('offers 50%, 75% and 100% of the default BPM, unrounded', () => {
    expect(SPEED_OPTIONS).toEqual([0.5, 0.75, 1]);
    expect(lessonBpmAt({ defaultBpm: 85 }, 0.75)).toBe(63.75);
    expect(lessonBpmAt({ defaultBpm: 90 }, 0.5)).toBe(45);
    expect(() => lessonBpmAt({ defaultBpm: 90 }, 0)).toThrow(RangeError);
  });

  for (const lesson of ALL_LESSONS) {
    it(`${lesson.title}: notes at 50% are spaced exactly twice as far apart, from click times`, () => {
      const full = notesAt(lesson, lessonBpmAt(lesson, 1));
      const half = notesAt(lesson, lessonBpmAt(lesson, 0.5));
      expect(half.map((n) => n.id)).toEqual(full.map((n) => n.id));
      expect(full.length).toBe(lesson.notes.length);
      for (let i = 1; i < full.length; i++) {
        const fullGap = full[i]!.time - full[i - 1]!.time;
        const halfGap = half[i]!.time - half[i - 1]!.time;
        expect(halfGap).toBeCloseTo(2 * fullGap, 6);
      }
      // The whole pass, first note to last, also takes exactly twice as long.
      expect(half.at(-1)!.time - half[0]!.time).toBeCloseTo(2 * (full.at(-1)!.time - full[0]!.time), 6);
    });
  }

  it('75% spaces notes by 4/3', () => {
    const lesson = ALL_LESSONS.find((l) => l.id === 'rock-kick-variation')!; // 85 BPM -> 63.75
    const full = notesAt(lesson, lessonBpmAt(lesson, 1));
    const slow = notesAt(lesson, lessonBpmAt(lesson, 0.75));
    expect(slow.at(-1)!.time - slow[0]!.time).toBeCloseTo((4 / 3) * (full.at(-1)!.time - full[0]!.time), 6);
  });
});
