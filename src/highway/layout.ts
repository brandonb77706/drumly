import type { Pad } from '../input';

/**
 * Lane order, top to bottom, laid out like a kit seen from the throne: cymbals up top, then
 * toms and snare, feet at the bottom. Zones of one drum (hi-hat open/closed, snare head/rim)
 * sit next to each other.
 */
export const KIT_ORDER: readonly Pad[] = [
  'crash',
  'crash2',
  'hihatOpen',
  'hihatClosed',
  'ride',
  'rideBell',
  'tom1',
  'tom2',
  'snare',
  'snareRim',
  'crossStick',
  'tom3',
  'kick',
  'hihatPedal',
];

/** One lane per pad the notes use, in kit order. */
export function lanesForPads(pads: Iterable<Pad>): Pad[] {
  const used = new Set(pads);
  return KIT_ORDER.filter((p) => used.has(p));
}

/** Lanes for a lesson: only the pads its notes use. */
export function lanesForLesson(lesson: { readonly notes: readonly { readonly pad: Pad }[] }): Pad[] {
  return lanesForPads(lesson.notes.map((n) => n.pad));
}

/**
 * Lane index for a pad, or -1 if it has none. A pad without its own lane falls back to the lane
 * of a pad it counts as (e.g. open hi-hat drawn in the closed hi-hat lane when any hi-hat counts).
 */
export function laneForPad(pad: Pad, lanes: readonly Pad[], equivalentPads: readonly (readonly Pad[])[] = []): number {
  const own = lanes.indexOf(pad);
  if (own !== -1) return own;
  for (const group of equivalentPads) {
    if (!group.includes(pad)) continue;
    for (const other of group) {
      const lane = lanes.indexOf(other);
      if (lane !== -1) return lane;
    }
  }
  return -1;
}

export interface HighwayLayout {
  /** CSS pixels. */
  readonly width: number;
  readonly height: number;
  /** Left gutter holding the pad labels. Notes are clipped to the right of it. */
  readonly labelWidth: number;
  /** x of the "now" line. */
  readonly nowX: number;
  /** Scroll speed. Fixed for a layout, so faster tempos look denser, not faster. */
  readonly pxPerMs: number;
  readonly laneCount: number;
  readonly laneHeight: number;
  /** Top of the lane area (room above for count-in markers). */
  readonly lanesTop: number;
  /** Lane under the others for hits on pads that have no lane (height 0 when hidden). */
  readonly otherTop: number;
  readonly otherHeight: number;
}

export interface LayoutOptions {
  /** How much upcoming time fits right of the now line, ms. Default 1500. */
  futureMs?: number;
  /**
   * Where the now line sits, as a fraction of the lane area (right of the labels). Default 0.35,
   * which leaves room to glance back at what was just played.
   */
  nowFraction?: number;
  labelWidth?: number;
  headerHeight?: number;
  /** Show the "other" lane. Default false. */
  otherLane?: boolean;
}

export const DEFAULT_FUTURE_MS = 1500;
export const DEFAULT_NOW_FRACTION = 0.35;

export function computeLayout(width: number, height: number, laneCount: number, options: LayoutOptions = {}): HighwayLayout {
  const futureMs = options.futureMs ?? DEFAULT_FUTURE_MS;
  const labelWidth = options.labelWidth ?? 96;
  const headerHeight = options.headerHeight ?? 14;
  const laneWidth = Math.max(0, width - labelWidth);
  const nowX = labelWidth + laneWidth * (options.nowFraction ?? DEFAULT_NOW_FRACTION);
  const lanes = Math.max(1, laneCount);
  const other = options.otherLane ? 1 : 0;
  const laneHeight = Math.max(1, (height - headerHeight) / (lanes + other));
  const otherTop = headerHeight + lanes * laneHeight;
  return {
    width,
    height,
    labelWidth,
    nowX,
    pxPerMs: Math.max(0, width - nowX) / futureMs,
    laneCount,
    laneHeight,
    lanesTop: headerHeight,
    otherTop,
    otherHeight: other ? laneHeight : 0,
  };
}

/** x of something at `time`, given the current time. Notes at `now` sit on the now line. */
export function noteToX(noteTime: number, now: number, layout: Pick<HighwayLayout, 'nowX' | 'pxPerMs'>): number {
  return layout.nowX + (noteTime - now) * layout.pxPerMs;
}

/** Vertical center of a lane. Lane -1 is the "other" lane. */
export function laneCenterY(lane: number, layout: HighwayLayout): number {
  if (lane < 0) return layout.otherTop + layout.otherHeight / 2;
  return layout.lanesTop + (lane + 0.5) * layout.laneHeight;
}

/** Times at the left edge of the note area and the right edge of the canvas. */
export function visibleTimeRange(now: number, layout: HighwayLayout): { from: number; to: number } {
  if (layout.pxPerMs <= 0) return { from: now, to: now };
  return {
    from: now - (layout.nowX - layout.labelWidth) / layout.pxPerMs,
    to: now + (layout.width - layout.nowX) / layout.pxPerMs,
  };
}

/** Space left and right of a fitted picture, CSS px. */
export const FIT_MARGIN = 12;

/**
 * A layout showing the time span [from, to] across the whole note area, standing still: draw it
 * with now = from. The now line sits at the left margin (the renderer hides it in this mode).
 */
export function fitLayout(layout: HighwayLayout, from: number, to: number): HighwayLayout {
  const span = Math.max(1, to - from);
  const nowX = layout.labelWidth + FIT_MARGIN;
  return { ...layout, nowX, pxPerMs: Math.max(0, layout.width - nowX - FIT_MARGIN) / span };
}

/** Below this many CSS px per beat a fitted picture is too dense to read, so it scrolls instead. */
export const MIN_PX_PER_BEAT = 40;

export interface ScrollFit {
  readonly layout: HighwayLayout;
  /** CSS px the whole span needs (labels and margins included); the canvas width when it fits. */
  readonly contentWidth: number;
  /** True when the span doesn't fit at `minPxPerMs` and the picture scrolls sideways. */
  readonly scrolls: boolean;
  /** The scroll position actually used (clamped to the content). */
  readonly scrollX: number;
}

/**
 * Like fitLayout, but never denser than `minPxPerMs`: a span that would need less is drawn at
 * that zoom instead, scrolled `scrollX` CSS px to the right (clamped to the content). Draw it
 * with now = from, as with fitLayout.
 */
export function scrollFitLayout(layout: HighwayLayout, from: number, to: number, minPxPerMs: number, scrollX = 0): ScrollFit {
  const fitted = fitLayout(layout, from, to);
  if (!(minPxPerMs > 0) || fitted.pxPerMs >= minPxPerMs) return { layout: fitted, contentWidth: layout.width, scrolls: false, scrollX: 0 };
  const span = Math.max(1, to - from);
  const contentWidth = layout.labelWidth + 2 * FIT_MARGIN + span * minPxPerMs;
  const x = Math.min(Math.max(0, contentWidth - layout.width), Math.max(0, Number.isFinite(scrollX) ? scrollX : 0));
  return { layout: { ...layout, nowX: layout.labelWidth + FIT_MARGIN - x, pxPerMs: minPxPerMs }, contentWidth, scrolls: true, scrollX: x };
}
