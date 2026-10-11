import { describe, expect, it } from 'vitest';
import { ClickScheduler } from './ClickScheduler';
import { secondsPerClick } from './timing';

const label = (c: { bar: number; beat: number; subdivision: number }) => `${c.bar}.${c.beat}.${c.subdivision}`;

describe('ClickScheduler', () => {
  it('schedules only clicks before the horizon, and never repeats one', () => {
    const s = new ClickScheduler({ bpm: 120 });
    s.start(1);
    expect(s.scheduleUntil(2.01).map((c) => c.time)).toEqual([1, 1.5, 2]);
    expect(s.scheduleUntil(2.01)).toEqual([]);
    expect(s.scheduleUntil(3.01).map((c) => c.index)).toEqual([3, 4]);
  });

  it('BPM change mid-run: next click is exactly one new interval after the last scheduled one', () => {
    const s = new ClickScheduler({ bpm: 120 });
    s.start(0);
    const before = s.scheduleUntil(1.2); // 0, 0.5, 1.0
    const last = before.at(-1)!;
    s.update({ bpm: 90 });
    const after = s.scheduleUntil(5);

    expect(after[0]!.index).toBe(last.index + 1);
    expect(after[0]!.time).toBe(last.time + secondsPerClick(90, 'quarter'));
    expect(after[1]!.time - after[0]!.time).toBeCloseTo(secondsPerClick(90, 'quarter'), 12);

    const all = [...before, ...after];
    expect(new Set(all.map((c) => c.index)).size).toBe(all.length);
    expect(new Set(all.map((c) => c.time)).size).toBe(all.length);
    for (let i = 1; i < all.length; i++) expect(all[i]!.time).toBeGreaterThan(all[i - 1]!.time);
  });

  it('with subdivisions, a BPM change applies from the next beat', () => {
    const s = new ClickScheduler({ bpm: 120, subdivision: 'sixteenth' }); // 0.125 s
    s.start(0);
    const before = s.scheduleUntil(0.13); // 0.0.0 and 0.0.1
    s.update({ bpm: 60 }); // 16ths become 0.25 s
    const after = s.scheduleUntil(1.5);

    expect(before.map(label)).toEqual(['0.0.0', '0.0.1']);
    // Rest of beat 1 keeps the old spacing, the gap into beat 2 uses the new tempo.
    expect(after.slice(0, 3).map((c) => c.time)).toEqual([0.25, 0.375, 0.625]);
    expect(label(after[2]!)).toBe('0.1.0');
    expect(after[3]!.time - after[2]!.time).toBe(0.25);
  });

  it('subdivision change applies from the next beat', () => {
    const s = new ClickScheduler({ bpm: 120, subdivision: 'eighth' });
    s.start(0);
    s.scheduleUntil(0.1); // 0.0.0
    s.update({ subdivision: 'triplet' });
    const after = s.scheduleUntil(1.01);
    expect(after.map(label)).toEqual(['0.0.1', '0.1.0', '0.1.1', '0.1.2', '0.2.0']);
    expect(after[1]!.time).toBe(0.5);
    expect(after[4]!.time).toBeCloseTo(1, 12);
  });

  it('beats-per-bar change waits for the next bar', () => {
    const s = new ClickScheduler({ bpm: 120, beatsPerBar: 4 });
    s.start(0);
    s.scheduleUntil(0.6); // beats 0, 1
    s.update({ beatsPerBar: 3 });
    const labels = s.scheduleUntil(5).map(label);
    expect(labels).toEqual(['0.2.0', '0.3.0', '1.0.0', '1.1.0', '1.2.0', '2.0.0', '2.1.0', '2.2.0']);
  });

  it('count-in: one bar of quarter notes in bar -1, then the real subdivision from bar 0', () => {
    const s = new ClickScheduler({ bpm: 120, beatsPerBar: 4, subdivision: 'eighth', countIn: true });
    s.start(0);
    const clicks = s.scheduleUntil(4.01);
    expect(clicks.map((c) => `${label(c)}${c.isCountIn ? 'c' : ''}${c.isAccent ? '!' : ''}`)).toEqual([
      '-1.0.0c!', '-1.1.0c', '-1.2.0c', '-1.3.0c',
      '0.0.0!', '0.0.1', '0.1.0', '0.1.1', '0.2.0', '0.2.1', '0.3.0', '0.3.1', '1.0.0!',
    ]);
    expect(clicks[4]!.time).toBe(2); // downbeat exactly one bar after the first count-in click
    expect(clicks[5]!.time).toBe(2.25);
  });

  it('accent toggle applies per beat and flags only beat 1 of each bar', () => {
    const s = new ClickScheduler({ bpm: 120, beatsPerBar: 2, accent: false });
    s.start(0);
    const first = s.scheduleUntil(1.01); // 0.0, 0.1, 1.0 - no accents
    s.update({ accent: true });
    const second = s.scheduleUntil(3.01); // 1.1, 2.0!, 2.1, 3.0!
    expect(first.some((c) => c.isAccent)).toBe(false);
    expect(second.map((c) => c.isAccent)).toEqual([false, true, false, true]);
  });

  it('peek previews upcoming clicks, including pending changes, without consuming them', () => {
    const s = new ClickScheduler({ bpm: 120 });
    s.start(0);
    s.scheduleUntil(0.6);
    s.update({ bpm: 60 });
    const preview = s.peek(3.01);
    expect(preview.map((c) => c.time)).toEqual([1.5, 2.5]);
    expect(s.scheduleUntil(3.01)).toEqual(preview);
  });
});

