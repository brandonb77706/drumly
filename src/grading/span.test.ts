import { describe, expect, it } from 'vitest';
import type { Hit, Pad } from '../input';
import { resultForPass } from '../lessons/expected';
import { LiveGrader, type HitStream } from './LiveGrader';
import { grade } from './match';
import { gradeSpan } from './span';
import { summarize } from './summary';
import { DEFAULT_GRADING_CONFIG, type ExpectedNote, type GradeResult } from './types';

const W = DEFAULT_GRADING_CONFIG.windowMs;
const START = 1000;
const BARS = 2;
const BPM = 120;
const STEP = 60_000 / BPM / 4;
const PASS_MS = BARS * 16 * STEP;

/** A 2-bar rock beat (16th hi-hats, kick on 1 and 3, snare on 2 and 4) looped `passes` times, ids like lessonToExpectedNotes. */
function loop(passes: number): ExpectedNote[] {
  const notes: ExpectedNote[] = [];
  for (let p = 0; p < passes; p++) {
    let i = 0;
    for (let n = 0; n < BARS * 16; n++) {
      const time = START + p * PASS_MS + n * STEP;
      notes.push({ id: `rock#${p}.${i++}`, pad: 'hihatClosed', time });
      if (n % 16 === 0 || n % 16 === 8) notes.push({ id: `rock#${p}.${i++}`, pad: 'kick', time });
      if (n % 16 === 4 || n % 16 === 12) notes.push({ id: `rock#${p}.${i++}`, pad: 'snare', time });
    }
  }
  return notes;
}

/** Sloppy playing: ±jitter/2, misses, wrong pads and extras. Deterministic. */
function perform(notes: readonly ExpectedNote[], jitterMs: number, seed: number): Hit[] {
  const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
  const hits: Hit[] = [];
  for (const n of notes) {
    const r = rand();
    if (r < 0.05) continue;
    const pad: Pad = r < 0.08 ? 'tom1' : n.pad;
    hits.push({ pad, time: n.time + (rand() - 0.5) * jitterMs, velocity: 90, source: 'test' });
    if (r > 0.97) hits.push({ pad: 'crash', time: n.time + 55, velocity: 90, source: 'test' });
  }
  return hits.sort((a, b) => a.time - b.time);
}

function shape(r: GradeResult) {
  return {
    notes: r.notes.map((x) => [x.note.id, x.status, x.status === 'missed' ? null : x.hit.time]),
    extras: r.extras.map((e) => e.hit.time),
  };
}

/**
 * Play a looped run through a LiveGrader (default settling), reporting each pass the way the app
 * does: once its last note's window plus 50 ms grace has passed. Returns each pass's exact grade
 * and its slice of the live grade at that moment.
 */
function playLoop(notes: readonly ExpectedNote[], hits: readonly Hit[], passes: number) {
  let listener: ((hit: Hit) => void) | null = null;
  const stream: HitStream = { onHit: (l) => ((listener = l), () => (listener = null)) };
  let now = 0;
  const source = (from: number, to: number) => notes.filter((n) => n.time >= from && n.time < to);
  const grader = new LiveGrader(stream, source, { autoCheck: false, now: () => now, ignoreHitsBefore: START - W });
  grader.start();
  const exact: GradeResult[] = [];
  const live: GradeResult[] = [];
  let next = 0;
  let h = 0;
  const reportDue = (k: number) => notes.filter((n) => n.id.startsWith(`rock#${k}.`)).at(-1)!.time + W + 50;
  for (let t = 0; t < START + passes * PASS_MS + 1000; t += 16) {
    now = t;
    while (h < hits.length && hits[h]!.time <= now) listener!(hits[h++]!);
    grader.check(now);
    while (next < passes && now > reportDue(next)) {
      const from = START + next * PASS_MS;
      const k = next;
      exact.push(grader.gradeSpan(from, from + PASS_MS, (n) => n.id.startsWith(`rock#${k}.`)));
      live.push(resultForPass(grader.getResults(), next, from - W, from + PASS_MS - W));
      next++;
    }
  }
  return { exact, live, final: grader.stop(now).results };
}

