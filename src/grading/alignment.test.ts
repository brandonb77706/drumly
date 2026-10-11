import { describe, expect, it } from 'vitest';
import type { Hit, Pad } from '../input';
import { alignInOrder, grade } from './match';
import { ANY_HIHAT, type ExpectedNote, type MatchedNoteResult, type NoteResult } from './types';

const note = (id: string, pad: Pad, time: number): ExpectedNote => ({ id, pad, time });
const hit = (pad: Pad, time: number): Hit => ({ pad, time, velocity: 100, source: 'test' });
const matched = (rs: readonly NoteResult[]) => rs.filter((r): r is MatchedNoteResult => r.status !== 'missed');

/** Deterministic PRNG (mulberry32). */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('step 3b: order-preserving same-pad matching', () => {
  it('reproduction: notes 0 and 100, hits 55 and 160 are both late hits, no extras', () => {
    const r = grade([note('a', 'snare', 0), note('b', 'snare', 100)], [hit('snare', 55), hit('snare', 160)]);
    expect(r.notes.map((n) => n.status)).toEqual(['hit', 'hit']);
    expect(matched(r.notes).map((n) => n.offsetMs)).toEqual([55, 60]);
    expect(r.extras).toEqual([]);
  });

  it('consistently early version: notes 0 and 100, hits -55 and 40', () => {
    const r = grade([note('a', 'snare', 0), note('b', 'snare', 100)], [hit('snare', -55), hit('snare', 40)]);
    expect(r.notes.map((n) => n.status)).toEqual(['hit', 'hit']);
    expect(matched(r.notes).map((n) => n.offsetMs)).toEqual([-55, -60]);
    expect(r.extras).toEqual([]);
  });

  const run16 = Array.from({ length: 8 }, (_, i) => note(`s${i}`, 'snare', i * 100));

  it('16th run of 8 snares, every hit 55 ms late: 8 hits, 0 extras', () => {
    const r = grade(run16, run16.map((n) => hit('snare', n.time + 55)));
    expect(r.notes.map((n) => n.status)).toEqual(Array(8).fill('hit'));
    expect(matched(r.notes).map((n) => n.offsetMs)).toEqual(Array(8).fill(55));
    expect(r.extras).toEqual([]);
  });

  it('same run with the 4th hit removed: exactly that note missed, neighbours keep their own hits', () => {
    const hits = run16.filter((_, i) => i !== 3).map((n) => hit('snare', n.time + 55));
    const r = grade(run16, hits);
    expect(r.notes.map((n) => n.status)).toEqual(['hit', 'hit', 'hit', 'missed', 'hit', 'hit', 'hit', 'hit']);
    expect(r.extras).toEqual([]);
    for (const m of matched(r.notes)) expect(m.offsetMs).toBe(55); // every note got its own hit
  });

  it('a missing hit in the middle of a consistently early run is found too', () => {
    const hits = run16.filter((_, i) => i !== 5).map((n) => hit('snare', n.time - 60));
    const r = grade(run16, hits);
    expect(r.notes.map((n) => n.status)).toEqual(['hit', 'hit', 'hit', 'hit', 'hit', 'missed', 'hit', 'hit']);
    for (const m of matched(r.notes)) expect(m.offsetMs).toBe(-60);
  });

  it('one lone note still takes the closest hit', () => {
    const r = grade([note('a', 'snare', 1000)], [hit('snare', 1040), hit('snare', 990)]);
    expect(matched(r.notes)[0]!.offsetMs).toBe(-10);
  });

  it('applies per pad group: an "any hi-hat" group aligns closed and open together in order', () => {
    const notes = [note('a', 'hihatClosed', 0), note('b', 'hihatOpen', 100)];
    const r = grade(notes, [hit('hihatOpen', 55), hit('hihatClosed', 160)], { equivalentPads: [ANY_HIHAT] });
    expect(r.notes.map((n) => n.status)).toEqual(['hit', 'hit']);
    expect(matched(r.notes).map((n) => n.offsetMs)).toEqual([55, 60]);
  });

  it('merges overlapping equivalence groups (closure)', () => {
    const r = grade([note('a', 'snare', 0)], [hit('crossStick', 0)], { equivalentPads: [['snare', 'snareRim'], ['snareRim', 'crossStick']] });
    expect(r.notes[0]!.status).toBe('hit');
  });
});

