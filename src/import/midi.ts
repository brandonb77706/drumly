import { Midi } from '@tonejs/midi';
import type { Pad } from '../input';
import { MIDI_NOTE_TO_PAD } from '../input/padMaps';
import { describeMidiNote } from './gmNames';
import { MAX_FILL_BARS } from '../record/customLessons';
import { notesToText, quantizeHits, type RecordGrid, type RecordSubdivision } from '../record/quantize';
import type { ImportDraft } from './draft';

/** General MIDI drums use channel 10, which is 9 counting from 0 (as @tonejs/midi does). */
export const DRUM_CHANNEL = 9;
const DEFAULT_BPM = 120;

export interface MidiTrackInfo {
  readonly index: number;
  readonly name: string;
  /** 0-based (9 = channel 10). */
  readonly channel: number;
  readonly noteCount: number;
}

/** What the import screen needs to know before the player picks tracks and bars. */
export interface MidiFileInfo {
  readonly name: string;
  /** The file's first tempo, as the suggested BPM. */
  readonly bpm: number;
  readonly beatsPerBar: number;
  readonly timeSignature: readonly [number, number];
  /** Bars up to the last note. */
  readonly bars: number;
  readonly tracks: readonly MidiTrackInfo[];
  /** Tracks on channel 10 with notes: used by default. Empty means the player must pick a track. */
  readonly drumTracks: readonly number[];
  readonly warnings: readonly string[];
}

/** Parse a .mid / .midi file. Throws if the bytes aren't a MIDI file. */
export function readMidiFile(bytes: ArrayBuffer | Uint8Array): Midi {
  try {
    return new Midi(bytes);
  } catch (error) {
    throw new Error(`Not a readable MIDI file (${error instanceof Error ? error.message : String(error)}).`);
  }
}

/** Ticks per bar and beats per bar (counted in quarter notes, like the metronome). */
function meter(midi: Midi): { beatsPerBar: number; ticksPerBar: number; timeSignature: [number, number]; warnings: string[] } {
  const warnings: string[] = [];
  const signatures = [...midi.header.timeSignatures].sort((a, b) => a.ticks - b.ticks);
  const first = signatures[0]?.timeSignature;
  let num = first?.[0] ?? 4;
  let den = first?.[1] ?? 4;
  const changes = new Set(signatures.map((s) => s.timeSignature.join('/'))).size;
  if (changes > 1) warnings.push(`The file changes time signature; using the first one (${num}/${den}) throughout.`);
  let beatsPerBar = (num * 4) / den;
  if (!Number.isInteger(beatsPerBar) || beatsPerBar < 1 || beatsPerBar > 16) {
    warnings.push(`${num}/${den} doesn't fit a grid of quarter-note beats; importing as 4/4.`);
    num = 4;
    den = 4;
    beatsPerBar = 4;
  }
  return { beatsPerBar, ticksPerBar: midi.header.ppq * beatsPerBar, timeSignature: [num, den], warnings };
}

function firstTempo(midi: Midi): { bpm: number; warnings: string[] } {
  const tempos = [...midi.header.tempos].sort((a, b) => a.ticks - b.ticks);
  const first = tempos[0];
  if (!first) return { bpm: DEFAULT_BPM, warnings: [`The file has no tempo; using ${DEFAULT_BPM} BPM.`] };
  const bpm = Math.round(first.bpm * 10) / 10;
  const distinct = new Set(tempos.map((t) => Math.round(t.bpm * 10) / 10));
  const warnings = distinct.size > 1 ? [`The file changes tempo (${[...distinct].slice(0, 4).join(', ')}${distinct.size > 4 ? ', …' : ''} BPM); using the first tempo, ${bpm} BPM. Notes keep their place in the bar.`] : [];
  return { bpm, warnings };
}

export function midiInfo(midi: Midi, fileName = ''): MidiFileInfo {
  const { beatsPerBar, ticksPerBar, timeSignature, warnings: meterWarnings } = meter(midi);
  const { bpm, warnings: tempoWarnings } = firstTempo(midi);
  const tracks = midi.tracks.map((t, index): MidiTrackInfo => ({ index, name: t.name.trim() || `Track ${index + 1}`, channel: t.channel, noteCount: t.notes.length }));
  const lastTick = Math.max(0, ...midi.tracks.flatMap((t) => t.notes.map((n) => n.ticks)));
  return {
    name: midi.name.trim() || fileName.replace(/\.midi?$/i, ''),
    bpm,
    beatsPerBar,
    timeSignature,
    bars: Math.floor(lastTick / ticksPerBar) + 1,
    tracks,
    drumTracks: tracks.filter((t) => t.channel === DRUM_CHANNEL && t.noteCount > 0).map((t) => t.index),
    warnings: [...tempoWarnings, ...meterWarnings],
  };
}

export interface MidiImportOptions {
  /** Tracks to take notes from. Default: the channel-10 tracks. */
  tracks?: readonly number[];
  /** 1-based, inclusive. Default: the whole file. */
  fromBar?: number;
  toBar?: number;
  /** Default 'sixteenth'. */
  subdivision?: RecordSubdivision;
  fileName?: string;
  /**
   * The player's choice for note numbers that have no pad in MIDI_NOTE_TO_PAD: a pad to play
   * them on, or 'ignore'. Only for this import; the built-in map is never changed.
   */
  noteMap?: ReadonlyMap<number, Pad | 'ignore'>;
}

