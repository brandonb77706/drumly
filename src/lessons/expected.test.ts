import { afterEach, describe, expect, it, vi } from 'vitest';
import { InputManager, TestSource } from '../input';
import { LiveGrader } from '../grading';
import { ClickScheduler } from '../metronome/ClickScheduler';
import { clicksPerBeat } from '../metronome/timing';
import { lessonNoteSource, lessonToExpectedNotes, notePass, resultForPass } from './expected';
import { lessonFromText } from './parse';
import { STARTER_LESSONS } from './starters';
import type { ClickTime, Lesson } from './types';

/** Real metronome grid clicks (pure scheduler) for a lesson, with a 1-bar count-in, in ms. */
function metronomeClicks(lesson: Lesson, bpm: number, bars: number, startMs = 1000): ClickTime[] {
  const s = new ClickScheduler({ bpm, beatsPerBar: lesson.beatsPerBar, subdivision: lesson.subdivision, countIn: true });
  s.start(startMs / 1000);
  const totalSeconds = ((bars + 1) * lesson.beatsPerBar * 60) / bpm + 1;
  return s.scheduleUntil(startMs / 1000 + totalSeconds).map((c) => ({ ...c, time: c.time * 1000 }));
}

/** Irregular click times: proves notes use the given times rather than recomputing from BPM. */
function irregularClicks(lesson: Lesson, bars: number): ClickTime[] {
  const per = clicksPerBeat(lesson.subdivision);
  const out: ClickTime[] = [];
  let t = 500;
  for (let bar = 0; bar < bars; bar++) {
    for (let beat = 0; beat < lesson.beatsPerBar; beat++) {
      for (let sub = 0; sub < per; sub++) {
        t += 90 + ((bar * 31 + beat * 7 + sub * 13) % 23); // uneven gaps
        out.push({ bar, beat, subdivision: sub, time: t, subdivisionsPerBeat: per, beatsPerBar: lesson.beatsPerBar });
      }
    }
  }
  return out;
}

const sixteenths = lessonFromText({
  id: 'six',
  title: '16ths',
  description: '',
  defaultBpm: 60,
  beatsPerBar: 4,
  subdivision: 'sixteenth',
  text: `HH: x-x-x-x-x-x-x-x- | xxxxxxxxxxxxxxxx
         SN: ----x-------x--- | ----x-------x--x`,
});

afterEach(() => {
  vi.useRealTimers();
});

