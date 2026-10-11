import { describe, expect, it } from 'vitest';
import { DEFAULT_GRADING_CONFIG, grade } from '../grading';
import type { Hit, Pad } from '../input';
import { ClickScheduler } from '../metronome/ClickScheduler';
import type { ExpectedNote } from '../grading';
import { FILL_LESSONS, lessonToExpectedNotes, noteIndex, notePass } from '../lessons';
import type { GridClick } from '../metronome';
import { TrainerSession, passBpm } from './TrainerSession';

const toms = FILL_LESSONS.find((l) => l.id === 'fill-around-toms')!;
const label = (p: Pad) => ({ tom1: 'Tom 1', tom2: 'Tom 2', tom3: 'Tom 3', snare: 'Snare' } as Record<string, string>)[p] ?? p;
/** The tom 2 on the 'e' of beat 4 in the fill. */
const TOM2_E = toms.notes.findIndex((n) => n.pad === 'tom2' && n.bar === 1 && n.beat === 3 && n.subdivision === 1);
/** LiveGrader's window plus miss grace: when the app reports a pass. */
const REPORT_DELAY_S = (DEFAULT_GRADING_CONFIG.windowMs + 50) / 1000;
const LOOKAHEAD_S = 0.1;

/**
 * Drives the real scheduler the way the app does: clicks are booked 100 ms ahead; a pass is
 * judged 150 ms after its last note; a BPM change is booked for the first pass start whose
 * downbeat isn't scheduled yet.
 */
function rig() {
  const session = new TrainerSession(toms, { startBpm: 60, targetBpm: 70, stepBpm: 5, passThreshold: 90, passesNeeded: 2 });
  const scheduler = new ClickScheduler({ bpm: session.bpm, beatsPerBar: 4, subdivision: 'sixteenth', countIn: true });
  scheduler.start(1);
  const clicks: GridClick[] = [];
  let now = 1;
  const advanceTo = (t: number) => {
    for (; now < t; now = Math.min(t, now + 0.025)) clicks.push(...scheduler.scheduleUntil(now + LOOKAHEAD_S));
  };
  const ms = (c: GridClick) => ({ ...c, time: c.time * 1000 });
  const known = () => [...clicks, ...scheduler.peek(now + 60)].map(ms);
  const downbeat = (bar: number) => known().find((c) => c.bar === bar && c.beat === 0 && c.subdivision === 0)!.time;

  /** Play pass k with `hitFor` deciding each hit (or null to skip); returns the session's report. */
  function playPass(k: number, hitFor: (n: ExpectedNote) => Hit | null) {
    let notes: ExpectedNote[] = [];
    // Advance until every note of pass k is in the scheduled grid.
    while (notes.length < toms.notes.length) {
      advanceTo(now + 0.25);
      notes = lessonToExpectedNotes(toms, clicks.map(ms), { passes: Infinity }).filter((n) => notePass(n.id) === k);
    }
    advanceTo(notes.at(-1)!.time / 1000 + REPORT_DELAY_S);
    const hits = notes.map(hitFor).filter((h): h is Hit => h !== null);
    const result = grade(notes, hits, { equivalentPads: toms.equivalentPads ?? [] });
    const played = passBpm(toms, downbeat(k * toms.bars), downbeat((k + 1) * toms.bars));
    const report = session.recordPass(k, result, played);
    if (report.change === 'speedUp' || report.change === 'slowDown') {
      const bar = Math.ceil(scheduler.nextUnscheduledBar() / toms.bars) * toms.bars;
      expect(scheduler.updateAtBar(bar, { bpm: session.bpm })).toBe(true);
    }
    return { report, notes };
  }
  return { session, playPass };
}

const perfect = (n: ExpectedNote): Hit => ({ pad: n.pad, time: n.time, velocity: 100, source: 'test' });
const tomLate = (n: ExpectedNote): Hit => ({ ...perfect(n), time: n.time + (noteIndex(n.id) === TOM2_E ? 35 : 0) });

describe('scripted trainer session', () => {
  it('2 perfect passes at 60 BPM move to 65; a consistently late tom becomes the top problem spot', () => {
    const { session, playPass } = rig();

    const p0 = playPass(0, perfect).report;
    expect(p0).toMatchObject({ bpm: 60, counted: true, change: 'none', focus: { accuracy: 100 } });
    const p1 = playPass(1, perfect).report;
    expect(p1).toMatchObject({ bpm: 60, counted: true, change: 'speedUp', message: 'Clean! Speeding up to 65 BPM' });
    expect(session.progress()).toBe('65 → 70 BPM, 0 of 2 clean passes');

    // The change lands on the very next pass: decided at the landing, 3 beats before pass 3's downbeat.
    const p2 = playPass(2, tomLate);
    expect(p2.report.bpm).toBeCloseTo(65, 6);
    expect(p2.report.counted).toBe(true);
    // Notes in pass 2 are spaced for 65 BPM: one 16th = 60000 / 65 / 4 ms.
    expect(p2.notes[2]!.time - p2.notes[1]!.time).toBeCloseTo(2 * (60000 / 65 / 4), 6);

    playPass(3, tomLate);
    playPass(4, tomLate);

    const [top] = session.problems.worst();
    expect(top!.stats.index).toBe(TOM2_E);
    expect(session.problems.describe(top!, label)).toBe(
      "Tom 2 on the 'e' of beat 4 (bar 2): late in 3 of 5 passes, about 21 ms late on average",
    );
    // 35 ms late is still a "good" hit, so the ladder kept climbing and finished at the target.
    expect(session.reports.map((r) => [r.bpm.toFixed(2), r.change])).toEqual([
      ['60.00', 'none'],
      ['60.00', 'speedUp'],
      ['65.00', 'none'],
      ['65.00', 'speedUp'],
      ['70.00', 'none'],
    ]);
  });

  it('a pass played at a stale tempo is reported but not counted on the ladder', () => {
    // Threshold 0 and 1 pass needed: every counted pass speeds up.
    const session = new TrainerSession(toms, { startBpm: 60, targetBpm: 70, stepBpm: 5, passThreshold: 0, passesNeeded: 1 });
    const empty = { notes: [], extras: [] };
    expect(session.recordPass(0, empty, 60).change).toBe('speedUp');
    expect(session.bpm).toBe(65);
    // The change missed the next pass, which was still played at 60.
    const stale = session.recordPass(1, empty, 60);
    expect(stale).toMatchObject({ counted: false, change: 'none', bpm: 60 });
    expect(stale.message).toBe('Played at 60 BPM before the tempo change; not counted.');
    expect(session.state.passes).toBe(1);
    expect(session.recordPass(2, empty, 65.0001)).toMatchObject({ counted: true, change: 'speedUp' });
  });

  it('passBpm reads the tempo from a pass span', () => {
    expect(passBpm(toms, 1000, 1000 + 3 * 4 * 1000)).toBeCloseTo(60, 9);
    expect(passBpm(toms, 0, (3 * 4 * 60_000) / 65)).toBeCloseTo(65, 9);
  });
});
