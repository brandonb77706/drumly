import { describe, expect, it } from 'vitest';
import type { Hit, Pad } from '../input';
import { grade, padsEquivalent } from './match';
import { gradeTiming } from './timingGrade';
import { ANY_HIHAT, ANY_SNARE, type ExpectedNote, type NoteResult } from './types';

let nextId = 0;
const note = (pad: Pad, time: number): ExpectedNote => ({ id: `n${nextId++}`, pad, time });
const hit = (pad: Pad, time: number): Hit => ({ pad, time, velocity: 100, source: 'test' });
const statuses = (rs: readonly NoteResult[]) => rs.map((r) => r.status);

describe('grade: basic outcomes', () => {
  it('perfect run: every note hit with offset 0', () => {
    const notes = [note('kick', 0), note('hihatClosed', 0), note('snare', 500), note('hihatClosed', 500)];
    const r = grade(notes, notes.map((n) => hit(n.pad, n.time)));
    expect(statuses(r.notes)).toEqual(['hit', 'hit', 'hit', 'hit']);
    expect(r.notes.map((n) => (n.status === 'hit' ? n.offsetMs : null))).toEqual([0, 0, 0, 0]);
    expect(r.extras).toEqual([]);
  });

  it('detects missed notes', () => {
    const r = grade([note('kick', 0), note('snare', 500)], [hit('kick', 3)]);
    expect(statuses(r.notes)).toEqual(['hit', 'missed']);
  });

  it('detects extra hits', () => {
    const r = grade([note('kick', 0)], [hit('kick', 0), hit('snare', 300)]);
    expect(statuses(r.notes)).toEqual(['hit']);
    expect(r.extras.map((e) => e.hit.pad)).toEqual(['snare']);
  });

  it('detects wrong pads and still measures their offset', () => {
    const r = grade([note('hihatClosed', 1000)], [hit('ride', 1012)]);
    expect(r.notes[0]).toMatchObject({ status: 'wrongPad', offsetMs: 12, timing: 'perfect' });
    expect(r.extras).toEqual([]);
  });

  it('reports offsets as hit - note: negative early, positive late', () => {
    const r = grade([note('snare', 1000), note('snare', 2000)], [hit('snare', 965), hit('snare', 2050)]);
    expect(r.notes.map((n) => (n.status === 'hit' ? [n.offsetMs, n.timing] : null))).toEqual([
      [-35, 'good'],
      [50, 'late'],
    ]);
  });
});

