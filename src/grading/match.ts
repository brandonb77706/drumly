import type { Hit, Pad } from '../input';
import { gradeTiming } from './timingGrade';
import {
  resolveConfig,
  type ExpectedNote,
  type ExtraHit,
  type GradeResult,
  type GradingConfig,
  type NoteResult,
} from './types';

/**
 * Key identifying a pad's equivalence group. Groups that share a pad are merged
 * (transitive closure), so "same group" is a proper equivalence relation.
 */
export function padGroupKey(pad: Pad, groups: GradingConfig['equivalentPads'] = []): string {
  const parent = new Map<Pad, Pad>();
  const find = (p: Pad): Pad => {
    let root = p;
    while (parent.has(root) && parent.get(root) !== root) root = parent.get(root)!;
    return root;
  };
  for (const group of groups) {
    const [first, ...rest] = group;
    if (first === undefined) continue;
    if (!parent.has(first)) parent.set(first, first);
    for (const p of rest) {
      if (!parent.has(p)) parent.set(p, p);
      const a = find(first);
      const b = find(p);
      if (a !== b) parent.set(b < a ? a : b, b < a ? b : a); // smaller name becomes the root: deterministic
    }
  }
  return find(pad);
}

/** True if a hit on `hitPad` counts as the right pad for a note on `notePad`. */
export function padsEquivalent(notePad: Pad, hitPad: Pad, groups: GradingConfig['equivalentPads'] = []): boolean {
  return notePad === hitPad || padGroupKey(notePad, groups) === padGroupKey(hitPad, groups);
}

/**
 * Match played hits to expected notes. Pure and deterministic.
 *
 * Algorithm:
 * 1. Sort notes and hits by time (ties keep input order).
 * 2. Same-pad pass, per pad group (pads joined by `equivalentPads` form one group):
 *    an order-preserving alignment of the group's notes with the group's hits. Only pairs
 *    with |offset| <= windowMs can match, and matched pairs can never cross: if note A is
 *    before note B on the same pad, A's hit is before B's hit. Among non-crossing matchings:
 *    a. match as many notes as possible (fewest missed notes + extra hits), then
 *    b. be as consistent as possible: each matched note costs |offset - previous note's
 *       offset| when the previous note in the group is also matched, and |offset| when it
 *       starts a run (first note, or right after a missed note).
 *    Ties: the earlier note, then the earlier hit, wins.
 *
 *    Why not greedy: "closest pair first" lets a hit jump past an earlier note. Notes at
 *    0 and 100, player 55 ms late (hits 55 and 160): greedy takes (100, 55) at 45 ms first,
 *    stranding note 0 (missed) and hit 160 (extra). Alignment matches 0->55 and 100->160.
 *
 *    Why consistency rather than total |offset| for (b): players are usually consistently
 *    early or late. Eight 16ths 100 ms apart, every hit 55 ms late, 4th hit missing: the
 *    smallest total |offset| (355 ms) misses the *first* note and reads notes 2-4 as 45 ms
 *    early; the intended reading (4th note missed, every hit +55) totals 385 ms. Scoring
 *    changes in offset between neighbours picks the intended reading (110 vs 145). For a
 *    single isolated note it reduces to "closest hit wins".
 *
 *    Implemented as a longest-chain DP over the in-window (note, hit) pairs (see
 *    alignInOrder), so the cost grows with the number of in-window pairs, not notes x hits.
 * 3. Wrong-pad pass: collect remaining (note, hit) pairs inside the window whose pads
 *    differ, sort by distance (ties: earlier note, then earlier hit) and accept each pair
 *    whose note and hit are both still free. Step 2 leaves no free same-pad pair inside
 *    the window, so a note only becomes wrongPad when no same-pad hit was available.
 * 4. Notes still free are missed; hits still free are extra.
 * Each note gets at most one hit and each hit at most one note.
 */
