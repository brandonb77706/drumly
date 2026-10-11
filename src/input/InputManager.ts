import type { Hit, HitListener, InputSource } from './types';

export interface SourceFailure {
  name: string;
  error: unknown;
}

export interface StartResult {
  started: string[];
  failed: SourceFailure[];
}

interface SourceEntry {
  /** Hits are only forwarded while active, so late events from a stopped source are dropped. */
  active: boolean;
}

/**
 * The only object the rest of the app talks to.
 * Fans hits from any number of sources out to listeners, and optionally records them.
 */
export class InputManager {
  private readonly sources = new Map<InputSource, SourceEntry>();
  private readonly listeners = new Set<HitListener>();
  private recording: Hit[] | null = null;
  private running = false;

  /**
   * Register a source. If the manager is already running, the source starts immediately
   * (its start failure is logged, not thrown). Returns a function that stops and removes it.
   */
  add(source: InputSource): () => void {
    if (!this.sources.has(source)) {
      const entry: SourceEntry = { active: false };
      this.sources.set(source, entry);
      if (this.running) {
        this.startSource(source, entry).catch((error: unknown) => {
          console.error(`Input source "${source.name}" failed to start`, error);
        });
      }
    }
    return () => this.remove(source);
  }

  remove(source: InputSource): void {
    const entry = this.sources.get(source);
    if (!entry) return;
    this.sources.delete(source);
    this.stopSource(source, entry);
  }

  /**
   * Start every registered source that isn't already running. Sources start in parallel;
   * one failing (sync throw or rejection) never prevents the others from working.
   */
  async start(): Promise<StartResult> {
    this.running = true;
    const pending = [...this.sources].filter(([, entry]) => !entry.active);
    const results = await Promise.allSettled(pending.map(([source, entry]) => this.startSource(source, entry)));

    const result: StartResult = { started: [], failed: [] };
    results.forEach((outcome, i) => {
      const name = pending[i]![0].name;
      if (outcome.status === 'fulfilled') result.started.push(name);
      else result.failed.push({ name, error: outcome.reason });
    });
    return result;
  }

  stop(): void {
    this.running = false;
    for (const [source, entry] of this.sources) this.stopSource(source, entry);
  }

  /** Subscribe to hits. Returns an unsubscribe function. */
  onHit(listener: HitListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Begin capturing hits. Calling again discards the current capture and starts fresh. */
  startRecording(): void {
    this.recording = [];
  }

  /** Stop capturing and return the hits received since startRecording(), sorted by time. */
  stopRecording(): Hit[] {
    const hits = this.recording ?? [];
    this.recording = null;
    return hits.sort((a, b) => a.time - b.time);
  }

  get isRecording(): boolean {
    return this.recording !== null;
  }

  private async startSource(source: InputSource, entry: SourceEntry): Promise<void> {
    entry.active = true;
    try {
      await source.start((hit) => {
        if (entry.active) this.dispatch(hit);
      });
    } catch (error) {
      entry.active = false;
      safeStop(source);
      throw error;
    }
  }

  private stopSource(source: InputSource, entry: SourceEntry): void {
    entry.active = false;
    safeStop(source);
  }

  private dispatch(hit: Hit): void {
    const frozen = Object.freeze({ ...hit });
    this.recording?.push(frozen);
    // Snapshot so listeners can unsubscribe during dispatch.
    for (const listener of [...this.listeners]) {
      try {
        listener(frozen);
      } catch (error) {
        console.error('Hit listener threw', error);
      }
    }
  }
}

function safeStop(source: InputSource): void {
  try {
    source.stop();
  } catch (error) {
    console.error(`Input source "${source.name}" failed to stop`, error);
  }
}
