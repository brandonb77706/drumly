import { KIT_ORDER } from '../highway/layout';
import type { Hit, Pad } from '../input';
import { PAD_ALIASES, type LessonNote } from '../lessons';
import { clicksPerBeat } from '../metronome/timing';

/** Grids a fill can be recorded on. */
export type RecordSubdivision = 'sixteenth' | 'triplet';

export interface RecordGrid {
  /** performance.now() ms of bar 0, beat 1. */
  readonly startTime: number;
  readonly bpm: number;
  readonly bars: number;
  readonly beatsPerBar: number;
  readonly subdivision: RecordSubdivision;
}

/** Hits at or above this velocity are written as accents ("X"). Shift on the keyboard gives 127. */
export const RECORD_ACCENT_VELOCITY = 110;

export function gridStepMs(grid: Pick<RecordGrid, 'bpm' | 'subdivision'>): number {
  return 60_000 / grid.bpm / clicksPerBeat(grid.subdivision);
}

export function gridSteps(grid: Pick<RecordGrid, 'bars' | 'beatsPerBar' | 'subdivision'>): number {
  return grid.bars * grid.beatsPerBar * clicksPerBeat(grid.subdivision);
}

/**
 * Snap each hit to the nearest grid step. A hit exactly halfway between two steps goes to the
 * later one, so the result never depends on hit order. Hits closer to a step outside the
 * recorded bars are dropped. Several hits on the same pad and step become one note, an accent
 * if any of them was hard. Notes come out in step order, pads in kit order within a step (the
 * order the text format reads them back in).
 */
export function quantizeHits(hits: readonly Pick<Hit, 'pad' | 'velocity' | 'time'>[], grid: RecordGrid): LessonNote[] {
  const stepMs = gridStepMs(grid);
  const total = gridSteps(grid);
  const perBeat = clicksPerBeat(grid.subdivision);
  const loudest = new Map<string, { pad: Pad; step: number; velocity: number }>();
  for (const hit of hits) {
    // Step times are start + n * stepMs; the epsilon keeps an exact half (in float) going up.
    const step = Math.floor((hit.time - grid.startTime) / stepMs + 0.5 + 1e-9);
    if (step < 0 || step >= total) continue;
    const key = `${hit.pad}@${step}`;
    const seen = loudest.get(key);
    if (!seen || hit.velocity > seen.velocity) loudest.set(key, { pad: hit.pad, step, velocity: hit.velocity });
  }
  return [...loudest.values()]
    .sort((a, b) => a.step - b.step || padOrder(a.pad) - padOrder(b.pad))
    .map(({ pad, step, velocity }) => ({
      pad,
      bar: Math.floor(step / (grid.beatsPerBar * perBeat)),
      beat: Math.floor(step / perBeat) % grid.beatsPerBar,
      subdivision: step % perBeat,
      ...(velocity >= RECORD_ACCENT_VELOCITY ? { accent: true } : {}),
    }));
}

/**
 * Notes in the lesson text format, one line per pad in kit order (cymbals at the top, kick at
 * the bottom), bars separated by " | ". parseLessonText reads it back to the same notes.
 */
export function notesToText(notes: readonly LessonNote[], grid: Pick<RecordGrid, 'bars' | 'beatsPerBar' | 'subdivision'>): string {
  const perBeat = clicksPerBeat(grid.subdivision);
  const perBar = grid.beatsPerBar * perBeat;
  const pads = [...new Set(notes.map((n) => n.pad))].sort((a, b) => padOrder(a) - padOrder(b));
  return pads
    .map((pad) => {
      const steps = Array.from({ length: grid.bars * perBar }, () => '-');
      for (const n of notes) if (n.pad === pad) steps[n.bar * perBar + n.beat * perBeat + n.subdivision] = n.accent ? 'X' : 'x';
      const bars = Array.from({ length: grid.bars }, (_, b) => steps.slice(b * perBar, (b + 1) * perBar).join(''));
      return `${padAlias(pad)}: ${bars.join(' | ')}`;
    })
    .join('\n');
}

function padOrder(pad: Pad): number {
  return KIT_ORDER.indexOf(pad);
}

function padAlias(pad: Pad): string {
  return Object.entries(PAD_ALIASES).find(([, p]) => p === pad)?.[0] ?? pad;
}
