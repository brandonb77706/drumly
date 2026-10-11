import type { Pad } from '../input/types';
import { lessonToExpectedNotes, notePass, type ClickTime, type Lesson } from '../lessons';
import type { PlayOptions } from './DrumKit';

/** Velocity for lesson notes without an accent ("x"); accents ("X") play at 127. */
export const LESSON_NOTE_VELOCITY = 96;

/** A click as booked by the metronome: when it's heard (performance.now() ms) and when it starts on the AudioContext clock. */
export interface SoundClick extends ClickTime {
  readonly audioTime: number;
}

export type PlayFn = (pad: Pad, velocity: number, when: number, options?: PlayOptions) => void;

export interface LessonSoundOptions {
  /** 1 (default) or Infinity for a loop. */
  passes?: number;
  /**
   * Gain for each pass: 1 full, e.g. 0.35 for a quiet guide, 0 silent. Read as each click is
   * booked (up to 100 ms ahead), so a change (the guide toggle) applies within that lookahead.
   */
  gainForPass?: (pass: number) => number;
  pan?: number;
}

/**
 * Plays a lesson's notes as drums, locked to the metronome. Feed it every click the metronome
 * books (metronome.onClick): each note is booked at its click's own audioTime, the exact moment
 * that click sounds. So drums use the metronome's lookahead scheduling and clock, never a timer,
 * and land where grading expects the note (click.time is the same click on the performance clock).
 */
export class LessonSounds {
  private readonly passes: number;
  private readonly gainForPass: (pass: number) => number;
  private readonly pan: number;

  constructor(
    private readonly lesson: Lesson,
    private readonly play: PlayFn,
    options: LessonSoundOptions = {},
  ) {
    this.passes = options.passes ?? 1;
    this.gainForPass = options.gainForPass ?? (() => 1);
    this.pan = options.pan ?? 0;
  }

  /** Book the drums for one click. Returns how many notes were booked. */
  onClick(click: SoundClick): number {
    if (click.isCountIn) return 0;
    let booked = 0;
    for (const note of lessonToExpectedNotes(this.lesson, [click], { passes: this.passes })) {
      const gain = this.gainForPass(notePass(note.id) ?? 0);
      if (!(gain > 0)) continue;
      this.play(note.pad, note.velocity ?? LESSON_NOTE_VELOCITY, click.audioTime, { gain, ...(this.pan ? { pan: this.pan } : {}) });
      booked++;
    }
    return booked;
  }
}