describe('lessonToExpectedNotes', () => {
  it('puts every note exactly on its click time, including 16ths across bars', () => {
    const clicks = irregularClicks(sixteenths, 2);
    const notes = lessonToExpectedNotes(sixteenths, clicks);
    expect(notes).toHaveLength(sixteenths.notes.length);
    const clickAt = (bar: number, beat: number, sub: number) => clicks.find((c) => c.bar === bar && c.beat === beat && c.subdivision === sub)!.time;
    for (const [i, note] of sixteenths.notes.entries()) {
      const expected = notes.find((n) => n.id === `six#0.${i}`)!;
      expect(expected.time).toBe(clickAt(note.bar, note.beat, note.subdivision));
      expect(expected.pad).toBe(note.pad);
    }
    // The last 16th of bar 2 (beat 4, "a") is there.
    expect(notes.at(-1)).toMatchObject({ pad: 'snare', time: clickAt(1, 3, 3) });
  });

  it('skips count-in clicks and starts at bar 0', () => {
    const lesson = STARTER_LESSONS[0]!;
    const clicks = metronomeClicks(lesson, 120, 2);
    const notes = lessonToExpectedNotes(lesson, clicks);
    const downbeat = clicks.find((c) => c.bar === 0 && c.beat === 0)!.time;
    expect(notes[0]!.time).toBe(downbeat);
    expect(clicks.filter((c) => c.isCountIn)).toHaveLength(4);
  });

  it('marks accented notes with velocity 127', () => {
    const lesson = lessonFromText({ id: 'acc', title: '', description: '', defaultBpm: 60, beatsPerBar: 4, subdivision: 'quarter', text: 'SN: X-x-' });
    const notes = lessonToExpectedNotes(lesson, irregularClicks(lesson, 1));
    expect(notes.map((n) => n.velocity)).toEqual([127, undefined]);
  });

  it('refuses a metronome grid that does not match the lesson', () => {
    const lesson = STARTER_LESSONS[3]!; // 16ths
    const eighthClicks = irregularClicks(STARTER_LESSONS[1]!, 1);
    expect(() => lessonToExpectedNotes(lesson, eighthClicks)).toThrow(/written in sixteenth steps \(4 per beat\), but the metronome is clicking 2 per beat/);
  });

  it('loop mode: pass 2 starts exactly one lesson length after pass 1, on the click times', () => {
    const lesson = STARTER_LESSONS[1]!;
    const clicks = metronomeClicks(lesson, 97, 2 * lesson.bars);
    const notes = lessonToExpectedNotes(lesson, clicks, { passes: Infinity });
    const pass0 = notes.filter((n) => notePass(n.id) === 0);
    const pass1 = notes.filter((n) => notePass(n.id) === 1);
    expect(pass0).toHaveLength(lesson.notes.length);
    expect(pass1).toHaveLength(lesson.notes.length);

    const barClick = (bar: number) => clicks.find((c) => c.bar === bar && c.beat === 0 && c.subdivision === 0)!.time;
    expect(pass0[0]!.time).toBe(barClick(0));
    expect(pass1[0]!.time).toBe(barClick(lesson.bars)); // exactly the click that starts pass 2
    const lessonLengthMs = (lesson.bars * lesson.beatsPerBar * 60_000) / 97;
    pass1.forEach((n, i) => expect(n.time - pass0[i]!.time).toBeCloseTo(lessonLengthMs, 6));

    // Without loop mode only one pass is produced.
    expect(lessonToExpectedNotes(lesson, clicks)).toHaveLength(lesson.notes.length);
  });

  it('works on partial click windows (as the live grader fetches them) without duplicates or gaps', () => {
    const lesson = STARTER_LESSONS[2]!;
    const clicks = metronomeClicks(lesson, 85, 4);
    const whole = lessonToExpectedNotes(lesson, clicks, { passes: Infinity });
    const pieces = [0, 1, 2, 3].flatMap((k) => {
      const from = 1000 + k * 1700;
      const to = from + 1700;
      return lessonToExpectedNotes(lesson, clicks.filter((c) => c.time >= from && c.time < to), { passes: Infinity });
    });
    expect(pieces.map((n) => n.id).filter((id) => whole.some((w) => w.id === id))).toEqual(
      whole.filter((w) => pieces.some((p) => p.id === w.id)).map((w) => w.id),
    );
    expect(new Set(pieces.map((n) => n.id)).size).toBe(pieces.length);
  });
});

describe('scripted perfect runs of each starter lesson', () => {
  for (const lesson of STARTER_LESSONS) {
    it(`${lesson.title}: 100% through TestSource + LiveGrader`, async () => {
      vi.useFakeTimers();
      const clicks = metronomeClicks(lesson, lesson.defaultBpm, lesson.bars);
      const notes = lessonToExpectedNotes(lesson, clicks);

      const manager = new InputManager();
      await manager.start();
      const t0 = 1000;
      const grader = new LiveGrader(manager, notes, {
        autoCheck: false,
        now: () => t0,
        ...(lesson.equivalentPads ? { config: { equivalentPads: lesson.equivalentPads } } : {}),
      });
      grader.start();

      const script = notes.map((n) => ({ pad: n.pad, at: n.time - t0, velocity: n.velocity ?? 100 }));
      const done = vi.fn();
      manager.add(new TestSource(script, { now: () => t0, onDone: done }));
      await vi.advanceTimersByTimeAsync(notes.at(-1)!.time - t0 + 10);
      expect(done).toHaveBeenCalled();

      const { summary } = grader.stop(Infinity);
      expect(summary).toMatchObject({ expected: lesson.notes.length, hit: lesson.notes.length, accuracy: 100, missed: 0, extra: 0, wrongPad: 0 });
      expect(summary.meanOffsetMs).toBeCloseTo(0, 9);
    });
  }
});

