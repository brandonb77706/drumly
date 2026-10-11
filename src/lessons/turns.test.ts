import { describe, expect, it } from 'vitest';
import { summarize, type GradeResult } from '../grading';
import { TrainerSession } from '../trainer';
import { clicksPerBeat } from '../metronome/timing';
import { FILL_LESSONS, STARTER_LESSONS } from './index';
import { lessonToExpectedNotes, notePass } from './expected';
import { barsLesson, drumGainForPass, gradedNotesOnly, GUIDE_GAIN, sectionLesson, turnPlan } from './turns';
import { barOfLabel, fullBar } from './position';
import { ProblemTracker } from '../trainer/problems';
import { buildSessionReport } from '../coach/report';
import { scriptedPass } from '../coach/testSessions';
import type { ClickTime, Lesson } from './types';

const toms = FILL_LESSONS.find((l) => l.id === 'fill-around-toms')!;

/** A steady click grid for `bars` bars at `bpm`, starting at t = 1000 ms: start + n * interval. */
function grid(lesson: Lesson, bars: number, bpm: number): ClickTime[] {
  const perBeat = clicksPerBeat(lesson.subdivision);
  const step = 60_000 / bpm / perBeat;
  const clicks: ClickTime[] = [];
  for (let n = 0; n < bars * lesson.beatsPerBar * perBeat; n++) {
    const beatIndex = Math.floor(n / perBeat);
    clicks.push({ bar: Math.floor(beatIndex / lesson.beatsPerBar), beat: beatIndex % lesson.beatsPerBar, subdivision: n % perBeat, time: 1000 + n * step, subdivisionsPerBeat: perBeat, beatsPerBar: lesson.beatsPerBar });
  }
  return clicks;
}

describe('sectionLesson', () => {
  it('keeps the whole bars holding the fill and its landing, renumbered from bar 0', () => {
    const s = sectionLesson(toms);
    expect(s.bars).toBe(2);
    expect(s.focus).toEqual({ start: { bar: 0, beat: 2, subdivision: 0 }, end: { bar: 1, beat: 0, subdivision: 0 } });
    expect(s.notes).toEqual(toms.notes.filter((n) => n.bar >= 1).map((n) => ({ ...n, bar: n.bar - 1 })));
    expect(s.id).toBe(toms.id);
  });

  it('a lesson without a focus is played whole', () => {
    expect(sectionLesson(STARTER_LESSONS[0]!)).toBe(STARTER_LESSONS[0]);
  });

  it("remembers the full lesson's bar numbers: the fill is bar 2 of 3 in Listen mode too", () => {
    const s = sectionLesson(toms);
    expect(s.section).toEqual({ firstBar: 1, totalBars: 3 });
    expect(barOfLabel(s, 0)).toBe('bar 2 of 3');
    expect(barOfLabel(s, 1)).toBe('bar 3 of 3');
    expect(barOfLabel(toms, 1)).toBe('bar 2 of 3');
  });

  it('problem spots and the coach name a section note by its full-lesson bar', () => {
    const s = sectionLesson(toms);
    const tom2 = s.notes.findIndex((n) => n.pad === 'tom2');
    const tracker = new ProblemTracker(s);
    // Tom 2 missed in every pass: "the 'and' of beat 4 (bar 2)", as the description and Trainer say.
    const passes = [0, 1, 2].map((p) => scriptedPass(s, p, 60, (i) => (i === tom2 ? { status: 'missed' as const } : undefined)));
    for (const p of passes) tracker.recordPass(p.result.notes);
    expect(tracker.describe(tracker.worst(1)[0]!, (pad) => pad)).toContain('(bar 2)');
    const report = buildSessionReport({ lesson: s, passes });
    expect(report.problemSpots[0]).toMatchObject({ bar: 2, where: expect.stringContaining('(bar 2)') });
    expect(report.fill?.bar).toBe(2);
  });
});

describe('barsLesson (a song A-B loop)', () => {
  const song: Lesson = { ...STARTER_LESSONS[0]!, id: 'my-song', bars: 8, notes: Array.from({ length: 8 }, (_, bar) => ({ pad: 'snare' as const, bar, beat: 1, subdivision: 0 })) };

  it('cuts out bars, renumbers them from 0 and keeps the song numbering', () => {
    const loop = barsLesson(song, 4, 6);
    expect(loop.bars).toBe(3);
    expect(loop.notes.map((n) => n.bar)).toEqual([0, 1, 2]);
    expect(loop.section).toEqual({ firstBar: 4, totalBars: 8 });
    expect(barOfLabel(loop, 0)).toBe('bar 5 of 8');
    // A section of a section still counts in the song's bars.
    const inner = barsLesson(loop, 1, 2);
    expect(fullBar(inner, 0)).toBe(5);
    expect(inner.section).toEqual({ firstBar: 5, totalBars: 8 });
  });

  it('the whole song comes back unchanged; bad ranges throw', () => {
    expect(barsLesson(song, 0, 7)).toBe(song);
    expect(() => barsLesson(song, 3, 2)).toThrow(RangeError);
    expect(() => barsLesson(song, 0, 8)).toThrow(RangeError);
  });

  it('drops a focus that is not inside the bars', () => {
    expect(barsLesson(toms, 0, 0).focus).toBeUndefined();
    expect(barsLesson(toms, 1, 2).focus).toEqual(sectionLesson(toms).focus);
  });
});

