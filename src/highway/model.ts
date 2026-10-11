import type { Hit, Pad } from '../input';
import type { ExpectedNote, GradeResult, HitVerdict, TimingGrade } from '../grading';
import { lessonToExpectedNotes, noteIndex, notePass, type ClickTime, type Lesson, type LessonPosition } from '../lessons';
import { lanesForLesson, laneForPad } from './layout';

/** What a note on the highway currently shows. */
export type NoteState = 'pending' | TimingGrade | 'wrongPad' | 'missed';

export interface HighwayNote {
  readonly id: string;
  /** Index into lesson.notes (-1 if unknown). */
  readonly lessonIndex: number;
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
  /** Drawn outlined: a pass the app plays (a "Listen" turn, or the correct side of a replay). */
  readonly outlined: boolean;
}

/** How one pass is drawn: a label at its first downbeat, and whether its notes are outlined. */
export interface PassStyle {
  readonly label: string | null;
  readonly outlined: boolean;
}

/** A pass label ("Listen", "Your turn") at the pass's first downbeat. */
export interface TurnMark {
  readonly pass: number;
  readonly label: string;
  time: number;
}

export type GridLineKind = 'bar' | 'beat' | 'countIn';

export interface GridLine {
  /** Metronome click index, stable for a run. */
  readonly index: number;
  readonly kind: GridLineKind;
  time: number;
}

/** A hit drawn as a tick at its real time, in the lane of the pad actually played. */
export interface HitTick {
  readonly hit: Hit;
  /** Lane index, or -1 for the "other" lane. */
  lane: number;
  /** The matched note's state, or 'extra'. */
  state: NoteState | 'extra';
}

/** The focus range of one pass, for shading. */
export interface FocusRegion {
  readonly pass: number;
  /** Time of the focus start and end positions. */
  start: number;
  end: number;
  /** Half a grid step, so shading covers the first and last notes fully. */
  padMs: number;
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
  /** Lanes to show instead of the lesson's own pads (e.g. a full kit while recording). */
  lanes?: readonly Pad[];
  /** Per-pass style. Default: no label, filled notes. Outlined passes get no focus shading (they aren't graded). */
  passStyle?: (pass: number) => PassStyle;
  /** Label drawn on the focus range. Default "graded". */
  focusLabel?: string;
}

