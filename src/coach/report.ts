import { DEFAULT_GRADING_CONFIG, summarize, type GradeResult, type GradeStats, type NoteResult } from '../grading';
import type { Pad } from '../input';
import { PAD_LABELS } from '../input/padLabels';
import { ALL_LESSONS, countSyllable, focusNoteIndices, focusResult, noteIndex, positionLabel, type Lesson } from '../lessons';
import { clicksPerBeat } from '../metronome/timing';
import { ProblemTracker } from '../trainer/problems';
import type { PadReport, PartReport, PracticeSession, ProblemSpotReport, SessionReport, Tendency, TimingReport, Trend } from './types';

/** A mean offset beyond this (ms) counts as rushing or dragging. */
export const TENDENCY_MS = 10;
/** The second half of a session must differ from the first by this many accuracy points to be a trend. */
export const TREND_POINTS = 5;
/** At most this many problem spots go in the report. */
const MAX_SPOTS = 3;

/**
 * Turn a finished session into the compact report both coaches work from. Pure.
 * Accuracy covers the fill for lessons with a focus range (what the player sees as the headline),
 * otherwise the whole lesson. Timing and per-pad stats cover every note.
 */
export function buildSessionReport(session: PracticeSession): SessionReport {
  const { lesson, passes } = session;
  const windowMs = DEFAULT_GRADING_CONFIG.windowMs;
  const all = mergeResults(passes.map((p) => p.result));
  const focused = lesson.focus !== undefined;

  const perPassAccuracy = passes.map((p) => summarize(focused ? focusResult(p.result, lesson, windowMs) : p.result).accuracy);
  const graded = summarize(focused ? focusResult(all, lesson, windowMs) : all);
  const whole = summarize(all);
  const bpms = passes.map((p) => p.bpm);

  const problems = new ProblemTracker(lesson);
  for (const p of passes) problems.recordPass(p.result.notes);

  return {
    lesson: { title: lesson.title, category: lesson.category, next: nextLesson(lesson)?.title ?? null },
    passes: passes.length,
    bpm: bpms.length > 0 ? { min: bpm(Math.min(...bpms)), max: bpm(Math.max(...bpms)) } : { min: 0, max: 0 },
    trainer: session.trainer
      ? {
          startBpm: bpm(session.trainer.settings.startBpm),
          targetBpm: bpm(session.trainer.settings.targetBpm),
          finalBpm: bpm(session.trainer.finalBpm),
          learned: session.trainer.learned,
        }
      : null,
    graded: focused ? 'fill' : 'whole lesson',
    accuracy: {
      overall: pct(graded.accuracy),
      ...trend(perPassAccuracy),
      perPass: passes.map((p, i) => ({ bpm: bpm(p.bpm), accuracy: pct(perPassAccuracy[i] ?? null) })),
    },
    timing: timingOf(whole),
    fill: focused ? { ...partOf(graded), ...fillInfo(lesson) } : null,
    groove: focused ? partOf(summarize(grooveOnly(all, lesson))) : null,
    perPad: (Object.entries(whole.perPad) as [Pad, GradeStats][]).map(([pad, s]): PadReport => ({
      pad: PAD_LABELS[pad],
      ...partOf(s),
      wrongPad: s.wrongPad,
      missed: s.missed,
    })),
    problemSpots: problems.worst(MAX_SPOTS).map((spot): ProblemSpotReport => {
      const s = spot.stats;
      const instead = [...s.wrongPads].sort((a, b) => b[1] - a[1])[0];
      return {
        pad: PAD_LABELS[s.pad],
        where: positionLabel(s.bar, s.beat, s.subdivision, clicksPerBeat(lesson.subdivision)),
        passes: s.passes,
        offPasses: s.offPasses,
        missed: s.missed,
        wrongPad: s.wrongPad,
        early: s.early,
        late: s.late,
        meanMs: spot.meanOffsetMs === null ? null : round(spot.meanOffsetMs),
        playedInstead: instead ? PAD_LABELS[instead[0]] : null,
      };
    }),
  };
}

