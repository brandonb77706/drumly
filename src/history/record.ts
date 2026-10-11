import type { CoachResponse, SessionReport } from '../coach/types';
import { replayClicks, type PassTake } from '../compare/compare';
import { DEFAULT_GRADING_CONFIG, grade, summarize, type GradeResult } from '../grading';
import type { Hit } from '../input';
import { focusResult, formatLessonText, lessonFromText, lessonToExpectedNotes, type Lesson } from '../lessons';
import { passVerdict, type LadderSettings } from '../trainer/ladder';
import { SCHEMA_VERSION, type BestPassRecord, type LessonSnapshot, type PassRecord, type SessionMode, type SessionRecord, type SessionSource, type StoredHit } from './types';

/** One graded pass as the app has it at the end of a run. */
export interface SessionTake {
  readonly bpm: number;
  /** performance.now() ms of the pass's first downbeat and of the next pass's. */
  readonly start: number;
  readonly end: number;
  readonly result: GradeResult;
}

/** Everything a finished run hands over to be saved. */
export interface SessionInput {
  readonly id: string;
  readonly startedAt: number;
  readonly endedAt: number;
  readonly playMs: number;
  /** The lesson as picked (its id, title and default BPM are what's tracked). */
  readonly lesson: Lesson;
  /** The bars actually played: the lesson, a song's loop, or a listen section. */
  readonly played: Lesson;
  readonly mode: SessionMode;
  /** Decides which passes are clean: the trainer's settings, or the defaults. */
  readonly ladder: Pick<LadderSettings, 'passThreshold'>;
  readonly takes: readonly SessionTake[];
  /** Every hit of the run, as recorded. */
  readonly hits: readonly Hit[];
  readonly trainer: { readonly settings: LadderSettings; readonly learned: boolean } | null;
  readonly report: SessionReport | null;
  readonly coaching: CoachResponse | null;
  readonly windowMs?: number;
}

/** Percent or BPM with one decimal. */
export function round1(v: number): number {
  return Math.round(v * 10) / 10 + 0; // + 0 turns -0 into 0, so a JSON round trip is exact
}

function roundWhole(v: number): number {
  return Math.round(v) + 0;
}

const roundOrNull = (v: number | null, round: (x: number) => number) => (v === null ? null : round(v));

/** The compact record of one pass: the headline (focus) accuracy, whole-lesson stats, and whether it was clean. */
export function passRecord(played: Lesson, take: Pick<SessionTake, 'bpm' | 'result'>, ladder: Pick<LadderSettings, 'passThreshold'>, windowMs = DEFAULT_GRADING_CONFIG.windowMs): PassRecord {
  const full = summarize(take.result);
  const focus = summarize(focusResult(take.result, played, windowMs));
  return {
    bpm: round1(take.bpm),
    focusAccuracy: roundOrNull(focus.accuracy, round1),
    accuracy: roundOrNull(full.accuracy, round1),
    meanMs: roundOrNull(full.meanOffsetMs, roundWhole),
    spreadMs: roundOrNull(full.stdDevOffsetMs, roundWhole),
    counts: {
      expected: full.expected,
      hit: full.hit,
      wrongPad: full.wrongPad,
      missed: full.missed,
      extra: full.extra,
      perfect: full.timing.perfect,
      good: full.timing.good,
      early: full.timing.early,
      late: full.timing.late,
    },
    // The ladder judges the headline number, exactly as the trainer does.
    clean: passVerdict(focus.accuracy, ladder) === 'clean',
  };
}

/** Index of the best pass: highest headline accuracy, then the faster one, then the later one. */
export function bestPassIndex(passes: readonly PassRecord[]): number | null {
  let best: number | null = null;
  passes.forEach((p, i) => {
    if (best === null) return void (best = i);
    const b = passes[best]!;
    const a = p.focusAccuracy ?? -1;
    const ba = b.focusAccuracy ?? -1;
    if (a > ba || (a === ba && p.bpm >= b.bpm)) best = i;
  });
  return best;
}

/** The most common hit source, or 'none'. */
export function sessionSource(hits: readonly Pick<Hit, 'source'>[]): SessionSource {
  const counts = new Map<SessionSource, number>();
  for (const h of hits) counts.set(h.source, (counts.get(h.source) ?? 0) + 1);
  let best: SessionSource = 'none';
  let top = 0;
  for (const [source, n] of counts) {
    if (n > top) {
      best = source;
      top = n;
    }
  }
  return best;
}

