import { describe, expect, it } from 'vitest';
import {
  addPassToBests,
  dailyMinutes,
  dayKey,
  lessonSeries,
  lessonSummaries,
  lessonTrend,
  NO_BESTS,
  personalBests,
  practiceStreak,
  startOfDay,
  weekSummary,
} from './stats';
import { pass, session } from './testData';

/** Local time: month is 1-based here for readability. */
const at = (month: number, day: number, h = 12, m = 0) => new Date(2026, month - 1, day, h, m).getTime();
const on = (...times: number[]) => times.map((startedAt, i) => session({ id: `s${i}`, startedAt }));

describe('days in local time', () => {
  it('11:59 pm and 12:01 am are different days', () => {
    expect(dayKey(at(10, 10, 23, 59))).toBe('2026-10-10');
    expect(dayKey(at(10, 11, 0, 1))).toBe('2026-10-11');
    expect(startOfDay(at(10, 11, 0, 1))).toBe(at(10, 11, 0, 0));
    expect(startOfDay(at(10, 11, 15), -1)).toBe(at(10, 10, 0, 0));
  });

  it('month and year boundaries', () => {
    expect(dayKey(startOfDay(at(3, 1, 9), -1))).toBe('2026-02-28');
    expect(dayKey(startOfDay(new Date(2027, 0, 1).getTime(), -1))).toBe('2026-12-31');
  });
});

describe('practice streak', () => {
  const now = at(10, 11, 20);

  it('counts consecutive days ending today', () => {
    expect(practiceStreak(on(at(10, 9), at(10, 10), at(10, 11, 8), at(10, 11, 9)), now)).toBe(3);
  });

  it('is still alive if the last practice was yesterday', () => {
    expect(practiceStreak(on(at(10, 9), at(10, 10)), now)).toBe(2);
  });

  it('a gap resets it', () => {
    expect(practiceStreak(on(at(10, 6), at(10, 7), at(10, 8), at(10, 10), at(10, 11)), now)).toBe(2);
    expect(practiceStreak(on(at(10, 8), at(10, 9)), now)).toBe(0);
    expect(practiceStreak([], now)).toBe(0);
  });

  it('a session at 11:59 pm and one at 12:01 am are two days in a row', () => {
    expect(practiceStreak(on(at(10, 10, 23, 59), at(10, 11, 0, 1)), at(10, 11, 0, 5))).toBe(2);
    // Both before midnight is one day.
    expect(practiceStreak(on(at(10, 10, 23, 1), at(10, 10, 23, 59)), at(10, 11, 0, 5))).toBe(1);
  });

  it('works across a daylight saving change', () => {
    // US clocks go back on Nov 1, 2026; whatever the zone, calendar days are counted, not 24 h blocks.
    expect(practiceStreak(on(at(10, 31, 22), at(11, 1, 22), at(11, 2, 7)), at(11, 2, 8))).toBe(3);
  });
});

