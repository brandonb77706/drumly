import { describe, expect, it, vi } from 'vitest';
import { Metronome, START_DELAY_S, type MetronomeClick } from './Metronome';
import type { Ticker } from './ticker';
import type { MetronomeSettings } from './ClickScheduler';
import { clickGain, type ClickMode } from './clickMode';
import { grade, summarize } from '../grading';
import { lessonToExpectedNotes, STARTER_LESSONS } from '../lessons';

/** performance.now() value when the fake AudioContext clock reads 0. */
const PERF_AT_ZERO = 50_000;
/** Fake output latency reported through getOutputTimestamp. */
const OUTPUT_LATENCY_MS = 20;

function fakeAudioContext() {
  /** Peak level of every click envelope, in scheduling order (only envelopes use linear ramps). */
  const clickLevels: number[] = [];
  const param = () => ({
    value: 0,
    setValueAtTime: vi.fn(),
    linearRampToValueAtTime: vi.fn((level: number) => clickLevels.push(level)),
    exponentialRampToValueAtTime: vi.fn(),
    setTargetAtTime: vi.fn(),
  });
  const node = () => ({ connect: vi.fn((n: unknown) => n), disconnect: vi.fn() });
  const oscillatorStarts: number[] = [];
  const ctx = {
    currentTime: 1,
    state: 'running',
    baseLatency: 0.005,
    outputLatency: 0.02,
    destination: {},
    resume: vi.fn(async () => {}),
    close: vi.fn(async () => {}),
    // The sample at contextTime is heard OUTPUT_LATENCY_MS after the clocks line up.
    getOutputTimestamp: () => ({ contextTime: ctx.currentTime, performanceTime: PERF_AT_ZERO + ctx.currentTime * 1000 + OUTPUT_LATENCY_MS }),
    createGain: () => ({ ...node(), gain: param() }),
    createOscillator: () => ({
      ...node(),
      type: 'sine',
      frequency: param(),
      onended: null,
      start: vi.fn((t: number) => oscillatorStarts.push(t)),
      stop: vi.fn(),
    }),
  };
  return { ctx, oscillatorStarts, clickLevels };
}

class ManualTicker implements Ticker {
  private onTick: (() => void) | null = null;
  start(onTick: () => void): void {
    this.onTick = onTick;
  }
  stop(): void {
    this.onTick = null;
  }
  dispose(): void {}
  tick(): void {
    this.onTick?.();
  }
}

/** A metronome on a fake audio clock that we advance by hand. */
async function rig(options: Partial<MetronomeSettings> & { latencyOffsetMs?: number; clickMode?: ClickMode } = {}) {
  const { ctx, oscillatorStarts, clickLevels } = fakeAudioContext();
  const ticker = new ManualTicker();
  const metronome = new Metronome({
    ...options,
    createAudioContext: () => ctx as unknown as AudioContext,
    createTicker: () => ticker,
    now: () => PERF_AT_ZERO + ctx.currentTime * 1000,
  });
  const clicks: MetronomeClick[] = [];
  metronome.onClick((c) => clicks.push(c));
  const info = await metronome.start();
  /** Advance the audio clock in 25 ms worker ticks. */
  const advance = (seconds: number) => {
    const end = ctx.currentTime + seconds;
    while (ctx.currentTime < end - 1e-9) {
      ctx.currentTime = Math.min(end, ctx.currentTime + 0.025);
      ticker.tick();
    }
  };
  return { ctx, metronome, clicks, info, advance, oscillatorStarts, clickLevels };
}

const heardAt = (contextTime: number) => PERF_AT_ZERO + contextTime * 1000 + OUTPUT_LATENCY_MS;

