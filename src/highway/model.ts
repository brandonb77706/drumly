import type { Hit, Pad } from '../input';
import type { ExpectedNote, GradeResult, HitVerdict, TimingGrade } from '../grading';
import { lessonToExpectedNotes, type ClickTime, type Lesson } from '../lessons';
import { lanesForLesson, laneForPad } from './layout';

/** What a note on the highway currently shows. */
export type NoteState = 'pending' | TimingGrade | 'wrongPad' | 'missed';

export interface HighwayNote {
  readonly id: string;
  readonly pad: Pad;
  readonly lane: number;
  readonly accent: boolean;
  /** ms on the performance.now() clock. Updated if the metronome grid moves. */
  time: number;
  state: NoteState;
  /** The hit currently matched to this note. */
  hit: Hit | null;
  /** The grader reported this note missed at some point. */
  missedReported: boolean;
  /** Set once the note has crossed the now line (see takePassed). */
  passed: boolean;
}

export type GridLineKind = 'bar' | 'beat' | 'countIn';

export interface GridLine {
  /** Metronome click index, stable for a run. */
  readonly index: number;
  readonly kind: GridLineKind;
  time: number;
}

/** A hit drawn as a tick at its real time. */
export interface HitTick {
  readonly hit: Hit;
  /** Lane index, or -1 for the "other" strip. */
  lane: number;
  /** The matched note's state, or 'extra'. */
  state: NoteState | 'extra';
}

/** A metronome click as the highway needs it. MetronomeClick satisfies this. */
export interface HighwayClick extends ClickTime {
  readonly index: number;
}

export type GridSource = (fromTime: number, toTime: number) => readonly HighwayClick[];

/** Notes with a target velocity at or above this are drawn as accents. */
export const ACCENT_VELOCITY = 110;

export interface HighwayModelOptions {
  /** 1 (default) for a single run, Infinity for loop mode. */
  passes?: number;
  /** Keep notes, lines and ticks this long after they pass, ms. Default 3000. */
  pastMs?: number;
  /** Fetch this far ahead, ms. Must exceed what the view shows. Default 2600. */
  futureMs?: number;
  /** Minimum time between grid reads, ms. Default 200. */
  refreshMs?: number;
}

/**
 * Everything the highway draws, as plain mutable records allocated once per note/hit, so the
 * renderer allocates nothing per frame.
 *
 * Notes and grid lines come from the metronome's own click times. The grid is re-read every
 * `refreshMs` (not every frame) and records are updated in place by id / click index, so if the
 * clock reference shifts or the tempo changes, notes already on screen move with the grid.
 */
export class HighwayModel {
  readonly lanes: readonly Pad[];
  /** In time order. */
  readonly notes: HighwayNote[] = [];
  /** In time order. */
  readonly lines: GridLine[] = [];
  readonly ticks: HitTick[] = [];

  private readonly passes: number;
  private readonly pastMs: number;
  private readonly futureMs: number;
  private readonly refreshMs: number;
  private readonly noteById = new Map<string, HighwayNote>();
  private readonly lineByIndex = new Map<number, GridLine>();
  private readonly tickByHit = new Map<Hit, HitTick>();
  /** Which note each hit was last matched to. */
  private readonly noteByHit = new Map<Hit, HighwayNote>();
  private lastRefresh = -Infinity;
  private keepFrom = -Infinity;

  constructor(
    readonly lesson: Lesson,
    options: HighwayModelOptions = {},
  ) {
    this.lanes = lanesForLesson(lesson);
    this.passes = options.passes ?? 1;
    this.pastMs = options.pastMs ?? 3000;
    this.futureMs = options.futureMs ?? 2600;
    this.refreshMs = options.refreshMs ?? 200;
  }

  laneOf(pad: Pad): number {
    return laneForPad(pad, this.lanes, this.lesson.equivalentPads);
  }