export function lessonSnapshot(lesson: Lesson): LessonSnapshot {
  return {
    title: lesson.title,
    beatsPerBar: lesson.beatsPerBar,
    subdivision: lesson.subdivision,
    bars: lesson.bars,
    text: formatLessonText(lesson),
    focus: lesson.focus ?? null,
    equivalentPads: lesson.equivalentPads ?? null,
    section: lesson.section ?? null,
  };
}

/**
 * The record saved after a session. Pure. Raw hits are kept only for the best pass (for Compare):
 * the hits that belong to it by the grading rule, [start - window, end - window).
 */
export function buildSessionRecord(input: SessionInput): SessionRecord {
  const windowMs = input.windowMs ?? DEFAULT_GRADING_CONFIG.windowMs;
  const passes = input.takes.map((t) => passRecord(input.played, t, input.ladder, windowMs));
  const bestIndex = bestPassIndex(passes);
  const best = bestIndex === null ? null : input.takes[bestIndex]!;
  const bestPass: BestPassRecord | null =
    best === null || bestIndex === null
      ? null
      : {
          pass: bestIndex,
          bpm: best.bpm,
          lengthMs: best.end - best.start,
          lesson: lessonSnapshot(input.played),
          hits: input.hits
            .filter((h) => h.time >= best.start - windowMs && h.time < best.end - windowMs)
            .map((h): StoredHit => ({ pad: h.pad, velocity: h.velocity, t: h.time - best.start })),
        };
  const cleanBpms = passes.filter((p) => p.clean).map((p) => p.bpm);
  return {
    schemaVersion: SCHEMA_VERSION,
    id: input.id,
    startedAt: input.startedAt,
    endedAt: input.endedAt,
    playMs: Math.max(0, roundWhole(input.playMs)),
    lessonId: input.lesson.id,
    lessonTitle: input.lesson.title,
    category: input.lesson.category,
    defaultBpm: input.lesson.defaultBpm,
    mode: input.mode,
    source: sessionSource(input.hits),
    passes,
    trainer: input.trainer
      ? {
          startBpm: input.trainer.settings.startBpm,
          targetBpm: input.trainer.settings.targetBpm,
          highestCleanBpm: cleanBpms.length > 0 ? Math.max(...cleanBpms) : null,
          learned: input.trainer.learned,
        }
      : null,
    report: input.report,
    coaching: input.coaching,
    bestPass,
  };
}

/** A recording session (Record a fill): only the time spent counts; nothing is graded. */
export function recordingSessionRecord(input: { id: string; startedAt: number; endedAt: number; playMs: number; bpm: number; hits: readonly Hit[] }): SessionRecord {
  return {
    schemaVersion: SCHEMA_VERSION,
    id: input.id,
    startedAt: input.startedAt,
    endedAt: input.endedAt,
    playMs: Math.max(0, roundWhole(input.playMs)),
    lessonId: RECORDING_LESSON_ID,
    lessonTitle: 'Record a fill',
    category: 'fill',
    defaultBpm: input.bpm,
    mode: 'record',
    source: sessionSource(input.hits),
    passes: [],
    trainer: null,
    report: null,
    coaching: null,
    bestPass: null,
  };
}

export const RECORDING_LESSON_ID = 'recording';

/**
 * The stored best pass, ready for Compare: the played bars rebuilt from their text, and the
 * stored hits graded again with the batch grader (what a run's final grade uses) on a clock where
 * the pass starts at 0. Throws if the snapshot no longer parses.
 */
export function replayTake(record: Pick<SessionRecord, 'lessonId' | 'defaultBpm' | 'category'>, best: BestPassRecord): { take: PassTake; hits: Hit[] } {
  const snap = best.lesson;
  const base = lessonFromText({
    id: record.lessonId,
    title: snap.title,
    category: record.category,
    description: '',
    defaultBpm: record.defaultBpm,
    beatsPerBar: snap.beatsPerBar,
    subdivision: snap.subdivision,
    bars: snap.bars,
    text: snap.text,
    ...(snap.focus ? { focus: snap.focus } : {}),
    ...(snap.equivalentPads ? { equivalentPads: snap.equivalentPads } : {}),
  });
  const lesson: Lesson = snap.section ? { ...base, section: snap.section } : base;
  const notes = lessonToExpectedNotes(lesson, replayClicks(lesson, best.bpm, [0]));
  const hits = best.hits.map((h): Hit => ({ pad: h.pad, velocity: h.velocity, time: h.t, source: 'test' }));
  const result = grade(notes, hits, lesson.equivalentPads ? { equivalentPads: lesson.equivalentPads } : {});
  return { take: { lesson, pass: 0, start: 0, end: best.lengthMs, bpm: best.bpm, result }, hits };
}
