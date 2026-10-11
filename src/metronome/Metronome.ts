import { ClickScheduler, type MetronomeSettings } from './ClickScheduler';
import { createDefaultTicker, type Ticker } from './ticker';
import {
  contextToPerformanceTime,
  performanceToContextTime,
  type ClockReference,
  type GridClick,
  type Subdivision,
} from './timing';

/** A scheduled click. Fired when scheduled; `time` says when it will be heard. */
export interface MetronomeClick extends Omit<GridClick, 'time'> {
  /** When the click is heard, in ms on the performance.now() clock (same clock as Hit.time). */
  time: number;
  /** When the click starts on the AudioContext clock, in seconds. */
  audioTime: number;
}

export type ClickListener = (click: MetronomeClick) => void;

export interface MetronomeStartInfo {
  /** performance.now() ms of the first click (count-in or bar 0). */
  firstClickTime: number;
  /** performance.now() ms of bar 0, beat 1: the first non-count-in click. */
  downbeatTime: number;
}

export type ClockSource = 'outputTimestamp' | 'estimate' | 'none';

export interface MetronomeOptions extends Partial<MetronomeSettings> {
  /** 0..1, default 0.8. */
  volume?: number;
  /** Added to every click time, in ms. Default 0. */
  latencyOffsetMs?: number;
  /** For tests. Defaults to `new AudioContext({ latencyHint: 'interactive' })`. */
  createAudioContext?: () => AudioContext;
  /** For tests. Defaults to a Web Worker ticker. */
  createTicker?: () => Ticker;
  /** For tests. Defaults to performance.now. */
  now?: () => number;
}

/** How often the scheduler wakes up. */
export const TICK_INTERVAL_MS = 25;
/** How far ahead each wake-up schedules clicks. Must comfortably exceed the tick interval. */
export const LOOKAHEAD_S = 0.1;
/** Gap between start() and the first click, so the first click is never late. */
export const START_DELAY_S = 0.1;
/** How often the AudioContext <-> performance.now() reference pair is re-read. */
export const CLOCK_REFRESH_S = 1;

const CLICK_ATTACK_S = 0.002;
const CLICK_DECAY_S = 0.03;
const SOUNDS = {
  accent: { frequency: 1760, level: 1 },
  beat: { frequency: 1320, level: 0.75 },
  subdivision: { frequency: 880, level: 0.35 },
} as const;

/**
 * Sample-accurate metronome using lookahead scheduling:
 * a worker ticks every ~25 ms, and each tick books every click due in the next 100 ms
 * with oscillator.start(exactAudioTime). Timer jitter only affects *when clicks get booked*,
 * never when they sound.
 */
export class Metronome {
  private readonly scheduler: ClickScheduler;
  private readonly createAudioContext: () => AudioContext;
  private readonly createTicker: () => Ticker;
  private readonly now: () => number;

  private volume: number;
  private latencyOffsetMs: number;

  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private ticker: Ticker | null = null;
  private ref: ClockReference | null = null;
  private refReadAt = -Infinity;
  private clockSource: ClockSource = 'none';

  private readonly listeners = new Set<ClickListener>();
  private readonly voices = new Set<OscillatorNode>();
  private history: MetronomeClick[] = [];
  private running = false;
  private generation = 0;
  private dropped = 0;

  constructor(options: MetronomeOptions = {}) {
    const { volume, latencyOffsetMs, createAudioContext, createTicker, now, ...settings } = options;
    this.scheduler = new ClickScheduler(settings);
    this.volume = clamp01(volume ?? 0.8);
    this.latencyOffsetMs = latencyOffsetMs ?? 0;
    this.createAudioContext = createAudioContext ?? (() => new AudioContext({ latencyHint: 'interactive' }));
    this.createTicker = createTicker ?? createDefaultTicker;
    this.now = now ?? (() => performance.now());
  }

  // ---- lifecycle -----------------------------------------------------------