/** The next lesson of the same category in the built-in (difficulty) order, or null for the last one. */
export function nextLesson(lesson: Pick<Lesson, 'id' | 'category'>, lessons: readonly Lesson[] = ALL_LESSONS): Lesson | null {
  const same = lessons.filter((l) => l.category === lesson.category);
  const i = same.findIndex((l) => l.id === lesson.id);
  return i >= 0 ? (same[i + 1] ?? null) : null;
}

/** Compare the first and second half of the passes. Fewer than 2 passes is flat. */
export function trend(accuracies: readonly (number | null)[]): { start: number | null; end: number | null; trend: Trend } {
  const values = accuracies.map((a) => a ?? 0);
  if (values.length < 2) {
    const only = pct(accuracies[0] ?? null);
    return { start: only, end: only, trend: 'flat' };
  }
  const half = Math.floor(values.length / 2);
  const start = average(values.slice(0, half));
  const end = average(values.slice(values.length - half));
  const diff = end - start;
  return { start: pct(start), end: pct(end), trend: diff >= TREND_POINTS ? 'improving' : diff <= -TREND_POINTS ? 'getting worse' : 'flat' };
}

export function tendencyOf(meanMs: number | null): Tendency {
  if (meanMs === null) return 'no data';
  if (meanMs < -TENDENCY_MS) return 'rushing';
  if (meanMs > TENDENCY_MS) return 'dragging';
  return 'on time';
}

function timingOf(s: GradeStats): TimingReport {
  return {
    meanMs: s.meanOffsetMs === null ? null : round(s.meanOffsetMs),
    spreadMs: s.stdDevOffsetMs === null ? null : round(s.stdDevOffsetMs),
    tendency: tendencyOf(s.meanOffsetMs),
  };
}

function partOf(s: GradeStats): PartReport {
  return { accuracy: pct(s.accuracy), ...timingOf(s) };
}

/** How to count the fill, which beats it covers, and its first drum. */
function fillInfo(lesson: Lesson): { count: string; beats: string; firstPad: string } {
  const focus = lesson.focus!;
  const perBeat = clicksPerBeat(lesson.subdivision);
  const beat = focus.start.beat + 1;
  const syllables = Array.from({ length: perBeat - 1 }, (_, i) => countSyllable(i + 1, perBeat)).filter((x): x is string => x !== null);
  const count = [String(beat), ...syllables].join(' ');
  // The fill runs from its first beat to the end of that bar (the landing is the next downbeat).
  const last = focus.end.bar > focus.start.bar ? lesson.beatsPerBar : focus.end.beat + 1;
  const beats = last <= beat ? `beat ${beat}` : last === beat + 1 ? `beats ${beat} and ${last}` : `beats ${beat} to ${last}`;
  const inFocus = [...focusNoteIndices(lesson)].map((i) => lesson.notes[i]!);
  // Prefer a drum over the hi-hat or kick that may still be keeping time.
  const first = inFocus.find((n) => !n.pad.startsWith('hihat') && n.pad !== 'kick') ?? inFocus[0];
  return { count, beats, firstPad: first ? PAD_LABELS[first.pad] : '' };
}

/** Notes outside the focus range (extras are left out: they belong to no part). */
function grooveOnly(result: GradeResult, lesson: Lesson): GradeResult {
  const inFocus = focusNoteIndices(lesson);
  return {
    notes: result.notes.filter((r) => {
      const i = noteIndex(r.note.id);
      return i !== null && !inFocus.has(i);
    }),
    extras: [],
  };
}

function mergeResults(results: readonly GradeResult[]): GradeResult {
  const notes: NoteResult[] = [];
  const extras: GradeResult['extras'][number][] = [];
  for (const r of results) {
    notes.push(...r.notes);
    extras.push(...r.extras);
  }
  return { notes, extras };
}

function average(values: readonly number[]): number {
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function round(v: number): number {
  return Math.round(v);
}

/** BPM with at most one decimal (speeds like 75% can give 52.5). */
function bpm(v: number): number {
  return Math.round(v * 10) / 10;
}

/** Percent with one decimal. */
function pct(v: number | null): number | null {
  return v === null ? null : Math.round(v * 10) / 10;
}