  /**
   * Re-read the grid around `now` if `refreshMs` has passed since the last read (or `force`).
   * Returns true if it read the grid.
   */
  refresh(now: number, getGrid: GridSource, force = false): boolean {
    if (!force && now - this.lastRefresh < this.refreshMs) return false;
    this.lastRefresh = now;
    this.keepFrom = now - this.pastMs;
    const clicks = getGrid(this.keepFrom, now + this.futureMs);

    for (const click of clicks) {
      if (click.subdivision !== 0) continue;
      const line = this.lineByIndex.get(click.index);
      if (line) line.time = click.time;
      else {
        const kind: GridLineKind = click.isCountIn ? 'countIn' : click.beat === 0 ? 'bar' : 'beat';
        const created: GridLine = { index: click.index, kind, time: click.time };
        this.lineByIndex.set(click.index, created);
        this.lines.push(created);
      }
    }
    for (const expected of lessonToExpectedNotes(this.lesson, clicks, { passes: this.passes })) {
      const note = this.noteById.get(expected.id);
      if (note) note.time = expected.time;
      else this.addNote(expected);
    }

    this.prune();
    this.lines.sort(byTime);
    this.notes.sort(byTime);
    return true;
  }

  /** Apply a grader verdict for a hit (from a 'hit' or 'revised' event). */
  applyVerdict(hit: Hit, verdict: HitVerdict): void {
    // A revised hit gives up its old note, unless a newer hit already took that note
    // (the grader reports the newer hit first).
    const previous = this.noteByHit.get(hit);
    if (previous && previous.hit === hit) {
      previous.hit = null;
      previous.state = previous.missedReported ? 'missed' : 'pending';
    }
    this.noteByHit.delete(hit);

    let tick = this.tickByHit.get(hit);
    if (!tick) {
      tick = { hit, lane: -1, state: 'extra' };
      this.tickByHit.set(hit, tick);
      this.ticks.push(tick);
    }

    if (verdict.status === 'extra') {
      tick.lane = this.laneOf(hit.pad);
      tick.state = 'extra';
      return;
    }
    const note = this.noteById.get(verdict.note.id) ?? this.addNote(verdict.note);
    note.hit = hit;
    note.state = verdict.status === 'wrongPad' ? 'wrongPad' : verdict.timing;
    this.noteByHit.set(hit, note);
    tick.lane = note.lane;
    tick.state = note.state;
  }

  /** The grader reported a note missed. */
  markMissed(expected: ExpectedNote): void {
    const note = this.noteById.get(expected.id);
    if (!note) return;
    note.missedReported = true;
    if (!note.hit) note.state = 'missed';
  }

  /** Replace all feedback with a final grade (e.g. the batch grade when a run ends). */
  syncResults(results: GradeResult): void {
    for (const note of this.notes) {
      note.hit = null;
      note.state = 'pending';
    }
    this.noteByHit.clear();
    this.tickByHit.clear();
    this.ticks.length = 0;
    for (const r of results.notes) {
      const note = this.noteById.get(r.note.id);
      if (!note) continue;
      if (r.status === 'missed') {
        note.missedReported = true;
        note.state = 'missed';
      } else {
        this.applyVerdict(r.hit, r);
      }
    }
    for (const e of results.extras) {
      if (e.hit.time >= this.keepFrom) this.applyVerdict(e.hit, e);
    }
  }

  /** Call `onPassed` once for each note that has reached the now line since the last call. */
  takePassed(now: number, onPassed: (note: HighwayNote) => void): void {
    for (const note of this.notes) {
      if (note.time > now) break; // time order
      if (note.passed) continue;
      note.passed = true;
      onPassed(note);
    }
  }

  private addNote(expected: ExpectedNote): HighwayNote {
    const note: HighwayNote = {
      id: expected.id,
      pad: expected.pad,
      lane: this.laneOf(expected.pad),
      accent: (expected.velocity ?? 0) >= ACCENT_VELOCITY,
      time: expected.time,
      state: 'pending',
      hit: null,
      missedReported: false,
      passed: false,
    };
    this.noteById.set(note.id, note);
    this.notes.push(note);
    return note;
  }

  private prune(): void {
    const keepFrom = this.keepFrom;
    removeWhere(this.notes, (n) => n.time < keepFrom, (n) => this.noteById.delete(n.id));
    removeWhere(this.lines, (l) => l.time < keepFrom, (l) => this.lineByIndex.delete(l.index));
    removeWhere(this.ticks, (t) => t.hit.time < keepFrom, (t) => {
      this.tickByHit.delete(t.hit);
      this.noteByHit.delete(t.hit);
    });
  }
}

function byTime(a: { time: number }, b: { time: number }): number {
  return a.time - b.time;
}

/** Remove matching items in place, calling `onRemove` for each. */
function removeWhere<T>(items: T[], test: (item: T) => boolean, onRemove: (item: T) => void): void {
  let kept = 0;
  for (const item of items) {
    if (test(item)) onRemove(item);
    else items[kept++] = item;
  }
  items.length = kept;
}