describe('weekly minutes and the 7-day chart', () => {
  const now = at(10, 11, 20);
  const sessions = [
    session({ id: 'a', startedAt: at(10, 11, 9), playMs: 10 * 60_000 }),
    session({ id: 'b', startedAt: at(10, 11, 0, 1), playMs: 5 * 60_000 }),
    session({ id: 'c', startedAt: at(10, 10, 23, 59), playMs: 3 * 60_000 }),
    session({ id: 'd', startedAt: at(10, 5, 0, 0), playMs: 2 * 60_000 }), // first day of the 7
    session({ id: 'e', startedAt: at(10, 4, 23, 59), playMs: 60 * 60_000 }), // 8 days ago: left out
  ];

  it('the chart has 7 days, oldest first, minutes on the day each session started', () => {
    const days = dailyMinutes(sessions, now);
    expect(days.map((d) => d.key)).toEqual(['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09', '2026-10-10', '2026-10-11']);
    expect(days.map((d) => d.minutes)).toEqual([2, 0, 0, 0, 0, 3, 15]);
    expect(days.map((d) => d.label)).toEqual(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']);
  });

  it('this week is the same 7 days', () => {
    expect(weekSummary(sessions, now)).toEqual({ minutes: 20, sessions: 4 });
    expect(weekSummary([], now)).toEqual({ minutes: 0, sessions: 0 });
  });
});

describe('personal bests', () => {
  it('only clean passes count for the highest clean BPM', () => {
    const bests = personalBests([
      session({ passes: [pass({ bpm: 120, clean: false, focusAccuracy: 80 }), pass({ bpm: 105, clean: true })] }),
      session({ id: 's2', passes: [pass({ bpm: 110, clean: false, focusAccuracy: 85 })] }),
    ]);
    expect(bests.cleanBpm?.value).toBe(105);
  });

  it('the accuracy best needs at least the default BPM', () => {
    const bests = personalBests([
      session({ defaultBpm: 100, passes: [pass({ bpm: 70, focusAccuracy: 100 }), pass({ bpm: 100, focusAccuracy: 92 }), pass({ bpm: 99.9, focusAccuracy: 97 })] }),
    ]);
    expect(bests.accuracy).toMatchObject({ value: 92, bpm: 100 });
    // Faster than the default counts too.
    expect(personalBests([session({ passes: [pass({ bpm: 110, focusAccuracy: 95 })] })]).accuracy?.value).toBe(95);
    // Only slow passes: no accuracy best yet.
    expect(personalBests([session({ passes: [pass({ bpm: 60, focusAccuracy: 100, clean: true })] })])).toMatchObject({ accuracy: null, cleanBpm: { value: 60 } });
  });

  it('a pass reports which bests it beat', () => {
    let r = addPassToBests(NO_BESTS, pass({ bpm: 100, focusAccuracy: 90, clean: true }), 100, 1);
    expect([r.newAccuracy, r.newCleanBpm]).toEqual([true, true]);
    r = addPassToBests(r.bests, pass({ bpm: 100, focusAccuracy: 90, clean: true }), 100, 2);
    expect([r.newAccuracy, r.newCleanBpm]).toEqual([false, false]); // a tie is not a new best
    r = addPassToBests(r.bests, pass({ bpm: 105, focusAccuracy: 80, clean: false }), 100, 3);
    expect([r.newAccuracy, r.newCleanBpm]).toEqual([false, false]);
    r = addPassToBests(r.bests, pass({ bpm: 105, focusAccuracy: 96, clean: true }), 100, 4);
    expect([r.newAccuracy, r.newCleanBpm]).toEqual([true, true]);
    expect(r.bests).toEqual({ accuracy: { value: 96, bpm: 105, at: 4 }, cleanBpm: { value: 105, at: 4 } });
  });
});

describe('per-lesson list and trends', () => {
  const s = (id: string, day: number, focusAccuracy: number, bpm = 100, clean = false, lessonId = 'rock-1') =>
    session({ id, lessonId, startedAt: at(10, day), passes: [pass({ focusAccuracy, bpm, clean })] });

  it('one row per lesson, most recently played first; sessions without passes are left out', () => {
    const rows = lessonSummaries([
      s('a', 1, 70),
      s('b', 3, 80, 100, false, 'fill-1'),
      s('c', 2, 85),
      session({ id: 'rec', lessonId: 'recording', mode: 'record', passes: [], startedAt: at(10, 9) }),
    ]);
    expect(rows.map((r) => [r.lessonId, r.sessions])).toEqual([['fill-1', 1], ['rock-1', 2]]);
    expect(rows[1]).toMatchObject({ lastPlayed: at(10, 2), bests: { accuracy: { value: 85 } }, bestAnyTempo: { value: 85 }, trend: 'up' });
  });

  it('trend: last sessions against earlier ones; a new top clean tempo is always up', () => {
    expect(lessonTrend([s('a', 1, 80)])).toBeNull();
    expect(lessonTrend([s('a', 1, 80), s('b', 2, 81)])).toBe('flat');
    expect(lessonTrend([s('a', 1, 90), s('b', 2, 80)])).toBe('down');
    expect(lessonTrend([s('a', 1, 60), s('b', 2, 62), s('c', 3, 64), s('d', 4, 70), s('e', 5, 72), s('f', 6, 74)])).toBe('up');
    // Lower accuracy, but clean at a faster tempo than ever.
    expect(lessonTrend([s('a', 1, 98, 90, true), s('b', 2, 91, 95, true)])).toBe('up');
  });

  it('chart series: best accuracy and fastest clean tempo per session, oldest first', () => {
    const series = lessonSeries([s('b', 2, 80, 95, true), s('a', 1, 70, 90, false)]);
    expect(series.accuracy).toEqual([{ at: at(10, 1), value: 70 }, { at: at(10, 2), value: 80 }]);
    expect(series.cleanBpm).toEqual([{ at: at(10, 1), value: null }, { at: at(10, 2), value: 95 }]);
    expect(series.info).toEqual([{ at: at(10, 1), accuracy: 70, bpm: 90 }, { at: at(10, 2), accuracy: 80, bpm: 95 }]);
  });
});
