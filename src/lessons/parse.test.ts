import { describe, expect, it } from 'vitest';
import { formatLessonText, lessonFromText, LessonParseError, parseLessonText } from './parse';
import { STARTER_LESSONS } from './starters';

const grid16 = { beatsPerBar: 4, subdivision: 'sixteenth' as const };

describe('parseLessonText', () => {
  it('parses the example 16th-note grid into positions', () => {
    const { notes, bars } = parseLessonText(
      `HH: x-x-x-x-x-x-x-x-
       SN: ----x-------x---
       KK: x-------x-------`,
      grid16,
    );
    expect(bars).toBe(1);
    expect(notes).toHaveLength(12);
    expect(notes.filter((n) => n.pad === 'snare').map((n) => [n.bar, n.beat, n.subdivision])).toEqual([
      [0, 1, 0],
      [0, 3, 0],
    ]);
    expect(notes.filter((n) => n.pad === 'hihatClosed').map((n) => [n.beat, n.subdivision])).toEqual([
      [0, 0], [0, 2], [1, 0], [1, 2], [2, 0], [2, 2], [3, 0], [3, 2],
    ]);
    // Simultaneous notes keep line order: hi-hat then kick on beat 1.
    expect(notes.slice(0, 2).map((n) => n.pad)).toEqual(['hihatClosed', 'kick']);
  });

  it('supports accents, dots, bar separators, comments, full pad names and multiple bars', () => {
    const { notes, bars } = parseLessonText(
      `# two bars of 8ths
       hihatOpen: X.x.x.x. | x.x.x.x.
       sn:        ..x...x. | ..x...x.`,
      { beatsPerBar: 4, subdivision: 'eighth' },
    );
    expect(bars).toBe(2);
    expect(notes[0]).toEqual({ pad: 'hihatOpen', bar: 0, beat: 0, subdivision: 0, accent: true });
    expect(notes.filter((n) => n.bar === 1)).toHaveLength(6);
  });

  it('parses triplet grids', () => {
    const { notes } = parseLessonText('RD: x-xx-xx-xx-x', { beatsPerBar: 4, subdivision: 'triplet' });
    expect(notes.map((n) => [n.beat, n.subdivision])).toEqual([[0, 0], [0, 2], [1, 0], [1, 2], [2, 0], [2, 2], [3, 0], [3, 2]]);
  });

  it('throws a clear error for a line that is not a whole number of bars', () => {
    expect(() => parseLessonText('HH: x-x-x-x-x-x-x-x', grid16)).toThrow(LessonParseError);
    expect(() => parseLessonText('HH: x-x-x-x-x-x-x-x', grid16)).toThrow(
      'Line 1 (HH) has 15 steps; each bar needs 16 (4 beats x 4 sixteenth steps), so the length must be a multiple of 16.',
    );
  });

  it('throws when lines have different lengths', () => {
    expect(() => parseLessonText('HH: xxxx\nSN: -x-x-x-x', { beatsPerBar: 4, subdivision: 'quarter' })).toThrow(
      'Line 2 (SN) has 8 steps; expected 4 (the same length as line 1).',
    );
  });

  it('throws when the declared bar count does not match', () => {
    expect(() => parseLessonText('HH: xxxx', { beatsPerBar: 4, subdivision: 'quarter', bars: 2 })).toThrow(
      'Line 1 (HH) has 4 steps; expected 8 (2 bars of 4 steps).',
    );
  });

  it('throws for unknown pad names, listing the valid ones', () => {
    expect(() => parseLessonText('XX: xxxx', { beatsPerBar: 4, subdivision: 'quarter' })).toThrow(/Line 1: unknown pad "XX"\. Use one of HH, OH/);
  });

  it('throws for bad characters, missing colons, duplicate pads and empty input', () => {
    const q = { beatsPerBar: 4, subdivision: 'quarter' as const };
    expect(() => parseLessonText('HH: xxox', q)).toThrow('Line 1 (HH): unexpected character "o" at step 3. Use x, X, - or .');
    expect(() => parseLessonText('HH xxxx', q)).toThrow('Line 1: expected "PAD: pattern", got "HH xxxx".');
    expect(() => parseLessonText('KK: x-x-\nBD: -x-x', q)).toThrow('Line 2 (BD): pad kick was already given on line 1.');
    expect(() => parseLessonText('# nothing\n\n', q)).toThrow('Lesson text has no pad lines.');
  });

  it('formatLessonText round-trips', () => {
    for (const lesson of STARTER_LESSONS) {
      const again = lessonFromText({ ...lesson, text: formatLessonText(lesson) });
      expect(again.notes).toEqual(lesson.notes);
    }
  });
});

describe('starter lessons', () => {
  it('all parse, are 2 bars, and have the expected note counts', () => {
    const counts = Object.fromEntries(STARTER_LESSONS.map((l) => [l.id, l.notes.length]));
    expect(counts).toEqual({
      'rock-quarters': 8 + 4 + 4,
      'rock-eighths': 16 + 4 + 4,
      'rock-kick-variation': 16 + 4 + 6,
      'rock-sixteenths': 32 + 4 + 4,
    });
    for (const l of STARTER_LESSONS) expect(l.bars).toBe(2);
  });

  it('the 16th lesson has the slowest default tempo', () => {
    const sixteenth = STARTER_LESSONS.find((l) => l.subdivision === 'sixteenth')!;
    for (const l of STARTER_LESSONS) expect(sixteenth.defaultBpm).toBeLessThanOrEqual(l.defaultBpm);
  });

  it('the kick variation puts the kick on 1, the "and" of 2, and 3', () => {
    const lesson = STARTER_LESSONS.find((l) => l.id === 'rock-kick-variation')!;
    expect(lesson.notes.filter((n) => n.pad === 'kick' && n.bar === 0).map((n) => [n.beat, n.subdivision])).toEqual([
      [0, 0],
      [1, 1],
      [2, 0],
    ]);
  });
});