describe('gradeSpan', () => {
  it('a hit just before a downbeat goes to the downbeat, not to the previous pass, and counts once', () => {
    const notes = loop(2);
    // Pass 0's last hi-hat is skipped; pass 1's first hi-hat is played 40 ms early. That hit is
    // inside the window of both notes, but much closer to the downbeat.
    const lastOf0 = notes.filter((n) => n.id.startsWith('rock#0.')).at(-1)!;
    const firstHat1 = notes.find((n) => n.id === 'rock#1.0')!;
    const hits: Hit[] = notes
      .filter((n) => n !== lastOf0)
      .map((n) => ({ pad: n.pad, time: n === firstHat1 ? n.time - 40 : n.time, velocity: 90, source: 'test' }));
    expect(firstHat1.time - 40 - lastOf0.time).toBeLessThan(W);
    const p0 = gradeSpan(notes, hits, START, START + PASS_MS);
    const p1 = gradeSpan(notes, hits, START + PASS_MS, START + 2 * PASS_MS);
    expect(p0.notes.find((r) => r.note === lastOf0)!.status).toBe('missed');
    expect(summarize(p0).missed).toBe(1);
    const early = p1.notes.find((r) => r.note === firstHat1)!;
    expect(early.status === 'missed' ? null : early.offsetMs).toBeCloseTo(-40);
    expect(summarize(p1).hit).toBe(notes.length / 2);
    expect([...p0.extras, ...p1.extras]).toEqual([]);
  });

  it('a stray hit between passes is an extra of exactly one pass', () => {
    const notes = loop(2);
    const hits: Hit[] = notes.map((n) => ({ pad: n.pad, time: n.time, velocity: 90, source: 'test' }));
    hits.push({ pad: 'crash', time: START + PASS_MS - 30, velocity: 90, source: 'test' });
    const p0 = gradeSpan(notes, hits, START, START + PASS_MS);
    const p1 = gradeSpan(notes, hits, START + PASS_MS, START + 2 * PASS_MS);
    expect(p0.extras.length + p1.extras.length).toBe(1);
    expect(p1.extras).toHaveLength(1);
  });
});

describe('gradeSpan picking notes by id', () => {
  it("a downbeat note stored a hair before the pass window still belongs to its pass", () => {
    const notes = loop(2);
    // The metronome refreshed its clock reference after these were fetched: every stored time is 0.1 ms early.
    const drifted = notes.map((n) => ({ ...n, time: n.time - 0.1 }));
    const hits: Hit[] = notes.map((n) => ({ pad: n.pad, time: n.time, velocity: 90, source: 'test' }));
    const pass1 = (n: ExpectedNote) => n.id.startsWith('rock#1.');
    const byTime = gradeSpan(drifted, hits, START + PASS_MS, START + 2 * PASS_MS);
    const byId = gradeSpan(drifted, hits, START + PASS_MS, START + 2 * PASS_MS, {}, pass1);
    expect(byTime.notes.length).not.toBe(notes.length / 2);
    expect(byId.notes.map((r) => r.note.id)).toEqual(drifted.filter(pass1).map((n) => n.id));
    expect(summarize(byId).hit).toBe(notes.length / 2);
  });
});

describe('exact per-pass summaries in a sloppy looped run', () => {
  const PASSES = 12;
  const notes = loop(PASSES);
  // ±50 ms on 16ths 125 ms apart: sloppy enough that settled live verdicts can differ from a regrade.
  const hits = perform(notes, 100, 11);
  const { exact, live, final } = playLoop(notes, hits, PASSES);

  it('each pass summary is identical to a batch grade of that pass', () => {
    expect(exact).toHaveLength(PASSES);
    exact.forEach((result, k) => {
      const from = START + k * PASS_MS;
      // Batch grade of the pass from the complete recording, after the run.
      const batch = gradeSpan(notes, hits, from, from + PASS_MS);
      expect(shape(result)).toEqual(shape(batch));
      expect(summarize(result)).toEqual(summarize(batch));
      expect(summarize(result).expected).toBe(notes.length / PASSES);
    });
  });

  it('matches the whole run graded at once on almost every note, and stop() is that whole-run grade', () => {
    // Like settling, a pass grade can't see the whole run's timing-consistency chain, so in a
    // near-tie it can read a note differently. With this much slop that's a handful of notes.
    let differ = 0;
    exact.forEach((result, k) => {
      const from = START + k * PASS_MS;
      const slice = resultForPass(grade(notes, hits), k, from - W, from + PASS_MS - W);
      result.notes.forEach((r, i) => {
        const b = slice.notes[i]!;
        if (r.status !== b.status || (r.status !== 'missed' && b.status !== 'missed' && r.hit !== b.hit)) differ++;
      });
    });
    expect(differ).toBeLessThan(notes.length * 0.02);
    expect(shape(final)).toEqual(shape(grade(notes, hits)));
  });

  it('with normal playing (±20 ms), each pass equals its slice of the whole-run grade exactly', () => {
    const steady = perform(notes, 40, 5);
    const run = playLoop(notes, steady, PASSES);
    run.exact.forEach((result, k) => {
      const from = START + k * PASS_MS;
      expect(shape(result)).toEqual(shape(resultForPass(grade(notes, steady), k, from - W, from + PASS_MS - W)));
    });
  });

  it('is needed: the live (settled) slice differs on at least one pass of this run', () => {
    const differs = live.some((r, k) => JSON.stringify(shape(r)) !== JSON.stringify(shape(exact[k]!)));
    expect(differs).toBe(true);
  });
});