export function grade(notes: readonly ExpectedNote[], hits: readonly Hit[], config: Partial<GradingConfig> = {}): GradeResult {
  const cfg = resolveConfig(config);
  const sortedNotes = stableSortByTime(notes);
  const sortedHits = stableSortByTime(hits);

  const hitForNote = new Array<number>(sortedNotes.length).fill(-1);
  const hitTaken = new Array<boolean>(sortedHits.length).fill(false);
  const wrongPad = new Array<boolean>(sortedNotes.length).fill(false);

  // Step 2: same-pad alignment per pad group.
  const keyCache = new Map<Pad, string>();
  const keyOf = (pad: Pad) => {
    let key = keyCache.get(pad);
    if (key === undefined) keyCache.set(pad, (key = padGroupKey(pad, cfg.equivalentPads)));
    return key;
  };
  const groups = new Map<string, { notes: number[]; hits: number[] }>();
  const groupFor = (key: string) => {
    let g = groups.get(key);
    if (!g) groups.set(key, (g = { notes: [], hits: [] }));
    return g;
  };
  sortedNotes.forEach((note, n) => groupFor(keyOf(note.pad)).notes.push(n));
  sortedHits.forEach((hit, h) => groupFor(keyOf(hit.pad)).hits.push(h));

  for (const group of groups.values()) {
    if (group.notes.length === 0 || group.hits.length === 0) continue;
    const pairs = alignInOrder(
      group.notes.map((n) => sortedNotes[n]!.time),
      group.hits.map((h) => sortedHits[h]!.time),
      cfg.windowMs,
    );
    for (const [i, j] of pairs) {
      const n = group.notes[i]!;
      const h = group.hits[j]!;
      hitForNote[n] = h;
      hitTaken[h] = true;
    }
  }

  // Step 3: wrong-pad greedy pass over what's left.
  const leftovers = collectCandidates(sortedNotes, sortedHits, cfg.windowMs).filter(
    (c) => hitForNote[c.n] === -1 && !hitTaken[c.h] && keyOf(sortedNotes[c.n]!.pad) !== keyOf(sortedHits[c.h]!.pad),
  );
  leftovers.sort((a, b) => a.distance - b.distance || a.n - b.n || a.h - b.h);
  for (const { n, h } of leftovers) {
    if (hitForNote[n] !== -1 || hitTaken[h]) continue;
    hitForNote[n] = h;
    hitTaken[h] = true;
    wrongPad[n] = true;
  }

  // Step 4: build results.
  const noteResults: NoteResult[] = sortedNotes.map((note, n) => {
    const h = hitForNote[n]!;
    if (h === -1) return { note, status: 'missed' };
    const hit = sortedHits[h]!;
    const offsetMs = hit.time - note.time;
    return {
      note,
      status: wrongPad[n] ? 'wrongPad' : 'hit',
      hit,
      offsetMs,
      timing: gradeTiming(offsetMs, cfg.timing),
    };
  });

  const extras: ExtraHit[] = [];
  sortedHits.forEach((hit, h) => {
    if (!hitTaken[h]) extras.push({ hit, status: 'extra' });
  });

  return { notes: noteResults, extras };
}

/** Tolerance for treating two costs as tied (float sums of the same values in a different order). */
const TIE_EPSILON = 1e-9;

/**
 * Order-preserving alignment of sorted note times with sorted hit times. Returns
 * [noteIndex, hitIndex] pairs (0-based), in order. See grade() for the objective.
 *
 * A matching is a chain of in-window pairs p1, p2, ... with strictly increasing note and
 * hit indices. Each pair's cost depends only on its predecessor in the chain:
 * - predecessor on the previous note (i - 1): |offset - predecessor offset|
 * - no predecessor, or predecessor further back (a note was missed): |offset|
 * So best[p] = (longest chain ending at p, then lowest cost), computed in note order:
 * - predecessors on note i - 1: scanned directly (only the few hits in its window);
 * - predecessors on notes <= i - 2: their transition cost doesn't depend on which one,
 *   so we only need the best chain among pairs with hit index < j. A Fenwick tree over
 *   hit indices answers that prefix query.
 * Total cost: O(P log M + sum over notes of (pairs per note)^2), P = number of in-window pairs.
 */
