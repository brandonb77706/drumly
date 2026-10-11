import { describe, expect, it } from 'vitest';
import type { Hit, Pad } from '../input';
import { LiveGrader, type HitStream } from './LiveGrader';
import { grade } from './match';
import { summarize } from './summary';
import type { ExpectedNote, GradeResult } from './types';

/** A 64-bar song at 120 BPM: 16th hi-hats, kick on 1 and 3, snare on 2 and 4 (1,280 notes). */
function song(bars = 64, bpm = 120): ExpectedNote[] {
  const step = 60_000 / bpm / 4;
  const notes: ExpectedNote[] = [];
  for (let n = 0; n < bars * 16; n++) {
    const t = 1000 + n * step;
    notes.push({ id: `s#0.${notes.length}`, pad: 'hihatClosed', time: t });
    if (n % 16 === 0 || n % 16 === 8) notes.push({ id: `s#0.${notes.length}`, pad: 'kick', time: t });
    if (n % 16 === 4 || n % 16 === 12) notes.push({ id: `s#0.${notes.length}`, pad: 'snare', time: t });
  }
  return notes;
}

/** A believable performance: jitter (±jitterMs / 2), some misses, wrong pads and extra hits. Deterministic. */
function perform(notes: readonly ExpectedNote[], jitterMs = 40): Hit[] {
  let seed = 7;
  const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
  const hits: Hit[] = [];
  for (const n of notes) {
    const r = rand();
    if (r < 0.04) continue; // missed
    const pad: Pad = r < 0.07 ? 'tom1' : n.pad; // wrong pad
    hits.push({ pad, time: n.time + (rand() - 0.5) * jitterMs, velocity: 90, source: 'test' });
    if (r > 0.98) hits.push({ pad: 'crash', time: n.time + 60, velocity: 90, source: 'test' }); // extra
  }
  return hits.sort((a, b) => a.time - b.time);
}

function play(notes: readonly ExpectedNote[], hits: readonly Hit[], settleMs?: number) {
  let listener: ((hit: Hit) => void) | null = null;
  const stream: HitStream = {
    onHit: (l) => {
      listener = l;
      return () => (listener = null);
    },
  };
  let now = 0;
  // Notes come from a function, like the metronome-backed lesson source.
  const source = (from: number, to: number) => notes.filter((n) => n.time >= from && n.time < to);
  const grader = new LiveGrader(stream, source, { autoCheck: false, now: () => now, ignoreHitsBefore: 900, ...(settleMs !== undefined ? { settleMs } : {}) });
  grader.start();
  const perHit: number[] = [];
  let maxLive = 0;
  for (const hit of hits) {
    now = hit.time + 5;
    grader.check(now);
    const t0 = performance.now();
    listener!(hit);
    perHit.push(performance.now() - t0);
    maxLive = Math.max(maxLive, grader.liveNoteCount);
  }
  now = notes.at(-1)!.time + 3000;
  grader.check(now);
  return { grader, perHit, maxLive };
}

/** Comparable form of a grade: each note's status and matched hit time, plus extras. */
function shape(r: GradeResult) {
  return {
    notes: r.notes.map((x) => [x.note.id, x.status, x.status === 'missed' ? null : x.hit.time]),
    extras: r.extras.map((e) => e.hit.time),
  };
}

describe('live grading a long song', () => {
  const notes = song();
  const hits = perform(notes);

  it('stays within 50 ms per hit, regrading only the notes near the current position', () => {
    expect(notes.length).toBeGreaterThan(1200);
    const { perHit, maxLive } = play(notes, hits);
    const total = perHit.reduce((a, b) => a + b, 0);
    expect(total / perHit.length).toBeLessThan(50);
    expect(Math.max(...perHit)).toBeLessThan(50);
    // About 2.5 s of notes at 8 notes a beat: a few dozen, not the whole song.
    expect(maxLive).toBeLessThan(80);
  });

  it('gives the same result as grading everything at once (±20 ms playing), and stop() is the batch grade', () => {
    const settled = play(notes, hits);
    const batch = grade(notes, hits);
    expect(shape(settled.grader.getResults())).toEqual(shape(batch));
    expect(shape(play(notes, hits, Infinity).grader.getResults())).toEqual(shape(batch));
    expect(shape(settled.grader.stop().results)).toEqual(shape(batch));
  });

  it('very sloppy playing (±50 ms on 16ths 125 ms apart): settled verdicts can differ from a whole-song regrade on a few notes, never on accuracy', () => {
    // The alignment scores timing consistency along the whole hi-hat run, so in a near-tie much
    // later playing can tip an early reading. Settled verdicts are final instead.
    const sloppy = perform(notes, 100);
    const live = play(notes, sloppy).grader.getResults();
    const batch = grade(notes, sloppy);
    const differ = live.notes.filter((r, i) => {
      const b = batch.notes[i]!;
      return r.status !== b.status || (r.status !== 'missed' && b.status !== 'missed' && r.hit !== b.hit);
    }).length;
    expect(differ).toBeLessThan(notes.length * 0.01);
    expect(summarize(live).accuracy).toBe(summarize(batch).accuracy);
  });

  it('reports every missed note exactly once, settled or not', () => {
    let listener: ((hit: Hit) => void) | null = null;
    const stream: HitStream = { onHit: (l) => ((listener = l), () => (listener = null)) };
    let now = 0;
    const grader = new LiveGrader(stream, notes.slice(0, 200), { autoCheck: false, now: () => now, settleMs: 0 });
    const missed: string[] = [];
    grader.onEvent((e) => e.type === 'missed' && missed.push(e.note.id));
    grader.start();
    // No hits at all, and only one check long after the end: every note is settled and reported.
    now = 100_000;
    grader.check(now);
    expect(listener).not.toBeNull();
    expect(missed).toHaveLength(200);
    expect(new Set(missed).size).toBe(200);
  });
});
