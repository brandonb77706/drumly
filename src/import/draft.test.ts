import { describe, expect, it } from 'vitest';
import { clampFocus, draftToLesson, focusFromPick, pickFromFocus, type ImportDraft } from './draft';

const grid = { bars: 3, beatsPerBar: 4, subdivision: 'sixteenth' } as const;
const bar = (s: string) => s.repeat(4);
const draft: ImportDraft = {
  origin: 'midi',
  title: 'Fill',
  bpm: 90,
  beatsPerBar: 4,
  subdivision: 'sixteenth',
  // Two bars of fill plus the landing bar.
  text: `SN: ${bar('x---')} | ${bar('xxxx')} | ----------------\nCR: ---------------- | ---------------- | x---------------`,
  landing: true,
  warnings: [],
};

describe('focus pickers', () => {
  it('a pick covers the start of the first beat to the last step of the last beat', () => {
    expect(focusFromPick({ fromBar: 2, fromBeat: 3, toBar: 3, toBeat: 1 }, grid, 'from')).toEqual({
      start: { bar: 1, beat: 2, subdivision: 0 },
      end: { bar: 2, beat: 0, subdivision: 3 },
    });
  });

  it('a backwards range moves the end that was not edited', () => {
    const pick = { fromBar: 3, fromBeat: 2, toBar: 1, toBeat: 4 };
    expect(focusFromPick(pick, grid, 'from')).toEqual({ start: { bar: 2, beat: 1, subdivision: 0 }, end: { bar: 2, beat: 1, subdivision: 3 } });
    expect(focusFromPick(pick, grid, 'to')).toEqual({ start: { bar: 0, beat: 3, subdivision: 0 }, end: { bar: 0, beat: 3, subdivision: 3 } });
  });

  it('values outside the grid are clamped, and a pick round-trips through pickFromFocus', () => {
    const focus = focusFromPick({ fromBar: 0, fromBeat: 9, toBar: 99, toBeat: NaN }, grid, 'to');
    expect(focus).toEqual({ start: { bar: 0, beat: 3, subdivision: 0 }, end: { bar: 2, beat: 0, subdivision: 3 } });
    expect(pickFromFocus(focus)).toEqual({ fromBar: 1, fromBeat: 4, toBar: 3, toBeat: 1 });
  });

  it('clampFocus keeps a focus inside a text that lost bars', () => {
    const focus = { start: { bar: 1, beat: 0, subdivision: 0 }, end: { bar: 5, beat: 3, subdivision: 3 } };
    expect(clampFocus(focus, { ...grid, bars: 2 })).toEqual({ start: { bar: 1, beat: 0, subdivision: 0 }, end: { bar: 1, beat: 3, subdivision: 3 } });
  });
});

describe('draftToLesson focus', () => {
  it('defaults to the suggested focus (a fill with a landing ends on the landing)', () => {
    const { lesson } = draftToLesson(draft, 'my-x');
    expect(lesson.focus).toEqual({ start: { bar: 0, beat: 0, subdivision: 0 }, end: { bar: 2, beat: 0, subdivision: 0 } });
  });

  it('uses the focus picked on the review screen', () => {
    const focus = focusFromPick({ fromBar: 2, fromBeat: 1, toBar: 3, toBeat: 1 }, grid, 'from');
    const { lesson, data } = draftToLesson({ ...draft, focus }, 'my-x');
    expect(lesson.focus).toEqual(focus);
    expect(data.focus).toEqual(focus);
  });

  it('songs have no focus, whatever was picked', () => {
    const song = { ...draft, text: `KK: ${Array(6).fill(bar('x---')).join(' | ')}`, landing: false };
    const { lesson } = draftToLesson({ ...song, focus: focusFromPick({ fromBar: 1, fromBeat: 1, toBar: 2, toBeat: 4 }, grid, 'from') }, 'my-s');
    expect(lesson.category).toBe('song');
    expect(lesson.focus).toBeUndefined();
  });
});
