import type { Hit } from '../input';
import { grade } from './match';
import { summarize, type GradeSummary } from './summary';
import {
  resolveConfig,
  type ExpectedNote,
  type GradeResult,
  type GradingConfig,
  type HitVerdict,
} from './types';

/** Anything hits can be subscribed to. InputManager satisfies this. */
export interface HitStream {
  onHit(listener: (hit: Hit) => void): () => void;
}

/**
 * Expected notes: a fixed list, or a function returning the notes with time in [fromTime, toTime)
 * (e.g. derived from the metronome grid). Function results must use stable ids.
 */
export type ExpectedNotesSource = readonly ExpectedNote[] | ((fromTime: number, toTime: number) => readonly ExpectedNote[]);

export type LiveGradeEvent =
  /** A hit arrived; this is its verdict given everything seen so far. */
  | { type: 'hit'; hit: Hit; verdict: HitVerdict }
  /** An earlier hit's verdict changed (e.g. a closer hit took its note). */
  | { type: 'revised'; hit: Hit; verdict: HitVerdict; previous: HitVerdict }
  /** A note's window (plus grace) has fully passed with no hit matched to it. */
  | { type: 'missed'; note: ExpectedNote }
  /** Fixed note list only: every note's window has passed. */
  | { type: 'complete' };

export interface LiveGraderOptions {
  config?: Partial<GradingConfig>;
  /** Hits with time before this are ignored (e.g. playing during the count-in). */
  ignoreHitsBefore?: number;
  /**
   * Extra wait after a note's window closes before calling it missed, ms. Covers hits whose
   * timestamp is inside the window but which are delivered slightly later (MIDI/USB). Default 50.
   */
  missGraceMs?: number;
  /** Run check() on every animation frame. Default true when requestAnimationFrame exists. */
  autoCheck?: boolean;
  /** performance.now() source, for tests. */
  now?: () => number;
}

export interface FinalGrade {
  results: GradeResult;
  summary: GradeSummary;
}

/**
 * Thin live wrapper around the batch grader. Every decision comes from grade(), re-run over
 * all notes and hits seen so far whenever something changes, so live and batch grading of
 * the same hits always agree. Verdicts are emitted immediately and revised if later hits
 * change the matching. Misses are only reported once a note's window has fully passed,
 * checked on requestAnimationFrame (or by calling check() yourself), never with setTimeout.
 */
export class LiveGrader {
  private readonly config: GradingConfig;
  private readonly ignoreHitsBefore: number;
  private readonly missGraceMs: number;
  private readonly autoCheck: boolean;
  private readonly now: () => number;

  private readonly notesById = new Map<string, ExpectedNote>();
  private notes: ExpectedNote[] = [];
  private fetchedUntil = -Infinity;
  private readonly hits: Hit[] = [];
  private current: GradeResult = { notes: [], extras: [] };
  private verdicts = new Map<Hit, HitVerdict>();
  private readonly reportedMissed = new Set<string>();
  private completed = false;

  private readonly listeners = new Set<(event: LiveGradeEvent) => void>();
  private unsubscribeInput: (() => void) | null = null;
  private rafId: number | null = null;
  private running = false;

  constructor(
    private readonly input: HitStream,
    private readonly expected: ExpectedNotesSource,
    options: LiveGraderOptions = {},
  ) {
    this.config = resolveConfig(options.config);
    this.ignoreHitsBefore = options.ignoreHitsBefore ?? -Infinity;
    this.missGraceMs = options.missGraceMs ?? 50;
    this.autoCheck = options.autoCheck ?? typeof requestAnimationFrame === 'function';
    this.now = options.now ?? (() => performance.now());
    if (!isNoteFunction(expected)) this.addNotes(expected);
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    if (isNoteFunction(this.expected)) {
      this.fetchedUntil = Number.isFinite(this.ignoreHitsBefore) ? this.ignoreHitsBefore : this.now() - this.config.windowMs;
    }
    // Grade once up front so notes are tracked (and can be reported missed) even with no hits.
    this.fetchNotesUntil(this.now() + this.config.windowMs);
    this.regrade();
    this.unsubscribeInput = this.input.onHit((hit) => this.handleHit(hit));
    if (this.autoCheck) {
      const loop = () => {
        if (!this.running) return;
        this.check();
        this.rafId = requestAnimationFrame(loop);
      };
      this.rafId = requestAnimationFrame(loop);
    }
  }

