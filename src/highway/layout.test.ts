import { describe, expect, it } from 'vitest';
import { ANY_HIHAT } from '../grading';
import { FILL_LESSONS, STARTER_LESSONS } from '../lessons';
import { FIT_MARGIN, KIT_ORDER, MIN_PX_PER_BEAT, computeLayout, fitLayout, laneCenterY, laneForPad, lanesForLesson, lanesForPads, noteToX, scrollFitLayout, visibleTimeRange } from './layout';
import { PADS } from '../input';

describe('noteToX', () => {
  const layout = { nowX: 250, pxPerMs: 0.375 };
  const now = 123_456.789;

  it('a note at the now time sits on the now line', () => {
    expect(noteToX(now, now, layout)).toBe(250);
  });

  it('future notes are to the right by exactly speed x time', () => {
    expect(noteToX(now + 1000, now, layout)).toBeCloseTo(250 + 375, 9);
    expect(noteToX(now + 40, now, layout)).toBeCloseTo(250 + 15, 9);
  });

  it('past notes are to the left', () => {
    expect(noteToX(now - 400, now, layout)).toBeCloseTo(250 - 150, 9);
  });

  it('depends only on the time difference, not on when it is asked', () => {
    expect(noteToX(5500, 5000, layout)).toBeCloseTo(noteToX(1_000_500, 1_000_000, layout), 9);
  });
});

describe('computeLayout', () => {
  it('puts the now line 35% across the lane area and fits 1.5 s of upcoming notes to its right', () => {
    const layout = computeLayout(1096, 300, 4, { labelWidth: 96 });
    expect(layout.nowX).toBeCloseTo(96 + 350, 9);
    expect(noteToX(1500, 0, layout)).toBeCloseTo(1096, 9);
    expect(layout.pxPerMs).toBeCloseTo(650 / 1500, 9);
    const range = visibleTimeRange(0, layout);
    expect(range.to).toBeCloseTo(1500, 9);
    // 35% of the lane area behind the line: 350 px at 650/1500 px per ms ≈ 808 ms of look-back.
    expect(range.from).toBeCloseTo(-350 / (650 / 1500), 6);
  });

  it('now line position and look-ahead are configurable', () => {
    const layout = computeLayout(1100, 300, 4, { labelWidth: 100, nowFraction: 0.5, futureMs: 1000 });
    expect(layout.nowX).toBe(600);
    expect(noteToX(1000, 0, layout)).toBeCloseTo(1100, 9);
  });

  it('never puts the now line inside the label gutter on a narrow screen', () => {
    const layout = computeLayout(300, 200, 3, { labelWidth: 96 });
    expect(layout.nowX).toBeGreaterThan(96);
  });

  it('lanes fill the height; the "other" lane is hidden by default', () => {
    const layout = computeLayout(800, 14 + 4 * 34, 4, { headerHeight: 14 });
    expect(layout.laneHeight).toBeCloseTo(34, 9);
    expect(laneCenterY(0, layout)).toBeCloseTo(14 + 17, 9);
    expect(layout.otherHeight).toBe(0);
  });

  it('the "other" lane, when shown, is as tall as the rest and fits inside the canvas', () => {
    const layout = computeLayout(800, 14 + 5 * 34, 4, { headerHeight: 14, otherLane: true });
    expect(layout.laneHeight).toBeCloseTo(34, 9);
    expect(layout.otherHeight).toBeCloseTo(34, 9);
    expect(layout.otherTop).toBeCloseTo(14 + 4 * 34, 9);
    expect(layout.otherTop + layout.otherHeight).toBeCloseTo(layout.height, 9);
    expect(laneCenterY(-1, layout)).toBeCloseTo(14 + 4.5 * 34, 9);
  });
});

describe('lanes', () => {
  it('kit order covers every pad exactly once', () => {
    expect([...KIT_ORDER].sort()).toEqual([...PADS].sort());
  });

  it('follow the kit: crash, hi-hat, ride, tom1, tom2, snare, tom3, kick, hi-hat pedal', () => {
    expect(lanesForPads(['hihatPedal', 'kick', 'tom3', 'snare', 'tom2', 'tom1', 'ride', 'hihatClosed', 'crash'])).toEqual([
      'crash',
      'hihatClosed',
      'ride',
      'tom1',
      'tom2',
      'snare',
      'tom3',
      'kick',
      'hihatPedal',
    ]);
  });

  it('only include pads the lesson uses', () => {
    expect(lanesForLesson(STARTER_LESSONS[1]!)).toEqual(['hihatClosed', 'snare', 'kick']);
    expect(lanesForLesson(FILL_LESSONS.find((l) => l.id === 'fill-around-toms')!)).toEqual([
      'crash',
      'hihatClosed',
      'tom1',
      'tom2',
      'snare',
      'tom3',
      'kick',
    ]);
  });

  it('laneForPad finds the lane, falls back to an equivalent pad, else -1', () => {
    const lanes = ['hihatClosed', 'snare', 'kick'] as const;
    expect(laneForPad('snare', lanes)).toBe(1);
    expect(laneForPad('kick', lanes)).toBe(2);
    expect(laneForPad('hihatOpen', lanes)).toBe(-1);
    expect(laneForPad('hihatOpen', lanes, [ANY_HIHAT])).toBe(0);
    expect(laneForPad('tom1', lanes, [ANY_HIHAT])).toBe(-1);
  });
});

describe('scrollFitLayout', () => {
  const base = computeLayout(696, 200, 4); // 600 px of note area right of the 96 px labels
  const area = 600 - 2 * FIT_MARGIN;

  it('fits like fitLayout when the span is readable at full width', () => {
    // 4 beats at 120 BPM = 2000 ms; 576 px / 4 beats = 144 px per beat.
    const r = scrollFitLayout(base, 0, 2000, MIN_PX_PER_BEAT / 500);
    expect(r.scrolls).toBe(false);
    expect(r.layout).toEqual(fitLayout(base, 0, 2000));
    expect(r.contentWidth).toBe(696);
  });

  it('a dense span scrolls at the minimum zoom, with the content width it needs', () => {
    // 64 bars of 4/4 at 120 BPM: 256 beats, 128 s. Fitted it would be 2.25 px per beat.
    const minPxPerMs = MIN_PX_PER_BEAT / 500;
    const r = scrollFitLayout(base, 0, 128_000, minPxPerMs);
    expect(r.scrolls).toBe(true);
    expect(r.layout.pxPerMs).toBe(minPxPerMs);
    expect(r.contentWidth).toBeCloseTo(96 + 2 * FIT_MARGIN + 256 * 40);
    expect(noteToX(0, 0, r.layout)).toBe(96 + FIT_MARGIN);
    expect(area / 256).toBeLessThan(MIN_PX_PER_BEAT);
  });

  it('scrolling moves the picture left and is clamped to the content', () => {
    const minPxPerMs = MIN_PX_PER_BEAT / 500;
    const r = scrollFitLayout(base, 0, 128_000, minPxPerMs, 1000);
    expect(r.scrollX).toBe(1000);
    expect(noteToX(0, 0, r.layout)).toBe(96 + FIT_MARGIN - 1000);
    const end = scrollFitLayout(base, 0, 128_000, minPxPerMs, 1e9);
    expect(end.scrollX).toBeCloseTo(end.contentWidth - 696);
    // At the far end the last moment sits just inside the right margin.
    expect(noteToX(128_000, 0, end.layout)).toBeCloseTo(696 - FIT_MARGIN);
    expect(scrollFitLayout(base, 0, 128_000, minPxPerMs, -50).scrollX).toBe(0);
  });
});