const PLAIN: PassStyle = { label: null, outlined: false };

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
  /** In pass order. */
  readonly focusRegions: FocusRegion[] = [];
  /** In pass order. */
  readonly turnMarks: TurnMark[] = [];
  /** Becomes true once a hit lands on a pad with no lane; the "other" lane is shown from then on. */
  hasOtherLane = false;
  /** Label drawn on the focus range. */
  readonly focusLabel: string;

  private readonly passes: number;
  private readonly pastMs: number;
  private readonly futureMs: number;
  private readonly refreshMs: number;
  private readonly noteById = new Map<string, HighwayNote>();
  private readonly lineByIndex = new Map<number, GridLine>();
  private readonly tickByHit = new Map<Hit, HitTick>();
  /** Which note each hit was last matched to. */
  private readonly noteByHit = new Map<Hit, HighwayNote>();
  private readonly regionByPass = new Map<number, FocusRegion>();
  private readonly markByPass = new Map<number, TurnMark>();
  private readonly passStyle: (pass: number) => PassStyle;
  private highlighted: ReadonlySet<number> = new Set();
  private lastRefresh = -Infinity;
  private keepFrom = -Infinity;

  constructor(
    readonly lesson: Lesson,
    options: HighwayModelOptions = {},
  ) {
    this.lanes = options.lanes ? [...options.lanes] : lanesForLesson(lesson);
    this.passStyle = options.passStyle ?? (() => PLAIN);
    this.passes = options.passes ?? 1;
    this.pastMs = options.pastMs ?? 3000;
    this.futureMs = options.futureMs ?? 2600;
    this.refreshMs = options.refreshMs ?? 200;
    this.focusLabel = options.focusLabel ?? 'graded';
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
    this.updateFocusRegions(clicks);
    this.updateTurnMarks(clicks);
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

  /** Ring these notes (indices into lesson.notes) while they are still to be played. */
  setHighlights(lessonIndices: Iterable<number>): void {
    this.highlighted = new Set(lessonIndices);
  }

  isHighlighted(note: HighwayNote): boolean {
    return this.highlighted.has(note.lessonIndex);
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

    // The tick goes where the player actually hit; for a wrong pad that's not the note's lane.
    tick.lane = this.laneOf(hit.pad);
    if (tick.lane < 0) this.hasOtherLane = true;
    if (verdict.status === 'extra') {
      tick.state = 'extra';
      return;
    }
    const note = this.noteById.get(verdict.note.id) ?? this.addNote(verdict.note);
    note.hit = hit;
    note.state = verdict.status === 'wrongPad' ? 'wrongPad' : verdict.timing;
    this.noteByHit.set(hit, note);
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

  /** The style of the pass a note id belongs to. */
  styleOf(pass: number): PassStyle {
    return this.passStyle(pass);
  }

  private addNote(expected: ExpectedNote): HighwayNote {
    const note: HighwayNote = {
      outlined: this.passStyle(notePass(expected.id) ?? 0).outlined,
      id: expected.id,
      lessonIndex: noteIndex(expected.id) ?? -1,
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

  /** Find the clicks at the focus start and end positions of each pass. */
  private updateFocusRegions(clicks: readonly HighwayClick[]): void {
    const focus = this.lesson.focus;
    if (!focus) return;
    const bars = this.lesson.bars;
    clicks.forEach((click, i) => {
      if (click.isCountIn || click.bar < 0) return;
      const pass = Math.floor(click.bar / bars);
      if (pass >= this.passes || this.passStyle(pass).outlined) return;
      const position = { bar: click.bar % bars, beat: click.beat, subdivision: click.subdivision };
      const isStart = samePosition(position, focus.start);
      const isEnd = samePosition(position, focus.end);
      if (!isStart && !isEnd) return;
      let region = this.regionByPass.get(pass);
      if (!region) {
        region = { pass, start: NaN, end: NaN, padMs: 0 };
        this.regionByPass.set(pass, region);
        this.focusRegions.push(region);
        this.focusRegions.sort((a, b) => a.pass - b.pass);
      }
      if (isStart) {
        region.start = click.time;
        const next = clicks[i + 1];
        if (next) region.padMs = (next.time - click.time) / 2;
      }
      if (isEnd) region.end = click.time;
    });
  }

  /** A label at the first downbeat of each pass whose style has one. */
  private updateTurnMarks(clicks: readonly HighwayClick[]): void {
    const bars = this.lesson.bars;
    for (const click of clicks) {
      if (click.isCountIn || click.bar < 0 || click.bar % bars !== 0 || click.beat !== 0 || click.subdivision !== 0) continue;
      const pass = click.bar / bars;
      if (pass >= this.passes) continue;
      const mark = this.markByPass.get(pass);
      if (mark) {
        mark.time = click.time;
        continue;
      }
      const label = this.passStyle(pass).label;
      if (label === null) continue;
      const created: TurnMark = { pass, label, time: click.time };
      this.markByPass.set(pass, created);
      this.turnMarks.push(created);
      this.turnMarks.sort((a, b) => a.pass - b.pass);
    }
  }

  private prune(): void {
    const keepFrom = this.keepFrom;
    // A label stays while its pass is on screen: drop it once the next one has scrolled past too.
    removeWhere(this.turnMarks, (m) => (this.markByPass.get(m.pass + 1)?.time ?? Infinity) < keepFrom, (m) => this.markByPass.delete(m.pass));
    removeWhere(this.focusRegions, (r) => r.end < keepFrom, (r) => this.regionByPass.delete(r.pass));
    removeWhere(this.notes, (n) => n.time < keepFrom, (n) => this.noteById.delete(n.id));
    removeWhere(this.lines, (l) => l.time < keepFrom, (l) => this.lineByIndex.delete(l.index));
    removeWhere(this.ticks, (t) => t.hit.time < keepFrom, (t) => {
      this.tickByHit.delete(t.hit);
      this.noteByHit.delete(t.hit);
    });
  }
}

function samePosition(a: LessonPosition, b: LessonPosition): boolean {
  return a.bar === b.bar && a.beat === b.beat && a.subdivision === b.subdivision;
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
