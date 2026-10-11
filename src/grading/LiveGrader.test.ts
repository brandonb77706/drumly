import { describe, expect, it } from 'vitest';
import { InputManager, type EmitFn, type Hit, type InputSource, type Pad } from '../input';
import { LiveGrader, type LiveGradeEvent } from './LiveGrader';
import { grade } from './match';
import { summarize } from './summary';
import type { ExpectedNote, HitVerdict } from './types';

class ManualSource implements InputSource {
  readonly name = 'manual';
  private emit: EmitFn | null = null;
  start(emit: EmitFn): void {
    this.emit = emit;
  }
  stop(): void {
    this.emit = null;
  }
  fire(hit: Hit): void {
    this.emit?.(hit);
  }
}

const note = (id: string, pad: Pad, time: number): ExpectedNote => ({ id, pad, time });
const hit = (pad: Pad, time: number): Hit => ({ pad, time, velocity: 100, source: 'test' });

async function rig(expected: ConstructorParameters<typeof LiveGrader>[1], options: { ignoreHitsBefore?: number } = {}) {
  const manager = new InputManager();
  const source = new ManualSource();
  manager.add(source);
  await manager.start();
  let now = 0;
  const grader = new LiveGrader(manager, expected, { ...options, autoCheck: false, now: () => now });
  const events: LiveGradeEvent[] = [];
  grader.onEvent((e) => events.push(e));
  /** Hits exactly as InputManager delivered them (it hands out frozen copies). */
  const delivered: Hit[] = [];
  manager.onHit((h) => delivered.push(h));
  grader.start();
  return {
    grader,
    events,
    delivered,
    /** Deliver a hit at wall-clock `arrival` (>= its timestamp, like real input). */
    play: (h: Hit, arrival = h.time) => {
      now = arrival;
      source.fire(h);
      grader.check(now);
    },
    advanceTo: (t: number) => {
      now = t;
      grader.check(now);
    },
  };
}

/** The most recent verdict emitted for each hit. */
function lastVerdicts(events: LiveGradeEvent[]): Map<Hit, HitVerdict> {
  const out = new Map<Hit, HitVerdict>();
  for (const e of events) if (e.type === 'hit' || e.type === 'revised') out.set(e.hit, e.verdict);
  return out;
}

describe('LiveGrader', () => {
  it('emits a verdict as each hit arrives', async () => {
    const { events, play } = await rig([note('a', 'snare', 1000)]);
    play(hit('snare', 1012));
    expect(events[0]).toMatchObject({ type: 'hit', verdict: { status: 'hit', offsetMs: 12, timing: 'perfect' } });
  });

  it('reports a miss only after the window (plus grace) has fully passed', async () => {
    const { events, advanceTo } = await rig([note('a', 'snare', 1000)]);
    advanceTo(1100); // window just closed
    advanceTo(1149); // still inside the 50 ms grace
    expect(events.filter((e) => e.type === 'missed')).toHaveLength(0);
    advanceTo(1151);
    advanceTo(1500);
    expect(events.filter((e) => e.type === 'missed')).toEqual([{ type: 'missed', note: expect.objectContaining({ id: 'a' }) }]);
    expect(events.at(-1)).toEqual({ type: 'complete' });
  });

  it('revises an earlier verdict when a closer hit arrives', async () => {
    const { events, play } = await rig([note('a', 'snare', 1000)]);
    const first = hit('snare', 960);
    const second = hit('snare', 1004);
    play(first);
    play(second);
    expect(events.map((e) => e.type)).toEqual(['hit', 'hit', 'revised']);
    expect(events[2]).toMatchObject({ type: 'revised', hit: first, verdict: { status: 'extra' }, previous: { status: 'hit' } });
  });

  it('ignores hits before ignoreHitsBefore (count-in)', async () => {
    const { grader, play } = await rig([note('a', 'snare', 1000)], { ignoreHitsBefore: 900 });
    play(hit('snare', 500));
    play(hit('snare', 1000));
    expect(grader.stop(2000).summary).toMatchObject({ hit: 1, extra: 0 });
  });

  it('pulls notes from a function (metronome-grid style) as time advances', async () => {
    const grid = (from: number, to: number) => {
      const out: ExpectedNote[] = [];
      for (let i = Math.max(0, Math.ceil(from / 500)); i * 500 < to; i++) out.push(note(`beat-${i}`, 'kick', i * 500));
      return out;
    };
    const { grader, play } = await rig(grid, { ignoreHitsBefore: 0 });
    play(hit('kick', 2));
    play(hit('kick', 497));
    play(hit('kick', 1010));
    const { summary } = grader.stop(1200);
    expect(summary).toMatchObject({ expected: 3, hit: 3, missed: 0 });
  });

  it('live and batch grading of the same hits give identical results', async () => {
    const notes: ExpectedNote[] = [];
    for (let i = 0; i < 16; i++) notes.push(note(`h${i}`, 'hihatClosed', 1000 + i * 300));
    for (let i = 0; i < 8; i += 2) notes.push(note(`k${i}`, 'kick', 1000 + i * 600));
    for (let i = 1; i < 8; i += 2) notes.push(note(`s${i}`, 'snare', 1000 + i * 600));

    // A messy performance: jitter, a wrong pad, a near-duplicate, a miss, extras,
    // and hits delivered out of timestamp order (as MIDI and keyboard can be).
    const performance: [Hit, number][] = [];
    notes.forEach((n, i) => {
      if (n.id === 's3') return; // missed
      const pad: Pad = n.id === 'h5' ? 'ride' : n.pad;
      const jitter = ((i * 37) % 61) - 30; // deterministic -30..+30
      const h = hit(pad, n.time + jitter);
      performance.push([h, h.time + ((i * 13) % 9)]); // delivered 0..8 ms late
    });
    performance.push([hit('snare', 1000 + 7 * 600 + 70), 1000 + 7 * 600 + 75]); // second hit near s7
    performance.push([hit('tom1', 2650), 2652]); // extra
    performance.sort((a, b) => a[1] - b[1]);

    const { grader, events, delivered, play, advanceTo } = await rig(notes);
    for (const [h, arrival] of performance) play(h, arrival);
    advanceTo(1000 + 16 * 300 + 500);
    const live = grader.stop();

    expect(delivered).toHaveLength(performance.length);
    const batch = grade(notes, delivered);
    expect(live.results).toEqual(batch);
    expect(live.summary).toEqual(summarize(batch));

    // The verdicts the UI last saw for each hit agree with batch too.
    const seen = lastVerdicts(events);
    for (const r of batch.notes) if (r.status !== 'missed') expect(seen.get(r.hit)).toEqual(r);
    for (const e of batch.extras) expect(seen.get(e.hit)).toEqual(e);
    // And every note batch calls missed was reported missed live.
    const missedLive = events.filter((e) => e.type === 'missed').map((e) => (e.type === 'missed' ? e.note.id : ''));
    expect(missedLive).toEqual(batch.notes.filter((r) => r.status === 'missed').map((r) => r.note.id));
    expect(live.summary).toMatchObject({ missed: 1, wrongPad: 1, extra: 2 });
  });

  it('stop() unsubscribes from input', async () => {
    const { grader, play, events } = await rig([note('a', 'snare', 1000)]);
    grader.stop(0);
    play(hit('snare', 1000));
    expect(events).toEqual([]);
  });
});
