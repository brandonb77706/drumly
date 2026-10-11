import { afterEach, describe, expect, it, vi } from 'vitest';
import { InputManager } from './InputManager';
import type { EmitFn, Hit, InputSource, Pad } from './types';

/** A source we can fire hits from by hand. */
class ManualSource implements InputSource {
  emit: EmitFn | null = null;
  stopped = 0;
  constructor(readonly name: string, private readonly kind: Hit['source'] = 'test') {}
  start(emit: EmitFn): void {
    this.emit = emit;
  }
  stop(): void {
    this.stopped++;
    this.emit = null;
  }
  hit(pad: Pad, time: number, velocity = 100): void {
    this.emit?.({ pad, velocity, time, source: this.kind });
  }
}

class ThrowingSource implements InputSource {
  readonly name = 'broken-sync';
  start(): void {
    throw new Error('no device');
  }
  stop(): void {}
}

class RejectingSource implements InputSource {
  readonly name = 'broken-async';
  async start(): Promise<void> {
    throw new Error('Web MIDI is not supported');
  }
  stop(): void {}
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('InputManager', () => {
  it('delivers hits from multiple sources to every listener', async () => {
    const manager = new InputManager();
    const kb = new ManualSource('keyboard', 'keyboard');
    const midi = new ManualSource('midi', 'midi');
    manager.add(kb);
    manager.add(midi);
    const a: Hit[] = [];
    const b: Hit[] = [];
    manager.onHit((h) => a.push(h));
    manager.onHit((h) => b.push(h));

    const result = await manager.start();
    expect(result).toEqual({ started: ['keyboard', 'midi'], failed: [] });

    kb.hit('snare', 10);
    midi.hit('kick', 20);

    expect(a.map((h) => [h.pad, h.source, h.time])).toEqual([
      ['snare', 'keyboard', 10],
      ['kick', 'midi', 20],
    ]);
    expect(b).toEqual(a);
  });

  it('keeps working sources running when others fail, and reports the failures', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const manager = new InputManager();
    const kb = new ManualSource('keyboard', 'keyboard');
    manager.add(new ThrowingSource());
    manager.add(kb);
    manager.add(new RejectingSource());
    const hits: Hit[] = [];
    manager.onHit((h) => hits.push(h));

    const result = await manager.start();

    expect(result.started).toEqual(['keyboard']);
    expect(result.failed.map((f) => f.name)).toEqual(['broken-sync', 'broken-async']);
    expect(String(result.failed[1]!.error)).toContain('Web MIDI is not supported');

    kb.hit('hihatClosed', 5);
    expect(hits).toHaveLength(1);
  });

  it('does not let a throwing listener block other listeners', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const manager = new InputManager();
    const src = new ManualSource('s');
    manager.add(src);
    const good = vi.fn();
    manager.onHit(() => {
      throw new Error('bad listener');
    });
    manager.onHit(good);
    await manager.start();

    src.hit('kick', 1);
    expect(good).toHaveBeenCalledTimes(1);
  });

  it('unsubscribe stops delivery to that listener only', async () => {
    const manager = new InputManager();
    const src = new ManualSource('s');
    manager.add(src);
    const kept = vi.fn();
    const removed = vi.fn();
    manager.onHit(kept);
    const unsubscribe = manager.onHit(removed);
    await manager.start();

    src.hit('kick', 1);
    unsubscribe();
    unsubscribe(); // idempotent
    src.hit('snare', 2);

    expect(removed).toHaveBeenCalledTimes(1);
    expect(kept).toHaveBeenCalledTimes(2);
  });

  it('records only hits between startRecording and stopRecording', async () => {
    const manager = new InputManager();
    const src = new ManualSource('s');
    manager.add(src);
    await manager.start();

    src.hit('kick', 1); // before
    manager.startRecording();
    src.hit('snare', 2);
    src.hit('hihatClosed', 3);
    const recorded = manager.stopRecording();
    src.hit('crash', 4); // after

    expect(recorded.map((h) => h.pad)).toEqual(['snare', 'hihatClosed']);
    expect(manager.stopRecording()).toEqual([]); // nothing left over
  });

  it('returns recorded hits sorted by event time even if they arrive out of order', async () => {
    const manager = new InputManager();
    const kb = new ManualSource('keyboard', 'keyboard');
    const midi = new ManualSource('midi', 'midi');
    manager.add(kb);
    manager.add(midi);
    await manager.start();

    manager.startRecording();
    kb.hit('snare', 20);
    midi.hit('kick', 15);
    expect(manager.stopRecording().map((h) => h.time)).toEqual([15, 20]);
  });

  it('stop() stops all sources and drops late hits', async () => {
    const manager = new InputManager();
    const src = new ManualSource('s');
    manager.add(src);
    const listener = vi.fn();
    manager.onHit(listener);
    await manager.start();

    const lateEmit = src.emit!;
    manager.stop();
    lateEmit({ pad: 'kick', velocity: 90, time: 1, source: 'test' });

    expect(src.stopped).toBe(1);
    expect(listener).not.toHaveBeenCalled();
  });

  it('starts a source added while running, and the returned function removes it', async () => {
    const manager = new InputManager();
    await manager.start();
    const src = new ManualSource('late');
    const listener = vi.fn();
    manager.onHit(listener);

    const remove = manager.add(src);
    await Promise.resolve();
    src.hit('ride', 1);
    remove();
    src.hit('ride', 2);

    expect(listener).toHaveBeenCalledTimes(1);
    expect(src.stopped).toBe(1);
  });
});