  /**
   * Stop listening and return the final grade: the batch grader run over every hit received
   * and every note with time <= `now` (notes not yet due when stopping are left out).
   */
  stop(now = this.now()): FinalGrade {
    this.running = false;
    this.unsubscribeInput?.();
    this.unsubscribeInput = null;
    if (this.rafId !== null && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(this.rafId);
    this.rafId = null;

    this.fetchNotesUntil(now);
    const results = grade(
      this.notes.filter((n) => n.time <= now),
      this.hits,
      this.config,
    );
    return { results, summary: summarize(results) };
  }

  onEvent(listener: (event: LiveGradeEvent) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Current provisional results (all known notes, including ones not due yet). */
  getResults(): GradeResult {
    return this.current;
  }

  /** Report notes whose window has passed as missed. Called every animation frame by default. */
  check(now = this.now()): void {
    if (this.fetchNotesUntil(now + this.config.windowMs)) this.emitRevisions(this.regrade(), null);

    const deadline = now - this.config.windowMs - this.missGraceMs;
    for (const r of this.current.notes) {
      if (r.note.time >= deadline) break; // notes are in time order
      if (r.status === 'missed' && !this.reportedMissed.has(r.note.id)) {
        this.reportedMissed.add(r.note.id);
        this.emit({ type: 'missed', note: r.note });
      }
    }

    if (!this.completed && !isNoteFunction(this.expected)) {
      const last = this.notes.at(-1);
      if (!last || last.time < deadline) {
        this.completed = true;
        this.emit({ type: 'complete' });
      }
    }
  }

  private handleHit(hit: Hit): void {
    if (!this.running || hit.time < this.ignoreHitsBefore) return;
    this.fetchNotesUntil(hit.time + this.config.windowMs);
    this.hits.push(hit);
    const previous = this.regrade();

    const verdict = this.verdicts.get(hit);
    if (verdict) this.emit({ type: 'hit', hit, verdict });
    this.emitRevisions(previous, hit);
  }

  /** Re-run the batch grader over everything known. Returns the previous verdicts for diffing. */
  private regrade(): Map<Hit, HitVerdict> {
    const previous = this.verdicts;
    this.current = grade(this.notes, this.hits, this.config);
    this.verdicts = new Map();
    for (const r of this.current.notes) if (r.status !== 'missed') this.verdicts.set(r.hit, r);
    for (const e of this.current.extras) this.verdicts.set(e.hit, e);
    return previous;
  }

  private emitRevisions(previous: Map<Hit, HitVerdict>, except: Hit | null): void {
    for (const [hit, before] of previous) {
      if (hit === except) continue;
      const after = this.verdicts.get(hit);
      if (after && !sameVerdict(before, after)) this.emit({ type: 'revised', hit, verdict: after, previous: before });
    }
  }

  /** Pull notes from a note function up to `until`. Returns true if new notes were added. */
  private fetchNotesUntil(until: number): boolean {
    if (!isNoteFunction(this.expected) || until <= this.fetchedUntil) return false;
    const from = this.fetchedUntil;
    this.fetchedUntil = until;
    return this.addNotes(this.expected(from, until));
  }

  private addNotes(notes: readonly ExpectedNote[]): boolean {
    let added = false;
    for (const note of notes) {
      if (this.notesById.has(note.id)) continue;
      this.notesById.set(note.id, note);
      added = true;
    }
    if (added) this.notes = [...this.notesById.values()].sort((a, b) => a.time - b.time);
    return added;
  }

  private emit(event: LiveGradeEvent): void {
    for (const listener of [...this.listeners]) {
      try {
        listener(event);
      } catch (error) {
        console.error('LiveGrader listener threw', error);
      }
    }
  }
}

function isNoteFunction(source: ExpectedNotesSource): source is (fromTime: number, toTime: number) => readonly ExpectedNote[] {
  return typeof source === 'function';
}

function sameVerdict(a: HitVerdict, b: HitVerdict): boolean {
  if (a.status !== b.status) return false;
  if (a.status === 'extra' || b.status === 'extra') return true;
  return a.note.id === b.note.id;
}
