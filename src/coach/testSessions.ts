import type { GradeResult, NoteResult } from '../grading';
import type { Pad } from '../input';
import { noteId, type Lesson } from '../lessons';
import type { SessionPass } from './types';

/** Test helper: scripted sessions without a metronome. */
type Override = { status: 'missed' } | { offset: number; pad?: Pad };

/** One pass of `lesson`: every note perfect unless overridden (by lesson note index). */
export function scriptedPass(lesson: Lesson, p: number, bpm: number, overrides: (i: number) => Override | undefined = () => undefined): SessionPass {
  const notes = lesson.notes.map((n, i): NoteResult => {
    const note = { id: noteId(lesson.id, p, i), pad: n.pad, time: 10_000 * p + i * 100 };
    const o = overrides(i);
    if (o && 'status' in o) return { note, status: 'missed' };
    const offset = o?.offset ?? 0;
    const pad = o && 'pad' in o && o.pad ? o.pad : n.pad;
    return {
      note,
      status: pad === n.pad ? 'hit' : 'wrongPad',
      hit: { pad, time: note.time + offset, velocity: 100, source: 'test' },
      offsetMs: offset,
      timing: Math.abs(offset) <= 20 ? 'perfect' : Math.abs(offset) <= 40 ? 'good' : offset < 0 ? 'early' : 'late',
    };
  });
  const result: GradeResult = { notes, extras: [] };
  return { bpm, result };
}

