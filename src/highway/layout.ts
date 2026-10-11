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
