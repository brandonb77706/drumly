import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TestSource } from './TestSource';
import type { Hit } from './types';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('TestSource', () => {
  it('stamps hits with start time + scripted offset, regardless of when timers fire', () => {
    let clock = 1000;
    const done = vi.fn();
    const src = new TestSource(
      [
        { pad: 'kick', at: 0, velocity: 110 },
        { pad: 'hihatClosed', at: 0 },
        { pad: 'snare', at: 600, velocity: 100 },
      ],
      { now: () => clock, onDone: done },
    );
    const hits: Hit[] = [];
    src.start((h) => hits.push(h));

    clock = 9999; // the clock moving on must not affect stamped times
    vi.advanceTimersByTime(650); // timers fire "late"

    expect(hits).toEqual([
      { pad: 'kick', velocity: 110, time: 1000, source: 'test' },
      { pad: 'hihatClosed', velocity: 100, time: 1000, source: 'test' },
      { pad: 'snare', velocity: 100, time: 1600, source: 'test' },
    ]);
    expect(done).toHaveBeenCalledTimes(1);
  });

  it('stop() cancels pending hits', () => {
    const src = new TestSource([{ pad: 'kick', at: 100 }], { now: () => 0 });
    const emit = vi.fn();
    src.start(emit);
    src.stop();
    vi.advanceTimersByTime(200);
    expect(emit).not.toHaveBeenCalled();
  });
});
