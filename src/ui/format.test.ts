import { describe, expect, it } from 'vitest';
import { formatMsStat, formatOffset, formatTimingPhrase } from './format';

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

describe('formatMsStat', () => {
  it('keeps one decimal with a sign and never shows -0.0', () => {
    expect(formatMsStat(null)).toBe('—');
    expect(formatMsStat(-0.0000001)).toBe('0.0');
    expect(formatMsStat(-0.04)).toBe('0.0');
    expect(formatMsStat(3.25)).toBe('+3.3');
    expect(formatMsStat(-12.34)).toBe('-12.3');
  });
});
