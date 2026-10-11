import type { LessonCategory } from '../lessons';
import type { PassRecord, SessionRecord } from './types';

// All day math is in the player's local time zone: "today" starts at local midnight.

/** "2026-10-11" for the local calendar day `ms` (wall-clock ms) falls on. */
export function dayKey(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Local midnight starting the day `ms` falls on, moved by `days` calendar days (DST-safe). */
export function startOfDay(ms: number, days = 0): number {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + days).getTime();
}

/**
 * Days practiced in a row, counting back from today. A streak is still alive if the last
 * practice was yesterday (today isn't over yet); a day with no session ends it.
 */
export function practiceStreak(sessions: readonly Pick<SessionRecord, 'startedAt'>[], now: number): number {
  const days = new Set(sessions.map((s) => dayKey(s.startedAt)));
  let offset = days.has(dayKey(now)) ? 0 : -1;
  let streak = 0;
  while (days.has(dayKey(startOfDay(now, offset)))) {
    streak++;
    offset--;
  }
  return streak;
}

export interface DayBar {
  /** Local midnight of the day. */
  readonly start: number;
  readonly key: string;
  /** "Mon", "Tue"... */
  readonly label: string;
  readonly minutes: number;
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

/**
 * Minutes played per day for the `days` days ending today, oldest first. A session counts on the
 * day it started.
 */
export function dailyMinutes(sessions: readonly Pick<SessionRecord, 'startedAt' | 'playMs'>[], now: number, days = 7): DayBar[] {
  const bars = Array.from({ length: days }, (_, i) => {
    const start = startOfDay(now, i - (days - 1));
    return { start, key: dayKey(start), label: WEEKDAYS[new Date(start).getDay()]!, ms: 0 };
  });
  const byKey = new Map(bars.map((b) => [b.key, b]));
  for (const s of sessions) {
    const bar = byKey.get(dayKey(s.startedAt));
    if (bar) bar.ms += s.playMs;
  }
  return bars.map(({ ms, ...b }) => ({ ...b, minutes: ms / 60_000 }));
}

/** Practice in the last 7 days (today and the 6 before): minutes played and sessions. */
export function weekSummary(sessions: readonly Pick<SessionRecord, 'startedAt' | 'playMs'>[], now: number): { minutes: number; sessions: number } {
  const from = startOfDay(now, -6);
  const to = startOfDay(now, 1);
  const recent = sessions.filter((s) => s.startedAt >= from && s.startedAt < to);
  return { minutes: recent.reduce((sum, s) => sum + s.playMs, 0) / 60_000, sessions: recent.length };
}

/** BPM is stored with one decimal; a pass at the default tempo can read 0.05 under it. */
const BPM_TOLERANCE = 0.05;

export interface PersonalBests {
  /** Best headline accuracy on a pass played at the lesson's default BPM or faster. */
  readonly accuracy: { readonly value: number; readonly bpm: number; readonly at: number } | null;
  /** Fastest clean pass. */
  readonly cleanBpm: { readonly value: number; readonly at: number } | null;
}

export const NO_BESTS: PersonalBests = { accuracy: null, cleanBpm: null };

/** Whether a pass counts for the accuracy best: played at least at the default tempo. */
export function countsForAccuracyBest(pass: Pick<PassRecord, 'bpm'>, defaultBpm: number): boolean {
  return pass.bpm >= defaultBpm - BPM_TOLERANCE;
}

/** The bests after one more pass, and which of them it beat. */
export function addPassToBests(
  bests: PersonalBests,
  pass: Pick<PassRecord, 'bpm' | 'focusAccuracy' | 'clean'>,
  defaultBpm: number,
  at: number,
): { bests: PersonalBests; newAccuracy: boolean; newCleanBpm: boolean } {
  const acc = pass.focusAccuracy;
  const newAccuracy = acc !== null && countsForAccuracyBest(pass, defaultBpm) && (bests.accuracy === null || acc > bests.accuracy.value);
  const newCleanBpm = pass.clean && (bests.cleanBpm === null || pass.bpm > bests.cleanBpm.value);
  return {
    bests: {
      accuracy: newAccuracy ? { value: acc, bpm: pass.bpm, at } : bests.accuracy,
      cleanBpm: newCleanBpm ? { value: pass.bpm, at } : bests.cleanBpm,
    },
    newAccuracy,
    newCleanBpm,
  };
}

/** Personal bests for one lesson from its sessions (any order). */
export function personalBests(sessions: readonly SessionRecord[]): PersonalBests {
  let bests = NO_BESTS;
  for (const s of [...sessions].sort((a, b) => a.startedAt - b.startedAt)) {
    for (const p of s.passes) bests = addPassToBests(bests, p, s.defaultBpm, s.startedAt).bests;
  }
  return bests;
}

/** Personal bests for every lesson played. */
export function bestsByLesson(sessions: readonly SessionRecord[]): Map<string, PersonalBests> {
  const out = new Map<string, PersonalBests>();
  for (const [id, list] of groupByLesson(sessions)) out.set(id, personalBests(list));
  return out;
}

/** Sessions with at least one graded pass, grouped by lesson id. */
export function groupByLesson(sessions: readonly SessionRecord[]): Map<string, SessionRecord[]> {
  const out = new Map<string, SessionRecord[]>();
  for (const s of sessions) {
    if (s.passes.length === 0) continue;
    const list = out.get(s.lessonId);
    if (list) list.push(s);
    else out.set(s.lessonId, [s]);
  }
  return out;
}

/** A session's best headline accuracy, or null with no graded notes. */
export function sessionBestAccuracy(s: Pick<SessionRecord, 'passes'>): number | null {
  const values = s.passes.map((p) => p.focusAccuracy).filter((v): v is number => v !== null);
  return values.length > 0 ? Math.max(...values) : null;
}

/** A session's fastest clean pass, or null. */
export function sessionCleanBpm(s: Pick<SessionRecord, 'passes'>): number | null {
  const values = s.passes.filter((p) => p.clean).map((p) => p.bpm);
  return values.length > 0 ? Math.max(...values) : null;
}

export type TrendArrow = 'up' | 'down' | 'flat';

/** Accuracy points between recent and earlier sessions that count as a trend. */
export const TREND_ARROW_POINTS = 3;

/**
 * Up, down or flat for a lesson, from its sessions (any order): the last 3 sessions' best accuracy
 * against the 3 before them. A new fastest clean tempo in the latest session is always "up".
 * Null with fewer than 2 sessions.
 */
export function lessonTrend(sessions: readonly SessionRecord[]): TrendArrow | null {
  const list = [...sessions].sort((a, b) => a.startedAt - b.startedAt);
  if (list.length < 2) return null;
  const latest = list.at(-1)!;
  const latestClean = sessionCleanBpm(latest);
  const earlierClean = list.slice(0, -1).map(sessionCleanBpm).filter((v): v is number => v !== null);
  if (latestClean !== null && (earlierClean.length === 0 || latestClean > Math.max(...earlierClean))) return 'up';
  const scores = list.map((s) => sessionBestAccuracy(s) ?? 0);
  const n = Math.min(3, Math.floor(scores.length / 2));
  const recent = average(scores.slice(-n));
  const before = average(scores.slice(-2 * n, -n));
  const diff = recent - before;
  return diff >= TREND_ARROW_POINTS ? 'up' : diff <= -TREND_ARROW_POINTS ? 'down' : 'flat';
}

export interface LessonSummary {
  readonly lessonId: string;
  /** From the latest session. */
  readonly title: string;
  readonly category: LessonCategory;
  readonly sessions: number;
  readonly bests: PersonalBests;
  /** Best accuracy at any tempo, for lessons never played at full speed. */
  readonly bestAnyTempo: { readonly value: number; readonly bpm: number } | null;
  readonly lastPlayed: number;
  readonly trend: TrendArrow | null;
}

/** One row per lesson played, most recently played first. */
export function lessonSummaries(sessions: readonly SessionRecord[]): LessonSummary[] {
  const rows: LessonSummary[] = [];
  for (const [lessonId, list] of groupByLesson(sessions)) {
    const sorted = [...list].sort((a, b) => a.startedAt - b.startedAt);
    const latest = sorted.at(-1)!;
    let bestAnyTempo: LessonSummary['bestAnyTempo'] = null;
    for (const s of sorted) {
      for (const p of s.passes) {
        if (p.focusAccuracy !== null && (bestAnyTempo === null || p.focusAccuracy > bestAnyTempo.value)) bestAnyTempo = { value: p.focusAccuracy, bpm: p.bpm };
      }
    }
    rows.push({
      lessonId,
      title: latest.lessonTitle,
      category: latest.category,
      sessions: sorted.length,
      bests: personalBests(sorted),
      bestAnyTempo,
      lastPlayed: latest.startedAt,
      trend: lessonTrend(sorted),
    });
  }
  return rows.sort((a, b) => b.lastPlayed - a.lastPlayed);
}

export interface SeriesPoint {
  /** Session start, wall-clock ms. */
  readonly at: number;
  readonly value: number | null;
}

/** What a chart point shows on hover or tap: the session's best pass. */
export interface SessionPointInfo {
  /** Session start, wall-clock ms. */
  readonly at: number;
  /** Best accuracy of the session, or null. */
  readonly accuracy: number | null;
  /** Tempo of that best pass (the fastest one on a tie), or of the fastest pass with no accuracy. */
  readonly bpm: number | null;
}

/** The lesson detail charts: best accuracy and fastest clean tempo per session, oldest first. */
export function lessonSeries(sessions: readonly SessionRecord[]): { accuracy: SeriesPoint[]; cleanBpm: SeriesPoint[]; info: SessionPointInfo[] } {
  const list = [...sessions].filter((s) => s.passes.length > 0).sort((a, b) => a.startedAt - b.startedAt);
  return {
    accuracy: list.map((s) => ({ at: s.startedAt, value: sessionBestAccuracy(s) })),
    cleanBpm: list.map((s) => ({ at: s.startedAt, value: sessionCleanBpm(s) })),
    info: list.map((s) => {
      const accuracy = sessionBestAccuracy(s);
      const bpms = s.passes.filter((p) => accuracy === null || p.focusAccuracy === accuracy).map((p) => p.bpm);
      return { at: s.startedAt, accuracy, bpm: bpms.length > 0 ? Math.max(...bpms) : null };
    }),
  };
}

function average(values: readonly number[]): number {
  return values.length === 0 ? 0 : values.reduce((a, b) => a + b, 0) / values.length;
}
