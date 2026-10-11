import { describe, expect, it } from 'vitest';
import { formatMeanOffset, formatOffset, formatPctShort, formatSpread, formatTimingPhrase, passChipClass, formatDuration } from './format';
import { passVerdict } from '../trainer/ladder';

describe('formatOffset', () => {
  it('whole ms with a sign', () => {
    expect(formatOffset(12)).toBe('+12 ms');
    expect(formatOffset(-8)).toBe('-8 ms');
    expect(formatOffset(11.6)).toBe('+12 ms');
    expect(formatOffset(-7.6)).toBe('-8 ms');
  });

  it('zero is "0 ms", never "-0"', () => {
    expect(formatOffset(0)).toBe('0 ms');
    expect(formatOffset(-0)).toBe('0 ms');
    expect(formatOffset(-0.04)).toBe('0 ms');
    expect(formatOffset(-0.4)).toBe('0 ms');
    expect(formatOffset(0.49)).toBe('0 ms');
  });
});

describe('formatTimingPhrase', () => {
  it('says "on time" within the perfect threshold', () => {
    expect(formatTimingPhrase(0)).toBe('on time');
    expect(formatTimingPhrase(-0.0001)).toBe('on time');
    expect(formatTimingPhrase(20)).toBe('on time');
    expect(formatTimingPhrase(-20)).toBe('on time');
  });

  it('says how late or early beyond it', () => {
    expect(formatTimingPhrase(21)).toBe('21 ms late');
    expect(formatTimingPhrase(-34.6)).toBe('35 ms early');
    expect(formatTimingPhrase(12, 5)).toBe('12 ms late');
  });
});

describe('stat formats', () => {
  it('means use formatOffset, spreads are whole ms', () => {
    expect(formatMeanOffset(null)).toBe('—');
    expect(formatMeanOffset(-0.04)).toBe('0 ms');
    expect(formatMeanOffset(17.3)).toBe('+17 ms');
    expect(formatSpread(null)).toBe('—');
    expect(formatSpread(0)).toBe('0 ms');
    expect(formatSpread(12.6)).toBe('13 ms');
  });

  it('short percentages drop a trailing .0', () => {
    expect(formatPctShort(null)).toBe('—');
    expect(formatPctShort(100)).toBe('100%');
    expect(formatPctShort(92.857)).toBe('92.9%');
    expect(formatPctShort(89.96)).toBe('90%');
  });
});

describe('passChipClass', () => {
  it('follows the ladder verdict, not which pass was best', () => {
    const t = { passThreshold: 90 };
    // The screenshot: passes 3 and 4 at 90% were clean, so they're green like the 100% ones.
    expect([100, 100, 90, 90].map((a, i) => passChipClass(passVerdict(a, t), i === 0))).toEqual([
      'pass-chip clean best',
      'pass-chip clean',
      'pass-chip clean',
      'pass-chip clean',
    ]);
    expect(passChipClass(passVerdict(80, t), false)).toBe('pass-chip almost');
    expect(passChipClass(passVerdict(50, t), true)).toBe('pass-chip rough best');
  });
});

describe('formatDuration', () => {
  it('seconds under a minute, then minutes, then hours', () => {
    expect(formatDuration(0)).toBe('0 min');
    expect(formatDuration(400)).toBe('1 s');
    expect(formatDuration(45_000)).toBe('45 s');
    expect(formatDuration(12 * 60_000 + 59_000)).toBe('12 min');
    expect(formatDuration(65 * 60_000)).toBe('1 h 05 min');
  });
});