describe('grade: matching rules', () => {
  it('simultaneous kick + hi-hat each match their own hit, whatever order the hits arrive in', () => {
    const notes = [note('kick', 1000), note('hihatClosed', 1000)];
    const r = grade(notes, [hit('hihatClosed', 1004), hit('kick', 1009)]);
    expect(r.notes.map((n) => (n.status === 'hit' ? [n.note.pad, n.hit.pad] : null))).toEqual([
      ['kick', 'kick'],
      ['hihatClosed', 'hihatClosed'],
    ]);
  });

  it('a hit just outside the window is extra and its note is missed', () => {
    const r = grade([note('snare', 1000)], [hit('snare', 1100.5)]);
    expect(statuses(r.notes)).toEqual(['missed']);
    expect(r.extras).toHaveLength(1);
  });

  it('a hit exactly on the window edge still matches', () => {
    expect(statuses(grade([note('snare', 1000)], [hit('snare', 900)]).notes)).toEqual(['hit']);
  });

  it('the window is configurable', () => {
    const r = grade([note('snare', 1000)], [hit('snare', 1060)], { windowMs: 50 });
    expect(statuses(r.notes)).toEqual(['missed']);
  });

  it('two hits near one note: the closer one matches, the other is extra', () => {
    const r = grade([note('snare', 1000)], [hit('snare', 960), hit('snare', 1015)]);
    expect(r.notes[0]).toMatchObject({ status: 'hit', offsetMs: 15 });
    expect(r.extras.map((e) => e.hit.time)).toEqual([960]);
  });

  it('a hit that loses a contested note can still match a different note', () => {
    // Hit A (1040) is closest to note X (1000)? No: hit B (1005) is closer to X, so A goes to Y (1100).
    const r = grade([note('snare', 1000), note('snare', 1100)], [hit('snare', 1040), hit('snare', 1005)]);
    expect(r.notes.map((n) => (n.status === 'hit' ? n.hit.time : null))).toEqual([1005, 1040]);
    expect(r.extras).toEqual([]);
  });

  it('prefers a same-pad hit over a closer wrong-pad hit', () => {
    const r = grade([note('snare', 1000)], [hit('tom1', 1001), hit('snare', 1030)]);
    expect(r.notes[0]).toMatchObject({ status: 'hit', offsetMs: 30 });
    expect(r.extras.map((e) => e.hit.pad)).toEqual(['tom1']);
  });

  it('a wrong-pad hit never steals a note that its own pad matches elsewhere', () => {
    // Kick + snare notes together; player hits only the snare. Snare matches snare; kick is missed,
    // not "wrongPad with the snare hit".
    const r = grade([note('kick', 1000), note('snare', 1000)], [hit('snare', 1002)]);
    expect(statuses(r.notes)).toEqual(['missed', 'hit']);
  });

  it('is deterministic for exact ties', () => {
    const notes = [note('snare', 1000), note('snare', 1020)];
    const hits = [hit('snare', 1010)];
    const a = grade(notes, hits);
    const b = grade(notes, hits);
    expect(a).toEqual(b);
    expect(statuses(a.notes)).toEqual(['hit', 'missed']); // tie goes to the earlier note
  });

  it('results come back in time order regardless of input order', () => {
    const r = grade([note('snare', 2000), note('kick', 1000)], [hit('snare', 2001), hit('kick', 999)]);
    expect(r.notes.map((n) => n.note.time)).toEqual([1000, 2000]);
  });
});

describe('pad equivalence', () => {
  it('by default closed and open hi-hat are wrong pads for each other', () => {
    const r = grade([note('hihatClosed', 1000)], [hit('hihatOpen', 1000)]);
    expect(statuses(r.notes)).toEqual(['wrongPad']);
  });

  it('with "any hi-hat", an open hi-hat matches a closed hi-hat note', () => {
    const r = grade([note('hihatClosed', 1000)], [hit('hihatOpen', 1003)], { equivalentPads: [ANY_HIHAT] });
    expect(statuses(r.notes)).toEqual(['hit']);
  });

  it('snare and snare rim follow the same rule', () => {
    expect(statuses(grade([note('snare', 0)], [hit('snareRim', 0)]).notes)).toEqual(['wrongPad']);
    expect(statuses(grade([note('snare', 0)], [hit('snareRim', 0)], { equivalentPads: [ANY_SNARE] }).notes)).toEqual(['hit']);
  });

  it('padsEquivalent only links pads in the same group', () => {
    expect(padsEquivalent('hihatClosed', 'hihatOpen', [ANY_HIHAT, ANY_SNARE])).toBe(true);
    expect(padsEquivalent('hihatClosed', 'snare', [ANY_HIHAT, ANY_SNARE])).toBe(false);
    expect(padsEquivalent('hihatPedal', 'hihatClosed', [ANY_HIHAT])).toBe(false);
  });
});

describe('gradeTiming', () => {
  it('uses perfect <= 20, good <= 40, then early/late', () => {
    expect([0, 20, -20, 20.01, 40, -40, 40.01, -40.01].map((o) => gradeTiming(o))).toEqual([
      'perfect', 'perfect', 'perfect', 'good', 'good', 'good', 'late', 'early',
    ]);
  });

  it('thresholds are configurable', () => {
    expect(gradeTiming(12, { perfectMs: 10, goodMs: 25 })).toBe('good');
    expect(gradeTiming(-30, { perfectMs: 10, goodMs: 25 })).toBe('early');
    const r = grade([note('kick', 0)], [hit('kick', 12)], { timing: { perfectMs: 10, goodMs: 25 } });
    expect(r.notes[0]).toMatchObject({ timing: 'good' });
  });
});