  /**
   * Start clicking. Call this from a user gesture (click handler): the AudioContext is
   * created/resumed synchronously before the first await, which satisfies autoplay rules.
   * Resolves to null if stop() was called before audio was ready.
   */
  async start(): Promise<MetronomeStartInfo | null> {
    if (this.running) return this.startInfo();
    const generation = ++this.generation;

    const ctx = this.ensureContext();
    if (ctx.state !== 'running') await ctx.resume();
    if (generation !== this.generation) return null;

    this.running = true;
    this.history = [];
    this.dropped = 0;
    this.refreshClockReference(true);
    this.scheduler.start(ctx.currentTime + START_DELAY_S);

    this.ticker ??= this.createTicker();
    this.ticker.start(() => this.tick(), TICK_INTERVAL_MS);
    this.tick();
    return this.startInfo();
  }

  stop(): void {
    this.generation++;
    if (!this.running) return;
    this.running = false;
    this.ticker?.stop();
    this.scheduler.stop();

    // Silence clicks that were booked but haven't sounded yet, and forget them.
    for (const voice of this.voices) {
      try {
        voice.stop();
      } catch {
        // already stopped
      }
      voice.disconnect();
    }
    this.voices.clear();
    const now = this.ctx?.currentTime ?? 0;
    this.history = this.history.filter((c) => c.audioTime < now);
  }

  /** Stop and release the AudioContext and worker. */
  async dispose(): Promise<void> {
    this.stop();
    this.ticker?.dispose();
    this.ticker = null;
    const ctx = this.ctx;
    this.ctx = null;
    this.master = null;
    await ctx?.close();
  }

  get isRunning(): boolean {
    return this.running;
  }

  // ---- settings ------------------------------------------------------------

  /** 30..300. While playing, takes effect from the next beat. */
  setBpm(bpm: number): void {
    this.scheduler.update({ bpm });
  }

  /** While playing, takes effect from the next bar. */
  setBeatsPerBar(beats: number): void {
    this.scheduler.update({ beatsPerBar: beats });
  }

  /** While playing, takes effect from the next beat. */
  setSubdivision(subdivision: Subdivision): void {
    this.scheduler.update({ subdivision });
  }

  setAccent(enabled: boolean): void {
    this.scheduler.update({ accent: enabled });
  }

  /** Takes effect on the next start(). */
  setCountIn(enabled: boolean): void {
    this.scheduler.update({ countIn: enabled });
  }

  /** 0..1. Applied smoothly, immediately. */
  setVolume(volume: number): void {
    this.volume = clamp01(volume);
    if (this.ctx && this.master) this.master.gain.setTargetAtTime(this.volume, this.ctx.currentTime, 0.01);
  }

  /** Added to every click time from the next scheduled click on. Positive = clicks treated as heard later. */
  setLatencyOffset(ms: number): void {
    if (!Number.isFinite(ms)) throw new RangeError(`Latency offset must be a number, got ${ms}`);
    this.latencyOffsetMs = ms;
  }

  getSettings(): MetronomeSettings & { volume: number; latencyOffsetMs: number } {
    return { ...this.scheduler.getSettings(), volume: this.volume, latencyOffsetMs: this.latencyOffsetMs };
  }

  /** How click times are being mapped to performance.now(), for display and debugging. */
  getClockInfo(): { source: ClockSource; latencyMs: number; droppedClicks: number } {
    return { source: this.clockSource, latencyMs: this.ref?.latencyMs ?? 0, droppedClicks: this.dropped };
  }

  // ---- events and grid -----------------------------------------------------

