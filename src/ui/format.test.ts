import { describe, expect, it } from 'vitest';
import { formatMeanOffset, formatOffset, formatPctShort, formatSpread, formatTimingPhrase } from './format';

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
