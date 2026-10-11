/**
 * Every pad the app understands. The array is the single source of truth;
 * the Pad type is derived from it so UI code can iterate over all pads.
 */
export const PADS = [
  'kick',
  'snare',
  'snareRim',
  'crossStick',
  'hihatClosed',
  'hihatOpen',
  'hihatPedal',
  'tom1',
  'tom2',
  'tom3',
  'crash',
  'crash2',
  'ride',
  'rideBell',
] as const;

export type Pad = (typeof PADS)[number];

export type HitSourceKind = 'keyboard' | 'midi' | 'test';

/** MIDI velocity scale. Valid hits are 1..127 (0 means note-off in MIDI). */
export type Velocity = number;

export const MIN_VELOCITY = 1;
export const MAX_VELOCITY = 127;

export interface Hit {
  readonly pad: Pad;
  /** 1..127, same scale as MIDI. */
  readonly velocity: Velocity;
  /**
   * Milliseconds on the performance.now() clock (relative to performance.timeOrigin).
   * Always taken from the originating event's timeStamp, never from when a handler ran.
   */
  readonly time: number;
  readonly source: HitSourceKind;
}

export type EmitFn = (hit: Hit) => void;
export type HitListener = (hit: Hit) => void;

export interface InputSource {
  /** Human-readable name used in start() failure reports and status displays. */
  readonly name: string;
  /**
   * Begin producing hits. May be async (e.g. waiting for MIDI permission).
   * Throwing or rejecting means the source is unavailable.
   */
  start(emit: EmitFn): void | Promise<void>;
  /** Stop producing hits and release resources. Must be safe to call more than once. */
  stop(): void;
}

export function clampVelocity(v: number): Velocity {
  if (!Number.isFinite(v)) return MIN_VELOCITY;
  return Math.min(MAX_VELOCITY, Math.max(MIN_VELOCITY, Math.round(v)));
}
