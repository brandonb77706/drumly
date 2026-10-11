import type { Hit } from '../input';
import { grade } from './match';
import { summarize, type GradeSummary } from './summary';
import {
  resolveConfig,
  type ExpectedNote,
  type ExtraHit,
  type GradeResult,
  type NoteResult,
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
  /**
   * Notes more than this long before the miss deadline (now - window - grace) are settled: their
   * results are frozen and they leave the live regrade, so each hit only regrades the notes near
   * the current position, however long the song. Default 2000 ms. Infinity keeps everything live.
   */
  settleMs?: number;
}

/** Default for LiveGraderOptions.settleMs. */
export const DEFAULT_SETTLE_MS = 2000;

export interface FinalGrade {
  results: GradeResult;
  summary: GradeSummary;
}

/**
 * Thin live wrapper around the batch grader. Every decision comes from grade(), re-run over the
 * live notes and hits whenever something changes. Notes long past their window are settled
 * (see `settleMs`), so the regrade covers only the notes near the current position; a hit can
 * only match notes within its window, so this gives the same result as grading everything
 * (stop() still runs the batch grader over everything, as the final word). Verdicts are emitted immediately and revised if later hits
 * change the matching. Misses are only reported once a note's window has fully passed,
 * checked on requestAnimationFrame (or by calling check() yourself), never with setTimeout.
 */
export class LiveGrader {
  private readonly config: GradingConfig;
  private readonly ignoreHitsBefore: number;
  private readonly missGraceMs: number;
  private readonly autoCheck: boolean;
  private readonly now: () => number;
  private readonly settleMs: number;

  /** Every note ever added (for dedupe and the final grade). */
  private readonly notesById = new Map<string, ExpectedNote>();
  /** Live (unsettled) notes, in time order. */
  private notes: ExpectedNote[] = [];
  private fetchedUntil = -Infinity;
  /** Live hits: not consumed by a settled note, and not a settled extra. */
  private hits: Hit[] = [];
  /** Every hit received (for the final grade). */
  private readonly allHits: Hit[] = [];
  /** Frozen results, all earlier than any live note. */
  private readonly settledNotes: NoteResult[] = [];
  private readonly settledExtras: ExtraHit[] = [];
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
    this.settleMs = options.settleMs ?? DEFAULT_SETTLE_MS;
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
      [...this.notesById.values()].filter((n) => n.time <= now),
      this.allHits,
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

  /** Current provisional results (all known notes, including ones not due yet), settled ones included. */
  getResults(): GradeResult {
    if (this.settledNotes.length === 0 && this.settledExtras.length === 0) return this.current;
    const extras = [...this.settledExtras, ...this.current.extras].sort((a, b) => a.hit.time - b.hit.time);
    return { notes: [...this.settledNotes, ...this.current.notes], extras };
  }

  /** How many notes are in the live regrade (for tests and diagnostics). */
  get liveNoteCount(): number {
    return this.notes.length;
  }

  /** Report notes whose window has passed as missed. Called every animation frame by default. */
  check(now = this.now()): void {
    if (this.fetchNotesUntil(now + this.config.windowMs)) this.emitRevisions(this.regrade(), null);

    const deadline = now - this.config.windowMs - this.missGraceMs;
    this.settle(deadline - this.settleMs);
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
    this.settle(this.now() - this.config.windowMs - this.missGraceMs - this.settleMs);
    this.hits.push(hit);
    this.allHits.push(hit);
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

  /**
   * Freeze the results of live notes before `cut`, with the hits they took, and the extras that
   * are too early to match any note still live (before cut - window). Missed notes not reported
   * yet are reported now.
   */
  private settle(cut: number): void {
    const first = this.current.notes[0];
    if (!first || first.note.time >= cut) return;
    const consumed = new Set<Hit>();
    let n = 0;
    for (const r of this.current.notes) {
      if (r.note.time >= cut) break;
      this.settledNotes.push(r);
      if (r.status === 'missed') {
        if (!this.reportedMissed.has(r.note.id)) {
          this.reportedMissed.add(r.note.id);
          this.emit({ type: 'missed', note: r.note });
        }
      } else consumed.add(r.hit);
      n++;
    }
    const extraCut = cut - this.config.windowMs;
    for (const e of this.current.extras) {
      if (e.hit.time < extraCut) {
        this.settledExtras.push(e);
        consumed.add(e.hit);
      }
    }
    const settledIds = new Set(this.current.notes.slice(0, n).map((r) => r.note.id));
    this.notes = this.notes.filter((note) => !settledIds.has(note.id));
    this.hits = this.hits.filter((h) => !consumed.has(h));
    for (const h of consumed) this.verdicts.delete(h);
    this.current = {
      notes: this.current.notes.slice(n),
      extras: this.current.extras.filter((e) => !consumed.has(e.hit)),
    };
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
      this.notes.push(note);
      added = true;
    }
    if (added) this.notes.sort((a, b) => a.time - b.time);
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
