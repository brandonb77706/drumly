import { describe, expect, it } from 'vitest';
import { replayClicks } from '../compare/compare';
import { grade, summarize } from '../grading';
import type { Hit, Pad } from '../input';
import { barsLesson, FILL_LESSONS, lessonToExpectedNotes, STARTER_LESSONS, type Lesson } from '../lessons';
import { defaultLadderSettings } from '../trainer/ladder';
import { bestPassIndex, buildSessionRecord, passRecord, recordingSessionRecord, replayTake, sessionSource, type SessionInput, type SessionTake } from './record';
import { pass } from './testData';
import { isSessionRecord } from './validate';

const fill = FILL_LESSONS.find((l) => l.id === 'fill-around-toms')!;

/**
 * One pass of `lesson` at `bpm` starting at `start`, played with a little jitter. `mistakes`
 * notes (from the end of the focus range) are missed, one is hit on the wrong pad, and one extra hit lands mid-pass.
 */
function playPass(lesson: Lesson, bpm: number, start: number, mistakes: number): { take: SessionTake; hits: Hit[] } {
  const clicks = replayClicks(lesson, bpm, [start]);
  const notes = lessonToExpectedNotes(lesson, clicks);
  const end = start + (lesson.bars * lesson.beatsPerBar * 60_000) / bpm;
  const hits: Hit[] = [];
  notes.forEach((n, i) => {
    if (i >= notes.length - mistakes) return; // missed
    const pad: Pad = i === 3 && mistakes > 0 ? 'crash' : n.pad;
    hits.push({ pad, velocity: 90, time: n.time + ((i % 5) - 2) * 6, source: 'keyboard' });
  });
  hits.push({ pad: 'ride', velocity: 70, time: start + 333, source: 'keyboard' });
  return { take: { bpm, start, end, result: grade(notes, hits) }, hits };
}

function input(overrides: Partial<SessionInput> = {}): SessionInput {
  const a = playPass(fill, 80, 10_000, 4);
  const b = playPass(fill, 85, 10_000 + a.take.end - a.take.start, 0);
  return {
    id: 'x1',
    startedAt: 1_000_000,
    endedAt: 1_060_000,
    playMs: 58_123.4,
    lesson: fill,
    played: fill,
    mode: 'trainer',
    ladder: defaultLadderSettings(fill),
    takes: [a.take, b.take],
    hits: [...a.hits, ...b.hits, { pad: 'snare', velocity: 90, time: 1, source: 'midi' }],
    trainer: { settings: { ...defaultLadderSettings(fill), startBpm: 80 }, learned: false },
    report: null,
    coaching: null,
    ...overrides,
  };
}

describe('session records', () => {
  it('keeps the compact per-pass numbers, the trainer outcome and the time played', () => {
    const record = buildSessionRecord(input());
    expect(isSessionRecord(record)).toBe(true);
    expect(record).toMatchObject({ id: 'x1', lessonId: fill.id, lessonTitle: fill.title, category: 'fill', defaultBpm: fill.defaultBpm, mode: 'trainer', source: 'keyboard', playMs: 58_123 });
    expect(record.passes.map((p) => [p.bpm, p.clean])).toEqual([[80, false], [85, true]]);
    expect(record.passes[1]).toMatchObject({ focusAccuracy: 100, counts: { extra: 1, missed: 0 } });
    expect(record.passes[0]!.counts).toMatchObject({ missed: 4, wrongPad: 1 });
    expect(record.trainer).toEqual({ startBpm: 80, targetBpm: fill.defaultBpm, highestCleanBpm: 85, learned: false });
    // Plain JSON: survives a JSON round trip unchanged.
    expect(JSON.parse(JSON.stringify(record))).toEqual(record);
  });

  it('raw hits are kept only for the best pass, relative to its downbeat', () => {
    const i = input();
    const record = buildSessionRecord(i);
    const best = record.bestPass!;
    expect(best.pass).toBe(1);
    const b = i.takes[1]!;
    const own = i.hits.filter((h) => h.time >= b.start - 100 && h.time < b.end - 100);
    expect(best.hits).toHaveLength(own.length);
    expect(best.hits[0]).toEqual({ pad: own[0]!.pad, velocity: own[0]!.velocity, t: own[0]!.time - b.start });
    expect(best.lengthMs).toBeCloseTo(b.end - b.start);
  });

  it('a stored best pass replays with the same grade', () => {
    const i = input();
    const record = buildSessionRecord(i);
    const { take, hits } = replayTake(record, record.bestPass!);
    expect(take.lesson.notes).toEqual(fill.notes);
    expect(take.lesson.focus).toEqual(fill.focus);
    expect(hits).toHaveLength(record.bestPass!.hits.length);
    const original = summarize(i.takes[1]!.result);
    const replayed = summarize(take.result);
    expect([replayed.hit, replayed.wrongPad, replayed.missed, replayed.extra, replayed.accuracy]).toEqual([original.hit, original.wrongPad, original.missed, original.extra, original.accuracy]);
    expect(replayed.meanOffsetMs).toBeCloseTo(original.meanOffsetMs!, 6);
    expect(passRecord(take.lesson, take, i.ladder)).toEqual(record.passes[1]);
  });

  it('a song section keeps its place in the song for replay labels', () => {
    const song = { ...STARTER_LESSONS[0]!, id: 'my-song', category: 'song' as const, bars: 2, notes: [...STARTER_LESSONS[0]!.notes, ...STARTER_LESSONS[0]!.notes.map((n) => ({ ...n, bar: n.bar + 1 }))] };
    const section = barsLesson(song, 1, 1);
    const p = playPass(section, 100, 0, 0);
    const record = buildSessionRecord(input({ lesson: song, played: section, takes: [p.take], hits: p.hits, trainer: null, mode: 'practice' }));
    expect(record.lessonId).toBe('my-song');
    expect(record.bestPass!.lesson.section).toEqual({ firstBar: 1, totalBars: 2 });
    expect(replayTake(record, record.bestPass!).take.lesson.section).toEqual({ firstBar: 1, totalBars: 2 });
  });

  it('no passes: no best pass; a recording only counts its time', () => {
    const empty = buildSessionRecord(input({ takes: [], hits: [] }));
    expect(empty).toMatchObject({ passes: [], bestPass: null, source: 'none', trainer: { highestCleanBpm: null } });
    const rec = recordingSessionRecord({ id: 'r', startedAt: 5, endedAt: 9, playMs: 4000, bpm: 70, hits: [{ pad: 'snare', velocity: 1, time: 0, source: 'midi' }] });
    expect(isSessionRecord(rec)).toBe(true);
    expect(rec).toMatchObject({ mode: 'record', source: 'midi', passes: [], playMs: 4000 });
  });

  it('best pass: highest headline accuracy, then the faster pass', () => {
    expect(bestPassIndex([])).toBeNull();
    expect(bestPassIndex([pass({ focusAccuracy: 80 }), pass({ focusAccuracy: 95 }), pass({ focusAccuracy: 90 })])).toBe(1);
    expect(bestPassIndex([pass({ focusAccuracy: 95, bpm: 90 }), pass({ focusAccuracy: 95, bpm: 100 }), pass({ focusAccuracy: 95, bpm: 95 })])).toBe(1);
    expect(bestPassIndex([pass({ focusAccuracy: null }), pass({ focusAccuracy: 0 })])).toBe(1);
  });

  it('source is the most common one', () => {
    expect(sessionSource([])).toBe('none');
    expect(sessionSource([{ source: 'midi' }, { source: 'keyboard' }, { source: 'midi' }])).toBe('midi');
  });
});