export function alignInOrder(noteTimes: readonly number[], hitTimes: readonly number[], windowMs: number): [number, number][] {
  const N = noteTimes.length;
  const M = hitTimes.length;
  if (N === 0 || M === 0) return [];

  // In-window pairs, grouped by note (rowStart[i]..rowStart[i+1]-1), hits ascending in each row.
  const pairNote: number[] = [];
  const pairHit: number[] = [];
  const pairOffset: number[] = [];
  const rowStart: number[] = [];
  let lo = 0;
  for (let i = 0; i < N; i++) {
    const t = noteTimes[i]!;
    rowStart.push(pairNote.length);
    while (lo < M && hitTimes[lo]! < t - windowMs) lo++;
    for (let j = lo; j < M && hitTimes[j]! <= t + windowMs; j++) {
      pairNote.push(i);
      pairHit.push(j);
      pairOffset.push(hitTimes[j]! - t);
    }
  }
  rowStart.push(pairNote.length);

  const P = pairNote.length;
  const chainLength = new Int32Array(P);
  const chainCost = new Float64Array(P);
  const prev = new Int32Array(P).fill(-1);

  /** Is chain `a` (with this length/cost, ending at pair a) better than chain `b`? Ties: earlier pair wins. */
  const better = (lenA: number, costA: number, a: number, lenB: number, costB: number, b: number): boolean => {
    if (lenA !== lenB) return lenA > lenB;
    if (Math.abs(costA - costB) > TIE_EPSILON) return costA < costB;
    return pairNote[a]! !== pairNote[b]! ? pairNote[a]! < pairNote[b]! : pairHit[a]! < pairHit[b]!;
  };
  const betterPair = (a: number, b: number) => b === -1 || better(chainLength[a]!, chainCost[a]!, a, chainLength[b]!, chainCost[b]!, b);

  // Fenwick tree over hit indices holding the best chain end among pairs on notes <= i - 2.
  const tree = new Int32Array(M + 1).fill(-1);
  const treeInsert = (p: number) => {
    for (let k = pairHit[p]! + 1; k <= M; k += k & -k) if (betterPair(p, tree[k]!)) tree[k] = p;
  };
  const treeBestBefore = (j: number): number => {
    let best = -1;
    for (let k = j; k > 0; k -= k & -k) {
      const q = tree[k]!;
      if (q !== -1 && betterPair(q, best)) best = q;
    }
    return best;
  };

  for (let i = 0; i < N; i++) {
    if (i >= 2) for (let q = rowStart[i - 2]!; q < rowStart[i - 1]!; q++) treeInsert(q);

    for (let p = rowStart[i]!; p < rowStart[i + 1]!; p++) {
      const j = pairHit[p]!;
      const off = pairOffset[p]!;

      // Start a run here (no predecessor).
      let bestLen = 1;
      let bestCost = Math.abs(off);
      let bestPrev = -1;
      const consider = (q: number, cost: number) => {
        const len = chainLength[q]! + 1;
        // Compare as if both chains ended at p; on ties prefer the earlier predecessor.
        if (len > bestLen || (len === bestLen && cost < bestCost - TIE_EPSILON) ||
          (len === bestLen && Math.abs(cost - bestCost) <= TIE_EPSILON && bestPrev !== -1 &&
            (pairNote[q]! < pairNote[bestPrev]! || (pairNote[q]! === pairNote[bestPrev]! && pairHit[q]! < pairHit[bestPrev]!)))) {
          bestLen = len;
          bestCost = cost;
          bestPrev = q;
        }
      };

      // Predecessor further back (a missed note in between): restart cost |offset|.
      const far = treeBestBefore(j);
      if (far !== -1) consider(far, chainCost[far]! + Math.abs(off));

      // Predecessor on the previous note: consistency cost.
      if (i >= 1) {
        for (let q = rowStart[i - 1]!; q < rowStart[i]! && pairHit[q]! < j; q++) {
          consider(q, chainCost[q]! + Math.abs(off - pairOffset[q]!));
        }
      }

      chainLength[p] = bestLen;
      chainCost[p] = bestCost;
      prev[p] = bestPrev;
    }
  }

  let end = -1;
  for (let p = 0; p < P; p++) if (betterPair(p, end)) end = p;
  const pairs: [number, number][] = [];
  for (let p = end; p !== -1; p = prev[p]!) pairs.push([pairNote[p]!, pairHit[p]!]);
  return pairs.reverse();
}

interface Candidate {
  /** Index into the time-sorted notes. */
  n: number;
  /** Index into the time-sorted hits. */
  h: number;
  /** |hit.time - note.time| */
  distance: number;
}

function stableSortByTime<T extends { time: number }>(items: readonly T[]): T[] {
  return items
    .map((item, i) => ({ item, i }))
    .sort((a, b) => a.item.time - b.item.time || a.i - b.i)
    .map(({ item }) => item);
}

function collectCandidates(notes: readonly ExpectedNote[], hits: readonly Hit[], windowMs: number): Candidate[] {
  const out: Candidate[] = [];
  let first = 0;
  for (let n = 0; n < notes.length; n++) {
    const t = notes[n]!.time;
    while (first < hits.length && hits[first]!.time < t - windowMs) first++;
    for (let h = first; h < hits.length && hits[h]!.time <= t + windowMs; h++) {
      out.push({ n, h, distance: Math.abs(hits[h]!.time - t) });
    }
  }
  return out;
}
