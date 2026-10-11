import type { GradeResult, NoteResult } from '../grading';
import type { Hit, Pad } from '../input';
import { clicksPerBeat } from '../metronome/timing';
import { noteId, noteIndex, type Lesson } from '../lessons';
import { LESSON_NOTE_VELOCITY } from '../sound/LessonSounds';

/** One sound in a compare replay, in ms from the start of the pass. */
export interface CompareEvent {
  readonly pad: Pad;
  readonly velocity: number;
  readonly atMs: number;
}

/** A graded pass as it was played: what the compare replay needs. */
export interface PassTake {
  readonly lesson: Lesson;
  /** Pass number within its run. */
  readonly pass: number;
  /** performance.now() ms of the pass's first downbeat and of the next pass's. */
  readonly start: number;
  readonly end: number;
  readonly bpm: number;
  readonly result: GradeResult;
}

export interface CompareTimelines {
  /** The lesson's notes for that pass, at the click times they were graded against. */
  readonly correct: CompareEvent[];
  /** The player's hits exactly as recorded: real pads, real velocities, real timing. */
  readonly yours: CompareEvent[];
  /** Length of the pass, ms. */
  readonly lengthMs: number;
}

/**
 * Both sides of a pass on one relative clock: 0 is the pass's first downbeat. The correct side
 * uses the expected note times; the player's side uses each recorded hit's own time, so flams,
 * drift, rushing and extra notes all survive. Hits belong to the pass if they fall in
 * [start - windowMs, end - windowMs), the same rule grading uses.
 */
export function compareTimelines(take: PassTake, recorded: readonly Hit[], windowMs: number): CompareTimelines {
  const correct = take.result.notes
    .map((r) => ({ pad: r.note.pad, velocity: r.note.velocity ?? LESSON_NOTE_VELOCITY, atMs: r.note.time - take.start }))
    .sort((a, b) => a.atMs - b.atMs);
  const yours = recorded
    .filter((h) => h.time >= take.start - windowMs && h.time < take.end - windowMs)
    .map((h) => ({ pad: h.pad, velocity: h.velocity, atMs: h.time - take.start }))
    .sort((a, b) => a.atMs - b.atMs);
  return { correct, yours, lengthMs: take.end - take.start };
}

/** "Correct, then yours" or both at once (correct panned left, yours right). */
export type CompareMode = 'sequential' | 'together';

/** Pause between the correct version and yours. */
export const COMPARE_GAP_MS = 800;
/** Let the last sound ring before the replay counts as finished. */
export const COMPARE_TAIL_MS = 600;
/** Stereo positions in "together" mode. */
export const CORRECT_PAN = -0.8;
export const YOURS_PAN = 0.8;

export interface CompareSchedule {
  /** Added to every event so an early first hit (before the downbeat) still starts at or after 0. */
  readonly leadMs: number;
  /** Where each side's pass starts, ms from the replay start (lead included). */
  readonly correctStartMs: number;
  readonly yoursStartMs: number;
  readonly totalMs: number;
}

/** Where each side starts in the replay. In "together" mode both start at the same moment. */
export function compareSchedule(t: CompareTimelines, mode: CompareMode, gapMs = COMPARE_GAP_MS): CompareSchedule {
  const earliest = Math.min(0, ...t.correct.map((e) => e.atMs), ...t.yours.map((e) => e.atMs));
  const leadMs = -earliest;
  const correctStartMs = leadMs;
  const yoursStartMs = mode === 'together' ? leadMs : leadMs + t.lengthMs + gapMs;
  const lastYours = Math.max(t.lengthMs, ...t.yours.map((e) => e.atMs));
  return { leadMs, correctStartMs, yoursStartMs, totalMs: yoursStartMs + lastYours + COMPARE_TAIL_MS };
}

/**
 * A click grid for drawing a replay on the highway: one pass of the lesson at `bpm` starting at
 * each time in `passStarts` (performance.now() ms). Times are start + n * interval, never summed.
 */
export function replayClicks(lesson: Lesson, bpm: number, passStarts: readonly number[]) {
  const perBeat = clicksPerBeat(lesson.subdivision);
  const stepMs = 60_000 / bpm / perBeat;
  const perPass = lesson.bars * lesson.beatsPerBar * perBeat;
  const clicks = [];
  for (let p = 0; p < passStarts.length; p++) {
    const start = passStarts[p]!;
    for (let n = 0; n < perPass; n++) {
      const beatIndex = Math.floor(n / perBeat);
      clicks.push({
        index: p * perPass + n,
        bar: p * lesson.bars + Math.floor(beatIndex / lesson.beatsPerBar),
        beat: beatIndex % lesson.beatsPerBar,
        subdivision: n % perBeat,
        subdivisionsPerBeat: perBeat,
        beatsPerBar: lesson.beatsPerBar,
        isCountIn: false,
        time: start + n * stepMs,
      });
    }
  }
  return clicks;
}

/**
 * Move a pass's grade onto another pass number and time, for showing it on a replay highway:
 * note ids are renumbered to `toPass`, and every note and hit time moves by `deltaMs`.
 */
export function moveResult(result: GradeResult, lesson: Lesson, toPass: number, deltaMs: number): GradeResult {
  const moveHit = (h: Hit): Hit => ({ ...h, time: h.time + deltaMs });
  const notes = result.notes.map((r): NoteResult => {
    const note = { ...r.note, id: noteId(lesson.id, toPass, noteIndex(r.note.id) ?? 0), time: r.note.time + deltaMs };
    return r.status === 'missed' ? { note, status: 'missed' } : { ...r, note, hit: moveHit(r.hit) };
  });
  return { notes, extras: result.extras.map((e) => ({ ...e, hit: moveHit(e.hit) })) };
}
