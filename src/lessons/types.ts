import type { Pad } from '../input';
import type { Subdivision } from '../metronome/timing';

/** One note of a lesson, in musical position. All indices are 0-based, matching the metronome's numbering. */
export interface LessonNote {
  readonly pad: Pad;
  /** Bar within the lesson (0 = first bar after the count-in). */
  readonly bar: number;
  /** Beat within the bar. */
  readonly beat: number;
  /** Subdivision step within the beat (0 = on the beat). */
  readonly subdivision: number;
  /** Written as an accent ("X" in the text format). */
  readonly accent?: boolean;
}

export type LessonCategory = 'beat' | 'fill';

/** A lesson in musical terms, so it plays at any tempo. */
export interface Lesson {
  readonly id: string;
  readonly title: string;
  readonly category: LessonCategory;
  readonly description: string;
  readonly defaultBpm: number;
  readonly beatsPerBar: number;
  readonly bars: number;
  /** The metronome grid the lesson is written on. */
  readonly subdivision: Subdivision;
  readonly notes: readonly LessonNote[];
  /** Pads that count as the same for this lesson, e.g. [ANY_HIHAT] for beginner beats. */
  readonly equivalentPads?: readonly (readonly Pad[])[];
  /** The text the lesson was written in, if any (shown to the player). */
  readonly source?: string;
}

/**
 * A metronome click time. MetronomeClick satisfies this; lessons don't depend on the metronome class.
 * `time` is ms on the performance.now() clock.
 */
export interface ClickTime {
  readonly bar: number;
  readonly beat: number;
  readonly subdivision: number;
  readonly time: number;
  readonly isCountIn?: boolean;
  readonly subdivisionsPerBeat?: number;
  readonly beatsPerBar?: number;
}
