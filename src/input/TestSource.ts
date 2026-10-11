import { clampVelocity } from './types';
import type { EmitFn, InputSource, Pad } from './types';

export interface ScriptedHit {
  pad: Pad;
  /** Milliseconds after start(). */
  at: number;
  /** 1..127. Defaults to 100. */
  velocity?: number;
}

export interface TestSourceOptions {
  name?: string;
  /** Clock used to anchor the script. Defaults to performance.now. */
  now?: () => number;
  /** Called after the last scripted hit has been emitted. */
  onDone?: () => void;
}

/**
 * Replays a script of hits in real time.
 * Each hit's timestamp is startTime + at, the scripted time, not when the timer
 * actually fired, so setTimeout jitter never shows up in timing data.
 */
export class TestSource implements InputSource {
  readonly name: string;
  private readonly script: readonly ScriptedHit[];
  private readonly now: () => number;
  private readonly onDone: (() => void) | undefined;
  private timers: ReturnType<typeof setTimeout>[] = [];

  constructor(script: readonly ScriptedHit[], options: TestSourceOptions = {}) {
    this.script = [...script].sort((a, b) => a.at - b.at);
    this.name = options.name ?? 'test';
    this.now = options.now ?? (() => performance.now());
    this.onDone = options.onDone;
  }

  start(emit: EmitFn): void {
    this.stop();
    const startTime = this.now();

    // Group hits that share a timestamp so simultaneous notes fire together, in order.
    const groups = new Map<number, ScriptedHit[]>();
    for (const step of this.script) {
      const group = groups.get(step.at);
      if (group) group.push(step);
      else groups.set(step.at, [step]);
    }

    let remaining = groups.size;
    if (remaining === 0) {
      this.onDone?.();
      return;
    }

    for (const [at, steps] of groups) {
      const timer = setTimeout(() => {
        for (const step of steps) {
          emit({
            pad: step.pad,
            velocity: clampVelocity(step.velocity ?? 100),
            time: startTime + at,
            source: 'test',
          });
        }
        remaining--;
        if (remaining === 0) {
          this.timers = [];
          this.onDone?.();
        }
      }, Math.max(0, at));
      this.timers.push(timer);
    }
  }

  stop(): void {
    for (const t of this.timers) clearTimeout(t);
    this.timers = [];
  }
}