describe('turnPlan', () => {
  it('without listen mode every pass is graded', () => {
    const plan = turnPlan(3, false);
    expect([0, 1, 2].map(plan.isGraded)).toEqual([true, true, true]);
    expect(plan.firstGraded).toBe(0);
    expect(plan.nextGraded(0)).toBe(1);
    expect(plan.changeBar(4)).toBe(6);
  });

  it('app turns and player turns alternate on consecutive sections of one click timeline', () => {
    const section = sectionLesson(toms);
    const plan = turnPlan(section.bars, true);
    const notes = lessonToExpectedNotes(section, grid(section, 8, 70), { passes: Infinity });
    const byPass = new Map<number, number[]>();
    for (const n of notes) byPass.set(notePass(n.id)!, [...(byPass.get(notePass(n.id)!) ?? []), n.time]);
    expect([...byPass.keys()]).toEqual([0, 1, 2, 3]);
    expect([0, 1, 2, 3].map(plan.turn)).toEqual(['listen', 'play', 'listen', 'play']);
    // Each pass is exactly one section later than the one before: same grid, no gaps, no overlap.
    const sectionMs = (section.bars * section.beatsPerBar * 60_000) / 70;
    for (let p = 1; p < 4; p++) {
      const prev = byPass.get(p - 1)!;
      const cur = byPass.get(p)!;
      cur.forEach((t, i) => expect(t - prev[i]!).toBeCloseTo(sectionMs, 6));
      expect(Math.min(...cur)).toBeGreaterThan(Math.max(...prev));
    }
    // Tempo changes land on the next listen turn, so the player hears the new tempo first.
    expect(plan.changeBar(1)).toBe(4);
    expect(plan.changeBar(4)).toBe(4);
    expect(plan.changeBar(5)).toBe(8);
    expect(plan.turn(plan.changeBar(5) / section.bars)).toBe('listen');
  });

  it('only player turns reach the grader and the trainer ladder', () => {
    const section = sectionLesson(toms);
    const plan = turnPlan(section.bars, true);
    const clicks = grid(section, 8, 60);
    const source = gradedNotesOnly((from, to) => lessonToExpectedNotes(section, clicks.filter((c) => c.time >= from && c.time < to), { passes: Infinity }), plan);
    const graded = source(-Infinity, Infinity);
    expect(new Set(graded.map((n) => notePass(n.id)))).toEqual(new Set([1, 3]));
    expect(graded).toHaveLength(2 * section.notes.length);

    // Feed the trainer the way the app does: graded passes only, each a perfect pass.
    const trainer = new TrainerSession(section, { startBpm: 60, targetBpm: 65, stepBpm: 5, passThreshold: 90, passesNeeded: 2 });
    for (let pass = plan.firstGraded; pass < 4; pass = plan.nextGraded(pass)) {
      const result: GradeResult = {
        notes: graded.filter((n) => notePass(n.id) === pass).map((note) => ({ note, status: 'hit', hit: { pad: note.pad, time: note.time, velocity: 100, source: 'test' }, offsetMs: 0, timing: 'perfect' })),
        extras: [],
      };
      expect(summarize(result).accuracy).toBe(100);
      trainer.recordPass(pass, result, 60);
    }
    expect(trainer.reports.map((r) => r.pass)).toEqual([1, 3]);
    expect(trainer.state.passes).toBe(2);
    expect([1, 3].map(plan.gradedNumber)).toEqual([1, 2]);
  });

  it('drum level: full on listen turns; the guide (quiet) or silence on player turns', () => {
    const plan = turnPlan(2, true);
    let guide = false;
    const gain = drumGainForPass(plan, () => guide);
    expect([0, 1, 2, 3].map(gain)).toEqual([1, 0, 1, 0]);
    guide = true;
    expect([0, 1].map(gain)).toEqual([1, GUIDE_GAIN]);
    // Outside listen mode the guide is the only sound.
    const plain = drumGainForPass(turnPlan(3, false), () => true);
    expect(plain(0)).toBe(GUIDE_GAIN);
  });
});