describe('Metronome', () => {
  it('schedules clicks on the audio clock and reports them on the performance.now() clock', async () => {
    const { clicks, advance, oscillatorStarts, info } = await rig({ bpm: 120 });
    advance(1.2);

    const firstAudio = 1 + START_DELAY_S;
    expect(oscillatorStarts.slice(0, 3)).toEqual([firstAudio, firstAudio + 0.5, firstAudio + 1]);
    [firstAudio, firstAudio + 0.5, firstAudio + 1].forEach((audio, i) => {
      expect(clicks[i]!.time).toBeCloseTo(heardAt(audio), 6);
    });
    expect(info?.firstClickTime).toBeCloseTo(heardAt(firstAudio), 6);
    expect(info?.downbeatTime).toBeCloseTo(heardAt(firstAudio), 6);
  });

  it('only schedules clicks within the 100 ms lookahead', async () => {
    const { ctx, clicks, advance } = await rig({ bpm: 120 });
    advance(0.5);
    for (const c of clicks) expect(c.audioTime).toBeLessThan(ctx.currentTime + 0.1);
  });

  it('latency offset shifts every click by exactly that amount', async () => {
    const plain = await rig({ bpm: 137, subdivision: 'triplet' });
    const offset = await rig({ bpm: 137, subdivision: 'triplet', latencyOffsetMs: 37.5 });
    plain.advance(3);
    offset.advance(3);

    expect(offset.clicks.length).toBe(plain.clicks.length);
    expect(plain.clicks.length).toBeGreaterThan(10);
    offset.clicks.forEach((c, i) => {
      expect(c.audioTime).toBe(plain.clicks[i]!.audioTime); // sound is not moved
      expect(c.time - plain.clicks[i]!.time).toBeCloseTo(37.5, 9);
    });
  });

  it('BPM change mid-run: next click lands one new interval after the last scheduled click, no duplicates', async () => {
    const { metronome, clicks, advance } = await rig({ bpm: 120 });
    advance(1.03);
    const lastBefore = clicks.at(-1)!;
    const countBefore = clicks.length;

    metronome.setBpm(80);
    advance(3);

    const next = clicks[countBefore]!;
    expect(next.index).toBe(lastBefore.index + 1);
    expect(next.audioTime - lastBefore.audioTime).toBeCloseTo(0.75, 12);
    expect(next.time - lastBefore.time).toBeCloseTo(750, 6);
    expect(new Set(clicks.map((c) => c.index)).size).toBe(clicks.length);
    clicks.forEach((c, i) => expect(c.index).toBe(i));
  });

  it('count-in clicks are marked and the downbeat follows one bar later', async () => {
    const { clicks, advance, info } = await rig({ bpm: 120, beatsPerBar: 3, countIn: true });
    advance(2);
    expect(clicks.slice(0, 4).map((c) => [c.bar, c.beat, c.isCountIn])).toEqual([
      [-1, 0, true],
      [-1, 1, true],
      [-1, 2, true],
      [0, 0, false],
    ]);
    expect(info!.downbeatTime - info!.firstClickTime).toBeCloseTo(1500, 6);
    expect(clicks[3]!.time).toBeCloseTo(info!.downbeatTime, 6);
  });

  describe('getGrid', () => {
    it('returns scheduled and projected clicks in a window, start inclusive and end exclusive', async () => {
      const { metronome, clicks, advance } = await rig({ bpm: 120, subdivision: 'eighth' });
      advance(0.3);
      const t0 = clicks[0]!.time;

      // Window spans clicks already scheduled and ones not yet scheduled.
      const grid = metronome.getGrid(t0, t0 + 2000);
      expect(grid.map((c) => c.time - t0)).toEqual([0, 250, 500, 750, 1000, 1250, 1500, 1750]);
      expect(grid.map((c) => c.index)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);

      // Partial window starting and ending between clicks.
      expect(metronome.getGrid(t0 + 600, t0 + 1100).map((c) => c.time - t0)).toEqual([750, 1000]);
      // Empty window between two clicks.
      expect(metronome.getGrid(t0 + 10, t0 + 240)).toEqual([]);
    });

    it('projected clicks match what is later actually scheduled', async () => {
      const { metronome, clicks, advance } = await rig({ bpm: 97, subdivision: 'sixteenth' });
      advance(0.2);
      const t0 = clicks[0]!.time;
      const projected = metronome.getGrid(t0, t0 + 3000);
      advance(3.5);
      const actual = clicks.filter((c) => c.time >= t0 && c.time < t0 + 3000);
      expect(projected.length).toBe(actual.length);
      projected.forEach((p, i) => {
        const { time, ...rest } = actual[i]!;
        expect(p).toMatchObject(rest);
        // Clock reference is re-read every second, so allow float-level differences only.
        expect(p.time).toBeCloseTo(time, 6);
      });
    });

    it('stop() silences pending clicks and drops them from the grid', async () => {
      const { ctx, metronome, advance } = await rig({ bpm: 300 });
      advance(0.5);
      metronome.stop();
      for (const c of metronome.getGrid(0, Infinity)) expect(c.audioTime).toBeLessThan(ctx.currentTime);
      expect(metronome.isRunning).toBe(false);
    });
  });

  it('falls back to currentTime + outputLatency when getOutputTimestamp has no data yet', async () => {
    const { ctx } = fakeAudioContext();
    ctx.getOutputTimestamp = () => ({ contextTime: 0, performanceTime: 0 });
    const ticker = new ManualTicker();
    const metronome = new Metronome({
      bpm: 120,
      createAudioContext: () => ctx as unknown as AudioContext,
      createTicker: () => ticker,
      now: () => PERF_AT_ZERO + ctx.currentTime * 1000,
    });
    const clicks: MetronomeClick[] = [];
    metronome.onClick((c) => clicks.push(c));
    await metronome.start();
    ctx.currentTime = 1.05;
    ticker.tick();
    // outputLatency is 0.02 s in the fake context.
    expect(clicks[0]!.time).toBeCloseTo(PERF_AT_ZERO + (1 + START_DELAY_S) * 1000 + 20, 9);
    expect(metronome.getClockInfo().source).toBe('estimate');
  });

  it('switches from the estimate to getOutputTimestamp on the first tick it has data', async () => {
    const { ctx } = fakeAudioContext();
    const realStamp = ctx.getOutputTimestamp;
    ctx.getOutputTimestamp = () => ({ contextTime: 0, performanceTime: 0 });
    const ticker = new ManualTicker();
    const metronome = new Metronome({
      createAudioContext: () => ctx as unknown as AudioContext,
      createTicker: () => ticker,
      now: () => PERF_AT_ZERO + ctx.currentTime * 1000,
    });
    await metronome.start();
    expect(metronome.getClockInfo().source).toBe('estimate');

    ctx.getOutputTimestamp = realStamp;
    ctx.currentTime += 0.025; // well under the 1 s refresh interval
    ticker.tick();
    expect(metronome.getClockInfo().source).toBe('outputTimestamp');
  });
});