describe('ClickScheduler.updateAtBar', () => {
  /** 16th grid, 4/4, with a count-in, starting at t = 0. */
  function sixteenths(bpm = 60) {
    const s = new ClickScheduler({ bpm, beatsPerBar: 4, subdivision: 'sixteenth', countIn: true });
    s.start(0);
    return s;
  }

  it('changes the tempo exactly at the downbeat of the given bar, scheduled well in advance', () => {
    const s = sixteenths(60);
    const early = s.scheduleUntil(4.5); // count-in (4 s) and the start of bar 0
    expect(s.updateAtBar(3, { bpm: 120 })).toBe(true);
    const clicks = [...early, ...s.scheduleUntil(30)];
    const bar3 = clicks.findIndex((c) => c.bar === 3 && c.beat === 0 && c.subdivision === 0);
    // Count-in 4 s + 3 bars at 60 BPM (4 s each) = 16 s.
    expect(clicks[bar3]!.time).toBeCloseTo(16, 12);
    // Everything before bar 3 at 60 BPM, everything after at 120.
    expect(clicks[bar3]!.time - clicks[bar3 - 1]!.time).toBeCloseTo(0.25, 12);
    expect(clicks[bar3 + 1]!.time - clicks[bar3]!.time).toBeCloseTo(0.125, 12);
    // No double click, no gap: indices consecutive, times strictly increasing.
    clicks.forEach((c, i) => {
      if (i === 0) return;
      expect(c.index).toBe(clicks[i - 1]!.index + 1);
      expect(c.time).toBeGreaterThan(clicks[i - 1]!.time);
    });
    expect(s.getSettings().bpm).toBe(120);
  });

  it('works when requested just before that downbeat is handed out', () => {
    const s = sixteenths(60);
    const before = s.scheduleUntil(8 - 1e-9); // up to the last 16th of bar 0 (bar 1 starts at 8 s)
    expect(before.at(-1)).toMatchObject({ bar: 0, beat: 3, subdivision: 3 });
    expect(s.nextUnscheduledBar()).toBe(1);
    expect(s.updateAtBar(1, { bpm: 90 })).toBe(true);
    const after = s.scheduleUntil(12);
    expect(after[0]).toMatchObject({ bar: 1, beat: 0, subdivision: 0 });
    expect(after[0]!.time).toBeCloseTo(8, 12); // gap into the downbeat stays at the old 16th
    expect(after[1]!.time - after[0]!.time).toBeCloseTo(60 / 90 / 4, 12);
  });

  it('refuses a bar whose downbeat was already handed out', () => {
    const s = sixteenths(60);
    s.scheduleUntil(8.01); // bar 1 downbeat at 8 s is out
    expect(s.nextUnscheduledBar()).toBe(2);
    expect(s.updateAtBar(1, { bpm: 90 })).toBe(false);
    expect(s.scheduleUntil(12).every((c) => Math.abs(c.time - Math.round(c.time * 4) / 4) < 1e-9)).toBe(true);
    expect(s.getSettings().bpm).toBe(60);
  });

  it('peek includes the pending change, so projected clicks match what will be scheduled', () => {
    const s = sixteenths(60);
    s.scheduleUntil(5);
    s.updateAtBar(2, { bpm: 75 });
    const projected = s.peek(25).map((c) => [c.index, c.time]);
    const actual = s.scheduleUntil(25).map((c) => [c.index, c.time]);
    expect(projected).toEqual(actual);
    expect(new ClickScheduler().updateAtBar(0, { bpm: 90 })).toBe(false); // not running
  });
});