describe('resultForPass', () => {
  it('splits a looped grade into passes: notes by id, extras by time range', () => {
    const lesson = STARTER_LESSONS[0]!;
    const clicks = metronomeClicks(lesson, 120, 2 * lesson.bars);
    const notes = lessonToExpectedNotes(lesson, clicks, { passes: Infinity });
    const passStart = (k: number) => clicks.find((c) => c.bar === k * lesson.bars && c.beat === 0 && c.subdivision === 0)!.time;
    const result = {
      notes: notes.map((note) => ({ note, status: 'missed' as const })),
      extras: [
        { hit: { pad: 'tom1' as const, velocity: 90, time: passStart(1) - 150, source: 'test' as const }, status: 'extra' as const },
        { hit: { pad: 'tom1' as const, velocity: 90, time: passStart(1) - 50, source: 'test' as const }, status: 'extra' as const },
      ],
    };
    const p0 = resultForPass(result, 0, passStart(0) - 100, passStart(1) - 100);
    const p1 = resultForPass(result, 1, passStart(1) - 100, Infinity);
    expect(p0.notes).toHaveLength(lesson.notes.length);
    expect(p1.notes).toHaveLength(lesson.notes.length);
    expect(p0.extras.map((e) => e.hit.time)).toEqual([passStart(1) - 150]);
    expect(p1.extras.map((e) => e.hit.time)).toEqual([passStart(1) - 50]);
  });
});

describe('lessonNoteSource', () => {
  /** A grid whose click times jump 40 ms earlier from `shiftAt` on (like a clock-reference refresh). */
  function shiftingGrid(clicks: ClickTime[], shiftAt: number, nowRef: { now: number }) {
    return (from: number, to: number) =>
      clicks.map((c) => ({ ...c, time: nowRef.now >= shiftAt ? c.time - 40 : c.time })).filter((c) => c.time >= from && c.time < to);
  }

  async function gradeWithSource(overlapMs: number) {
    const lesson = STARTER_LESSONS[1]!;
    const clicks = metronomeClicks(lesson, 120, lesson.bars);
    const clock = { now: 0 };
    // Frames are 16 ms apart from t=1000. At t=2872 the grader has fetched up to 2972; bar 0's
    // downbeat is at 3000. The shift at t=2888 moves it to 2960, behind the fetched edge.
    expect(clicks.find((c) => c.bar === 0 && c.beat === 0)!.time).toBe(3000);
    const source = lessonNoteSource(lesson, shiftingGrid(clicks, 2888, clock), { overlapMs });
    const manager = new InputManager();
    await manager.start();
    const grader = new LiveGrader(manager, source, { autoCheck: false, now: () => clock.now, ignoreHitsBefore: 1000 });
    grader.start();
    // Walk time forward in animation-frame-sized steps, as the page does.
    for (clock.now = 1000; clock.now < 8000; clock.now += 16) grader.check(clock.now);
    return { lesson, final: grader.stop(9000) };
  }

  it('without overlap, a backward clock shift can drop a note at a window edge', async () => {
    const { lesson, final } = await gradeWithSource(0);
    expect(final.summary.expected).toBeLessThan(lesson.notes.length);
  });

  it('with the default overlap, every note of the pass is still found exactly once', async () => {
    const { lesson, final } = await gradeWithSource(250);
    expect(final.summary.expected).toBe(lesson.notes.length);
    expect(new Set(final.results.notes.map((r) => r.note.id)).size).toBe(lesson.notes.length);
  });
});