describe('click mode', () => {
  const lesson = STARTER_LESSONS[1]!; // 8th-note rock beat
  const settings = { bpm: lesson.defaultBpm, beatsPerBar: lesson.beatsPerBar, subdivision: lesson.subdivision, countIn: true };
  /** Long enough for the count-in and both bars. */
  const RUN_S = ((lesson.bars + 1) * lesson.beatsPerBar * 60) / lesson.defaultBpm + 0.5;

  it('clickGain: on is always audible, muted never, count-in only during the count-in', () => {
    expect([clickGain('on', true), clickGain('on', false)]).toEqual([1, 1]);
    expect([clickGain('muted', true), clickGain('muted', false)]).toEqual([0, 0]);
    expect([clickGain('countInOnly', true), clickGain('countInOnly', false)]).toEqual([1, 0]);
  });

  for (const mode of ['muted', 'countInOnly'] as const) {
    it(`${mode}: clicks are scheduled at identical times and a perfect run still grades 100%`, async () => {
      const on = await rig({ ...settings, clickMode: 'on' });
      const quiet = await rig({ ...settings, clickMode: mode });
      on.advance(RUN_S);
      quiet.advance(RUN_S);

      expect(quiet.clicks.length).toBeGreaterThan(4 + 16);
      expect(quiet.oscillatorStarts).toEqual(on.oscillatorStarts);
      expect(quiet.clicks.map((c) => [c.time, c.audioTime, c.bar, c.beat, c.subdivision])).toEqual(
        on.clicks.map((c) => [c.time, c.audioTime, c.bar, c.beat, c.subdivision]),
      );

      // Grade against the quiet run's grid, with hits played exactly on the audible run's notes.
      const quietNotes = lessonToExpectedNotes(lesson, quiet.clicks);
      const played = lessonToExpectedNotes(lesson, on.clicks);
      const hits = played.map((n) => ({ pad: n.pad, time: n.time, velocity: 100, source: 'test' as const }));
      const summary = summarize(grade(quietNotes, hits, { equivalentPads: lesson.equivalentPads ?? [] }));
      expect(summary).toMatchObject({ expected: lesson.notes.length, hit: lesson.notes.length, accuracy: 100 });
    });
  }

  it('count-in only: count-in clicks are audible and every click after is at zero gain', async () => {
    const { clicks, clickLevels, advance } = await rig({ ...settings, clickMode: 'countInOnly' });
    advance(RUN_S);
    expect(clickLevels).toHaveLength(clicks.length);
    clicks.forEach((c, i) => {
      if (c.isCountIn) expect(clickLevels[i]).toBeGreaterThan(0);
      else expect(clickLevels[i]).toBe(0);
    });
    expect(clicks.filter((c) => c.isCountIn)).toHaveLength(4);
  });

  it('muted: every click is at zero gain; on: every click is audible', async () => {
    const muted = await rig({ ...settings, clickMode: 'muted' });
    const on = await rig({ ...settings, clickMode: 'on' });
    muted.advance(RUN_S);
    on.advance(RUN_S);
    expect(muted.clickLevels.every((l) => l === 0)).toBe(true);
    expect(on.clickLevels.every((l) => l > 0)).toBe(true);
    expect(muted.clickLevels).toHaveLength(on.clickLevels.length);
  });

  it('setClickMode mid-run changes loudness only, from the next booked click', async () => {
    const { metronome, clicks, clickLevels, advance } = await rig({ ...settings });
    advance(1);
    const before = clicks.length;
    metronome.setClickMode('muted');
    expect(metronome.getSettings().clickMode).toBe('muted');
    advance(1);
    expect(clickLevels.slice(0, before).every((l) => l > 0)).toBe(true);
    expect(clickLevels.slice(before).every((l) => l === 0)).toBe(true);
    expect(clicks.length).toBeGreaterThan(before);
  });
});