  /** Called as each click is scheduled (up to ~100 ms before it's heard). Returns an unsubscribe function. */
  onClick(listener: ClickListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Expected click times with time in [fromTime, toTime), in performance.now() ms.
   * Includes clicks already scheduled in this run (exact values that were emitted) and,
   * while running, clicks not yet scheduled, projected from the current settings.
   */
  getGrid(fromTime: number, toTime: number): MetronomeClick[] {
    const out = this.history.filter((c) => c.time >= fromTime && c.time < toTime);
    if (this.running && this.ref) {
      // Small margin so a projected click near the window edge is never missed.
      const horizon = performanceToContextTime(toTime, this.ref, this.latencyOffsetMs) + 0.05;
      for (const click of this.scheduler.peek(horizon)) {
        const event = this.toEvent(click);
        if (event.time >= fromTime && event.time < toTime) out.push(event);
      }
    }
    return out;
  }

  // ---- internals -----------------------------------------------------------

  private ensureContext(): AudioContext {
    if (!this.ctx) {
      const ctx = this.createAudioContext();
      const master = ctx.createGain();
      master.gain.value = this.volume;
      master.connect(ctx.destination);
      this.ctx = ctx;
      this.master = master;
    }
    return this.ctx;
  }

  private tick(): void {
    const ctx = this.ctx;
    if (!this.running || !ctx) return;
    this.refreshClockReference(false);

    for (const click of this.scheduler.scheduleUntil(ctx.currentTime + LOOKAHEAD_S)) {
      if (click.time < ctx.currentTime) {
        // The scheduler was starved (e.g. the whole page froze). Playing now would be late,
        // which is worse than skipping, and the grid must only contain clicks that sound.
        this.dropped++;
        continue;
      }
      this.playClick(ctx, click);
      const event = this.toEvent(click);
      this.history.push(event);
      for (const listener of [...this.listeners]) {
        try {
          listener(event);
        } catch (error) {
          console.error('Metronome click listener threw', error);
        }
      }
    }
  }

  private refreshClockReference(force: boolean): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const stale = ctx.currentTime - this.refReadAt >= CLOCK_REFRESH_S;
    // While only an estimate is available, retry getOutputTimestamp on every tick so we
    // switch to the accurate source as soon as audio is flowing.
    if (!force && !stale && this.clockSource === 'outputTimestamp') return;

    const stamp = typeof ctx.getOutputTimestamp === 'function' ? ctx.getOutputTimestamp() : undefined;
    const contextTime = stamp?.contextTime ?? 0;
    const performanceTime = stamp?.performanceTime ?? 0;
    // Browsers report zeros until audio is actually flowing to the device.
    if (contextTime > 0 && performanceTime > 0) {
      // performanceTime is when the frame at contextTime reaches the speakers: latency included.
      this.ref = { contextTime, performanceTime, latencyMs: 0 };
      this.clockSource = 'outputTimestamp';
      this.refReadAt = ctx.currentTime;
    } else if (force || stale || !this.ref) {
      // Re-reading the estimate every tick would add jitter, so only on the normal schedule.
      this.refReadAt = ctx.currentTime;
      const latencySeconds = ctx.outputLatency || ctx.baseLatency || 0;
      this.ref = { contextTime: ctx.currentTime, performanceTime: this.now(), latencyMs: latencySeconds * 1000 };
      this.clockSource = 'estimate';
    }
  }

  private toEvent(click: GridClick): MetronomeClick {
    const { time: audioTime, ...rest } = click;
    const ref = this.ref ?? { contextTime: 0, performanceTime: 0, latencyMs: 0 };
    return { ...rest, audioTime, time: contextToPerformanceTime(audioTime, ref, this.latencyOffsetMs) };
  }

  private playClick(ctx: AudioContext, click: GridClick): void {
    if (!this.master) return;
    const sound = click.isAccent ? SOUNDS.accent : click.subdivision === 0 ? SOUNDS.beat : SOUNDS.subdivision;
    const t = click.time;

    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = sound.frequency;

    const envelope = ctx.createGain();
    envelope.gain.setValueAtTime(0, t);
    envelope.gain.linearRampToValueAtTime(sound.level, t + CLICK_ATTACK_S);
    envelope.gain.exponentialRampToValueAtTime(0.0001, t + CLICK_DECAY_S);

    osc.connect(envelope);
    envelope.connect(this.master);
    osc.onended = () => {
      osc.disconnect();
      envelope.disconnect();
      this.voices.delete(osc);
    };
    this.voices.add(osc);
    osc.start(t);
    osc.stop(t + CLICK_DECAY_S + 0.005);
  }

  private startInfo(): MetronomeStartInfo {
    // The first real downbeat is within the first bar + 1 clicks (count-in is quarters only).
    const upcoming = [...this.history, ...this.scheduler.peek(Infinity, 64).map((c) => this.toEvent(c))];
    const first = upcoming[0];
    const downbeat = upcoming.find((c) => c.bar === 0 && c.beat === 0 && c.subdivision === 0);
    return { firstClickTime: first?.time ?? NaN, downbeatTime: downbeat?.time ?? NaN };
  }
}

function clamp01(v: number): number {
  return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0;
}
