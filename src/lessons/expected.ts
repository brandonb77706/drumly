import type { ExpectedNote, GradeResult } from '../grading';
import { clicksPerBeat } from '../metronome/timing';
import type { ClickTime, Lesson, LessonNote } from './types';

export interface LessonTiming {
  /** Metronome bar where the lesson's bar 0 falls. Default 0 (the first bar after the count-in). */
  startBar?: number;
  /** How many passes to produce: 1 (default) or Infinity for loop mode. */
  passes?: number;
}

/**
 * Turn lesson positions into ExpectedNotes using the metronome's actual click times.
 *
 * Each note gets the exact `time` of the click at its (bar, beat, subdivision). Nothing is
 * recomputed from BPM, so the grading grid is identical to what the player hears, even if
 * the tempo changes mid-run. Notes are produced only for clicks that are passed in: pass the
 * clicks covering the window you care about (e.g. metronome.getGrid(from, to)).
 *
 * In loop mode, pass k covers metronome bars startBar + k*bars ... startBar + (k+1)*bars - 1.
 * Note ids are `${lesson.id}#${pass}.${noteIndex}`, stable across calls.
 */
export function lessonToExpectedNotes(lesson: Lesson, clicks: readonly ClickTime[], timing: LessonTiming = {}): ExpectedNote[] {
  const startBar = timing.startBar ?? 0;
  const passes = timing.passes ?? 1;
  const stepsPerBeat = clicksPerBeat(lesson.subdivision);

  const byPosition = new Map<string, { note: LessonNote; index: number }[]>();
  lesson.notes.forEach((note, index) => {
    const key = positionKey(note.bar, note.beat, note.subdivision);
    const list = byPosition.get(key);
    if (list) list.push({ note, index });
    else byPosition.set(key, [{ note, index }]);
  });

  const out: { expected: ExpectedNote; pass: number; index: number }[] = [];
  for (const click of clicks) {
    if (click.isCountIn || click.bar < startBar) continue;
    if (click.subdivisionsPerBeat !== undefined && click.subdivisionsPerBeat !== stepsPerBeat) {
      throw new Error(
        `Lesson "${lesson.id}" is written in ${lesson.subdivision} steps (${stepsPerBeat} per beat), but the metronome is clicking ${click.subdivisionsPerBeat} per beat.`,
      );
    }
    if (click.beatsPerBar !== undefined && click.beatsPerBar !== lesson.beatsPerBar) {
      throw new Error(`Lesson "${lesson.id}" has ${lesson.beatsPerBar} beats per bar, but the metronome has ${click.beatsPerBar}.`);
    }
    const relativeBar = click.bar - startBar;
    const pass = Math.floor(relativeBar / lesson.bars);
    if (pass >= passes) continue;
    const entries = byPosition.get(positionKey(relativeBar % lesson.bars, click.beat, click.subdivision));
    if (!entries) continue;
    for (const { note, index } of entries) {
      out.push({
        expected: {
          id: noteId(lesson.id, pass, index),
          pad: note.pad,
          time: click.time,
          ...(note.accent ? { velocity: 127 } : {}),
        },
        pass,
        index,
      });
    }
  }
  out.sort((a, b) => a.expected.time - b.expected.time || a.pass - b.pass || a.index - b.index);
  return out.map((o) => o.expected);
}

export function noteId(lessonId: string, pass: number, index: number): string {
  return `${lessonId}#${pass}.${index}`;
}

/** The index into lesson.notes encoded in a lesson note id, or null for ids not made by lessonToExpectedNotes. */
export function noteIndex(id: string): number | null {
  const match = /#\d+\.(\d+)$/.exec(id);
  return match ? Number(match[1]) : null;
}

/** The pass number encoded in a lesson note id, or null for ids not made by lessonToExpectedNotes. */
export function notePass(id: string): number | null {
  const match = /#(\d+)\.\d+$/.exec(id);
  return match ? Number(match[1]) : null;
}

/**
 * The part of a (live or batch) grade belonging to one loop pass: notes of that pass, plus
 * extra hits with time in [fromTime, toTime). Use the pass's first downbeat minus the matching
 * window as fromTime, and the next pass's downbeat minus the window as toTime, so hits slightly
 * early for a downbeat count toward the pass that downbeat starts.
 */
export function resultForPass(result: GradeResult, pass: number, fromTime: number, toTime: number): GradeResult {
  return {
    notes: result.notes.filter((r) => notePass(r.note.id) === pass),
    extras: result.extras.filter((e) => e.hit.time >= fromTime && e.hit.time < toTime),
  };
}

function positionKey(bar: number, beat: number, subdivision: number): string {
  return `${bar}:${beat}:${subdivision}`;
}

/** Default look-back for lessonNoteSource; see there. */
export const NOTE_FETCH_OVERLAP_MS = 250;

/**
 * A LiveGrader note source for a lesson, reading notes from a metronome-grid function.
 *
 * The grader asks for notes in back-to-back windows [from, to). Click times can move slightly
 * when the metronome refreshes its audio-clock reference (most at start-up, when it switches
 * from an estimate to getOutputTimestamp). Each request re-reads `overlapMs` behind `from`, so a
 * click that moved backward across a window edge is still found. The grader drops duplicates by id.
 */
export function lessonNoteSource(
  lesson: Lesson,
  getGrid: (fromTime: number, toTime: number) => readonly ClickTime[],
  timing: LessonTiming & { overlapMs?: number } = {},
): (fromTime: number, toTime: number) => ExpectedNote[] {
  const { overlapMs = NOTE_FETCH_OVERLAP_MS, ...rest } = timing;
  return (from, to) => lessonToExpectedNotes(lesson, getGrid(from - overlapMs, to), rest);
}
