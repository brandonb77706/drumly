/**
 * Pure metronome math. No Web Audio, no DOM, no clocks: everything here is unit-testable.
 *
 * Two clocks are involved:
 * - the AudioContext clock (seconds), used to schedule sound sample-accurately;
 * - the performance.now() clock (milliseconds), used by input hits.
 * Grid math works in seconds on whatever clock the caller passes; the conversion
 * functions at the bottom map AudioContext seconds to performance.now() milliseconds.
 */

export type Subdivision = 'quarter' | 'eighth' | 'sixteenth' | 'triplet';

export const SUBDIVISIONS: readonly Subdivision[] = ['quarter', 'eighth', 'sixteenth', 'triplet'];

export const MIN_BPM = 30;
export const MAX_BPM = 300;
export const MIN_BEATS_PER_BAR = 1;
export const MAX_BEATS_PER_BAR = 16;

export function clicksPerBeat(subdivision: Subdivision): number {
  switch (subdivision) {
    case 'quarter':
      return 1;
    case 'eighth':
      return 2;
    case 'triplet':
      return 3;
    case 'sixteenth':
      return 4;
  }
}

export function secondsPerBeat(bpm: number): number {
  return 60 / bpm;
}

/** Time between consecutive clicks for a BPM and subdivision. 120 BPM 8ths -> 0.25 s. */
export function secondsPerClick(bpm: number, subdivision: Subdivision): number {
  return 60 / bpm / clicksPerBeat(subdivision);
}

export function clampBpm(bpm: number): number {
  if (!Number.isFinite(bpm)) throw new RangeError(`BPM must be a number, got ${bpm}`);
  return Math.min(MAX_BPM, Math.max(MIN_BPM, bpm));
}

export function clampBeatsPerBar(beats: number): number {
  if (!Number.isFinite(beats)) throw new RangeError(`Beats per bar must be a number, got ${beats}`);
  return Math.min(MAX_BEATS_PER_BAR, Math.max(MIN_BEATS_PER_BAR, Math.round(beats)));
}

/** Beat 1 of a bar, on the beat itself (not a subdivision), when accents are on. */
export function isAccentClick(beat: number, subdivisionIndex: number, accentEnabled: boolean): boolean {
  return accentEnabled && beat === 0 && subdivisionIndex === 0;
}

/** The count-in bar is numbered -1; real bars start at 0. */
export function isCountInBar(bar: number): boolean {
  return bar < 0;
}

/**
 * A stretch of the click grid with constant settings. Segments always begin on a beat
 * (subdivision index 0). The scheduler starts a new segment whenever settings change.
 */
export interface GridSegment {
  /** Global click index of the segment's first click. */
  startIndex: number;
  /** Time of the first click, in seconds. */
  startTime: number;
  /** Bar and beat of the first click. Bar -1 is the count-in. */
  bar: number;
  beat: number;
  bpm: number;
  beatsPerBar: number;
  subdivision: Subdivision;
  accent: boolean;
  /** Count-in segments click quarter notes only, regardless of subdivision. */
  countIn: boolean;
}

export interface GridClick {
  /** Global click index since start(), counting count-in clicks. */
  index: number;
  /** Bar number. -1 is the count-in bar; real bars start at 0. */
  bar: number;
  /** Beat within the bar, 0-based. */
  beat: number;
  /** Subdivision index within the beat, 0-based. 0 is the beat itself. */
  subdivision: number;
  subdivisionsPerBeat: number;
  beatsPerBar: number;
  isAccent: boolean;
  isCountIn: boolean;
  /** Seconds, on the clock the segment was defined on. */
  time: number;
}

export function segmentClicksPerBeat(segment: GridSegment): number {
  return segment.countIn ? 1 : clicksPerBeat(segment.subdivision);
}

export function segmentSecondsPerClick(segment: GridSegment): number {
  return secondsPerBeat(segment.bpm) / segmentClicksPerBeat(segment);
}

/** The click with a given global index, assuming it falls inside this segment. */
export function clickAt(segment: GridSegment, index: number): GridClick {
  const n = index - segment.startIndex;
  const perBeat = segmentClicksPerBeat(segment);
  const absoluteBeat = segment.beat + Math.floor(n / perBeat);
  const subdivision = n % perBeat;
  const beat = absoluteBeat % segment.beatsPerBar;
  const bar = segment.bar + Math.floor(absoluteBeat / segment.beatsPerBar);
  return {
    index,
    bar,
    beat,
    subdivision,
    subdivisionsPerBeat: perBeat,
    beatsPerBar: segment.beatsPerBar,
    isAccent: isAccentClick(beat, subdivision, segment.accent),
    isCountIn: isCountInBar(bar),
    // Multiply, never accumulate: no floating-point drift over long sessions.
    time: segment.startTime + n * segmentSecondsPerClick(segment),
  };
}

/**
 * Clicks of one segment with time in [from, to), limited to indices [startIndex, endIndex).
 */
export function clicksInWindow(segment: GridSegment, from: number, to: number, endIndex = Infinity): GridClick[] {
  if (!(to > from)) return [];
  const interval = segmentSecondsPerClick(segment);
  // Candidate range widened by one on each side, then filtered exactly, so float rounding
  // in the division can never drop or duplicate a boundary click.
  const first = Math.max(segment.startIndex, segment.startIndex + Math.floor((from - segment.startTime) / interval) - 1);
  const last = Math.min(endIndex - 1, segment.startIndex + Math.ceil((to - segment.startTime) / interval) + 1);
  const out: GridClick[] = [];
  for (let index = first; index <= last; index++) {
    const click = clickAt(segment, index);
    if (click.time >= from && click.time < to) out.push(click);
  }
  return out;
}

/**
 * A matched pair of readings from the two clocks.
 * From AudioContext.getOutputTimestamp(), performanceTime is when the sample at contextTime
 * is actually heard, so latencyMs is 0. In the fallback (currentTime + performance.now()),
 * latencyMs holds the output latency estimate.
 */
export interface ClockReference {
  /** AudioContext time, seconds. */
  contextTime: number;
  /** performance.now() time, milliseconds. */
  performanceTime: number;
  /** Extra delay between the context time and the sound being heard, milliseconds. */
  latencyMs: number;
}

/** AudioContext seconds -> performance.now() ms at which the sound is heard, plus a manual offset. */
export function contextToPerformanceTime(contextTime: number, ref: ClockReference, offsetMs = 0): number {
  return ref.performanceTime + (contextTime - ref.contextTime) * 1000 + ref.latencyMs + offsetMs;
}

/** Inverse of contextToPerformanceTime. */
export function performanceToContextTime(performanceTime: number, ref: ClockReference, offsetMs = 0): number {
  return ref.contextTime + (performanceTime - ref.performanceTime - ref.latencyMs - offsetMs) / 1000;
}
