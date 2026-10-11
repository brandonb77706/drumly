import type { Lesson } from './types';

/** Practice speeds offered as a fraction of the lesson's default BPM. */
export const SPEED_OPTIONS = [0.5, 0.75, 1] as const;
export type Speed = (typeof SPEED_OPTIONS)[number];

/**
 * BPM for practicing a lesson at a fraction of its default tempo. Not rounded: 75% of 85 BPM is
 * 63.75, so every note gap is exactly 1/speed times the full-speed gap.
 */
export function lessonBpmAt(lesson: Pick<Lesson, 'defaultBpm'>, speed: number): number {
  if (!(speed > 0) || !Number.isFinite(speed)) throw new RangeError(`Speed must be a positive number, got ${speed}`);
  return lesson.defaultBpm * speed;
}
