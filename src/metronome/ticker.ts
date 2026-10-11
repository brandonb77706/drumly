/** Something that calls onTick roughly every intervalMs. Only drives the scheduler, never sound. */
export interface Ticker {
  start(onTick: () => void, intervalMs: number): void;
  stop(): void;
  dispose(): void;
}

/** Ticks from a Web Worker so background-tab throttling doesn't starve the scheduler. */
export class WorkerTicker implements Ticker {
  private readonly worker: Worker;
  private onTick: (() => void) | null = null;

  constructor() {
    this.worker = new Worker(new URL('./tickerWorker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = () => this.onTick?.();
  }

  start(onTick: () => void, intervalMs: number): void {
    this.onTick = onTick;
    this.worker.postMessage({ type: 'start', intervalMs });
  }

  stop(): void {
    this.onTick = null;
    this.worker.postMessage({ type: 'stop' });
  }

  dispose(): void {
    this.stop();
    this.worker.terminate();
  }
}

/** Main-thread fallback for environments without module workers. Throttled in background tabs. */
export class IntervalTicker implements Ticker {
  private timer: ReturnType<typeof setInterval> | null = null;

  start(onTick: () => void, intervalMs: number): void {
    this.stop();
    this.timer = setInterval(onTick, intervalMs);
  }

  stop(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
  }

  dispose(): void {
    this.stop();
  }
}

export function createDefaultTicker(): Ticker {
  try {
    if (typeof Worker !== 'undefined') return new WorkerTicker();
  } catch (error) {
    console.warn('Metronome worker unavailable, falling back to main-thread ticks', error);
  }
  return new IntervalTicker();
}
