import type { Coaching, SessionReport } from './types';

/** Longest single line a coach may return, in characters. */
const MAX_LINE = 400;
const MAX_ITEMS = 4;

function isLine(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0 && v.length <= MAX_LINE;
}

function isLines(v: unknown): v is string[] {
  return Array.isArray(v) && v.length <= MAX_ITEMS && v.every(isLine);
}

/** True if `v` has exactly the Coaching shape, with sensible lengths. Extra keys are rejected. */
export function isCoaching(v: unknown): v is Coaching {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return false;
  const o = v as Record<string, unknown>;
  const keys = Object.keys(o).sort().join(',');
  return keys === 'fixThis,headline,nextExercise,wentWell' && isLine(o.headline) && isLines(o.wentWell) && isLines(o.fixThis) && isLine(o.nextExercise);
}

/** Copy only the Coaching fields, trimmed (for a value that passed isCoaching). */
export function cleanCoaching(c: Coaching): Coaching {
  return { headline: c.headline.trim(), wentWell: c.wentWell.map((s) => s.trim()), fixThis: c.fixThis.map((s) => s.trim()), nextExercise: c.nextExercise.trim() };
}

const isNumOrNull = (v: unknown) => v === null || (typeof v === 'number' && Number.isFinite(v));
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Light check that a request body is a SessionReport, enough for the rule-based coach to run on
 * it safely. The server uses it before spending an API call.
 */
export function isSessionReport(v: unknown): v is SessionReport {
  if (!isObj(v)) return false;
  const { lesson, bpm, accuracy, timing, perPad, problemSpots } = v;
  return (
    isObj(lesson) && typeof lesson.title === 'string' && (lesson.category === 'beat' || lesson.category === 'fill' || lesson.category === 'song') &&
    (lesson.mine === undefined || typeof lesson.mine === 'boolean') &&
    typeof v.passes === 'number' &&
    isObj(bpm) && typeof bpm.min === 'number' && typeof bpm.max === 'number' &&
    (v.trainer === null || (isObj(v.trainer) && typeof v.trainer.finalBpm === 'number' && typeof v.trainer.learned === 'boolean')) &&
    (v.graded === 'fill' || v.graded === 'whole lesson') &&
    isObj(accuracy) && isNumOrNull(accuracy.overall) && Array.isArray(accuracy.perPass) &&
    isObj(timing) && isNumOrNull(timing.meanMs) && isNumOrNull(timing.spreadMs) &&
    (v.fill === null || (isObj(v.fill) && isNumOrNull(v.fill.meanMs) && typeof v.fill.count === 'string')) &&
    (v.groove === null || isObj(v.groove)) &&
    Array.isArray(perPad) && Array.isArray(problemSpots) && problemSpots.every((s) => isObj(s) && typeof s.pad === 'string' && typeof s.where === 'string')
  );
}