describe('alignment properties (seeded random)', () => {
  /** Random note grid and a noisy performance with dropped and extra hits. */
  function randomCase(random: () => number) {
    const notes: number[] = [];
    let t = 0;
    const count = 1 + Math.floor(random() * 10);
    for (let k = 0; k < count; k++) {
      t += 50 + Math.floor(random() * 250);
      notes.push(t);
    }
    const bias = (random() - 0.5) * 140;
    const hits: number[] = [];
    for (const n of notes) {
      if (random() < 0.15) continue; // dropped
      hits.push(n + bias + (random() - 0.5) * 40);
      if (random() < 0.1) hits.push(n + (random() - 0.5) * 200); // stray extra
    }
    hits.sort((a, b) => a - b);
    return { notes, hits };
  }

  it('matched hits are always in the same order as their notes', () => {
    const random = rng(42);
    for (let trial = 0; trial < 500; trial++) {
      const { notes, hits } = randomCase(random);
      const r = grade(notes.map((t, i) => note(`n${i}`, 'snare', t)), hits.map((t) => hit('snare', t)));
      const m = matched(r.notes); // notes come back in time order
      for (let k = 1; k < m.length; k++) expect(m[k]!.hit.time).toBeGreaterThanOrEqual(m[k - 1]!.hit.time);
      for (const x of m) expect(Math.abs(x.offsetMs)).toBeLessThanOrEqual(100);
    }
  });

  /** Exhaustive search: best non-crossing chain by (length desc, consistency cost asc). */
  function bruteForce(notes: number[], hits: number[], w: number): { length: number; cost: number; maxAnyMatching: number } {
    let best = { length: 0, cost: 0 };
    const visit = (chain: [number, number][], cost: number) => {
      if (chain.length > best.length || (chain.length === best.length && cost < best.cost - 1e-9)) best = { length: chain.length, cost };
      const last = chain.at(-1);
      for (let i = last ? last[0] + 1 : 0; i < notes.length; i++) {
        for (let j = last ? last[1] + 1 : 0; j < hits.length; j++) {
          const off = hits[j]! - notes[i]!;
          if (Math.abs(off) > w) continue;
          const step = last && last[0] === i - 1 ? Math.abs(off - (hits[last[1]]! - notes[last[0]]!)) : Math.abs(off);
          visit([...chain, [i, j]], cost + step);
        }
      }
    };
    visit([], 0);
    // Largest matching of any shape (crossing allowed), to show non-crossing loses no matches.
    let maxAny = 0;
    const used = new Array<boolean>(hits.length).fill(false);
    const anyMatch = (i: number, size: number) => {
      if (i === notes.length) {
        maxAny = Math.max(maxAny, size);
        return;
      }
      anyMatch(i + 1, size);
      for (let j = 0; j < hits.length; j++) {
        if (!used[j] && Math.abs(hits[j]! - notes[i]!) <= w) {
          used[j] = true;
          anyMatch(i + 1, size + 1);
          used[j] = false;
        }
      }
    };
    anyMatch(0, 0);
    return { ...best, maxAnyMatching: maxAny };
  }

  it('finds the optimal chain and never matches fewer notes than any (even crossing) matching', () => {
    const random = rng(7);
    let checked = 0;
    for (let trial = 0; trial < 300; trial++) {
      const { notes, hits } = randomCase(random);
      if (notes.length > 6 || hits.length > 7) continue;
      const pairs = alignInOrder(notes, hits, 100);
      let cost = 0;
      pairs.forEach(([i, j], k) => {
        const off = hits[j]! - notes[i]!;
        const prev = pairs[k - 1];
        cost += prev && prev[0] === i - 1 ? Math.abs(off - (hits[prev[1]]! - notes[prev[0]]!)) : Math.abs(off);
      });
      const best = bruteForce(notes, hits, 100);
      expect(pairs.length).toBe(best.length);
      expect(pairs.length).toBe(best.maxAnyMatching);
      expect(cost).toBeCloseTo(best.cost, 6);
      checked++;
    }
    expect(checked).toBeGreaterThan(100);
  });

  it('stays fast on a long dense song (16ths for ~10 minutes)', () => {
    const random = rng(99);
    const notes: ExpectedNote[] = [];
    const hits: Hit[] = [];
    for (let k = 0; k < 6000; k++) {
      const t = k * 100;
      notes.push(note(`n${k}`, 'snare', t));
      if (random() > 0.05) hits.push(hit('snare', t + 40 + (random() - 0.5) * 30));
    }
    const started = performance.now();
    const r = grade(notes, hits);
    const elapsed = performance.now() - started;
    expect(r.extras).toHaveLength(0);
    expect(elapsed).toBeLessThan(1000);
  });
});