/** A note number with no pad in MIDI_NOTE_TO_PAD, and what this import does with it. */
export interface NoPadNote {
  readonly note: number;
  /** How often it was played in the chosen bars. */
  readonly count: number;
  /** From MidiImportOptions.noteMap; null means it was left out. */
  readonly mappedTo: Pad | 'ignore' | null;
}

export interface MidiImport {
  readonly draft: ImportDraft;
  /** Note numbers in the chosen bars with no pad in MIDI_NOTE_TO_PAD, and how often each was played. */
  readonly unmapped: readonly { readonly note: number; readonly count: number }[];
  /** Every note number with no built-in pad (left out, ignored, or mapped by noteMap), lowest first. */
  readonly noPad: readonly NoPadNote[];
  /** Notes kept (after quantizing and merging). */
  readonly noteCount: number;
}

/**
 * Drum notes from a MIDI file as an import draft. Notes are placed by their tick position (so a
 * tempo change can't move them off the grid), then snapped with the same quantizer as Record.
 * A fill (up to MAX_FILL_BARS bars) also keeps its landing: beat 1 of the bar after the range.
 */
export function midiToDraft(midi: Midi, options: MidiImportOptions = {}): MidiImport {
  const info = midiInfo(midi, options.fileName);
  const { ticksPerBar } = meter(midi);
  const ppq = midi.header.ppq;
  const fromBar = clampBar(options.fromBar ?? 1, info.bars);
  const toBar = Math.max(fromBar, clampBar(options.toBar ?? info.bars, info.bars));
  const bars = toBar - fromBar + 1;
  const subdivision = options.subdivision ?? 'sixteenth';
  const warnings = [...info.warnings];

  let trackIndices = options.tracks ?? info.drumTracks;
  if (trackIndices.length === 0) {
    const busiest = [...info.tracks].sort((a, b) => b.noteCount - a.noteCount)[0];
    trackIndices = busiest && busiest.noteCount > 0 ? [busiest.index] : [];
    if (busiest) warnings.push(`No notes on channel 10 (drums); using "${busiest.name}". Pick the drum track if that's wrong.`);
  }

  const landing = bars <= MAX_FILL_BARS;
  // Time on a steady grid at the first tempo: one quarter note = 60000 / bpm ms.
  const msPerTick = 60_000 / info.bpm / ppq;
  const startTick = (fromBar - 1) * ticksPerBar;
  const endTick = startTick + (bars + (landing ? 1 : 0)) * ticksPerBar;
  const hits = [];
  const noPadCounts = new Map<number, number>();
  for (const index of trackIndices) {
    for (const note of midi.tracks[index]?.notes ?? []) {
      // A little before the range too: a note played slightly early still snaps to the first step.
      if (note.ticks < startTick - ppq / 8 || note.ticks >= endTick) continue;
      const builtIn = MIDI_NOTE_TO_PAD.get(note.midi);
      if (!builtIn && note.ticks >= startTick) noPadCounts.set(note.midi, (noPadCounts.get(note.midi) ?? 0) + 1);
      const chosen = builtIn ? undefined : options.noteMap?.get(note.midi);
      const pad = builtIn ?? (chosen === 'ignore' ? undefined : chosen);
      if (!pad) continue;
      hits.push({ pad, velocity: Math.round(note.velocity * 127), time: (note.ticks - startTick) * msPerTick });
    }
  }

  const grid: RecordGrid = { startTime: 0, bpm: info.bpm, bars, beatsPerBar: info.beatsPerBar, subdivision, landing };
  const notes = quantizeHits(hits, grid);
  const noPad = [...noPadCounts]
    .sort((a, b) => a[0] - b[0])
    .map(([note, count]): NoPadNote => ({ note, count, mappedTo: options.noteMap?.get(note) ?? null }));
  const list = noPad.filter((u) => u.mappedTo === null).map(({ note, count }) => ({ note, count }));
  if (list.length > 0) {
    const left = list.reduce((s, u) => s + u.count, 0);
    warnings.push(`Left out ${left} note${left === 1 ? '' : 's'} with no pad: ${list.map((u) => `${describeMidiNote(u.note)} ${u.count}×`).join(', ')}. Pick a pad for them below.`);
  }
  if (notes.length === 0) warnings.push('No drum notes in the chosen bars.');
  const range = fromBar === 1 && toBar === info.bars ? '' : ` (bars ${fromBar}–${toBar})`;
  return {
    draft: {
      origin: 'midi',
      title: `${info.name || 'MIDI import'}${range}`,
      bpm: info.bpm,
      beatsPerBar: info.beatsPerBar,
      subdivision,
      text: notes.length > 0 ? notesToText(notes, { ...grid, bars: bars + (landing ? 1 : 0) }) : '',
      landing,
      warnings,
    },
    unmapped: list,
    noPad,
    noteCount: notes.length,
  };
}

function clampBar(bar: number, max: number): number {
  return Math.min(max, Math.max(1, Math.round(Number.isFinite(bar) ? bar : 1)));
}
