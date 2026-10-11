import { clicksPerBeat } from '../metronome/timing';
import type { Lesson } from '../lessons';
import { HighwayModel, type HighwayClick, type HighwayModelOptions } from './model';

/** A whole lesson laid out on its own time axis, for drawing standing still (see HighwayRenderer.fit). */
export interface HighwayOverview {
  readonly model: HighwayModel;
  /** Time of bar 0, beat 1 and of the end of the last bar, ms on the overview's own axis (bar 0 is at 0). */
  readonly from: number;
  readonly to: number;
}

/**
 * Every note of a lesson at `bpm`, with bar and beat lines and a closing bar line, on a time axis
 * starting at 0. Nothing is pruned, so the renderer can show all of it at once.
 */
export function lessonOverview(lesson: Lesson, bpm: number, options: Pick<HighwayModelOptions, 'lanes' | 'focusLabel'> = {}): HighwayOverview {
  const perBeat = clicksPerBeat(lesson.subdivision);
  const stepMs = 60_000 / bpm / perBeat;
  const steps = lesson.bars * lesson.beatsPerBar * perBeat;
  const clicks: HighwayClick[] = [];
  // One step past the end: the closing bar line (its bar is past the lesson, so it holds no notes).
  for (let n = 0; n <= steps; n++) {
    const beatIndex = Math.floor(n / perBeat);
    clicks.push({
      index: n,
      bar: Math.floor(beatIndex / lesson.beatsPerBar),
      beat: beatIndex % lesson.beatsPerBar,
      subdivision: n % perBeat,
      subdivisionsPerBeat: perBeat,
      beatsPerBar: lesson.beatsPerBar,
      isCountIn: false,
      time: n * stepMs,
    });
  }
  const to = steps * stepMs;
  const model = new HighwayModel(lesson, { ...options, pastMs: to + 1000, futureMs: to + 1000 });
  model.refresh(0, () => clicks, true);
  return { model, from: 0, to };
}
