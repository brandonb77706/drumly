import { PADS, type Pad } from '../input';
import { clicksPerBeat, type Subdivision } from '../metronome/timing';
import type { Lesson, LessonCategory, LessonFocus, LessonNote, LessonPosition } from './types';

/**
 * Short pad names for the lesson text format. Full pad names (e.g. "hihatClosed") also work.
 */
export const PAD_ALIASES: Readonly<Record<string, Pad>> = {
  HH: 'hihatClosed',
  OH: 'hihatOpen',
  HP: 'hihatPedal',
  SN: 'snare',
  SR: 'snareRim',
  XS: 'crossStick',
  KK: 'kick',
  BD: 'kick',
  T1: 'tom1',
  T2: 'tom2',
  T3: 'tom3',
  CR: 'crash',
  C2: 'crash2',
  RD: 'ride',
  RB: 'rideBell',
};

export class LessonParseError extends Error {
  override readonly name = 'LessonParseError';
}

export interface LessonGrid {
  beatsPerBar: number;
  subdivision: Subdivision;
  /** If given, every line must be exactly this many bars long. */
  bars?: number;
}

/**
 * Parse the lesson text format: one line per pad, one character per subdivision step.
 *
 *   HH: x-x-x-x-x-x-x-x-
 *   SN: ----x-------x---
 *   KK: x-------x-------
 *
 * - `x` = hit, `X` = accented hit, `-` or `.` = rest.
 * - Spaces and `|` are ignored, so bars can be separated visually: `x-x-x-x- | x-x-x-x-`.
 * - Blank lines and lines starting with `#` are ignored.
 * - Every line must have the same length, a whole number of bars
 *   (beatsPerBar x steps per beat for the subdivision).
 */
export function parseLessonText(text: string, grid: LessonGrid): { notes: LessonNote[]; bars: number } {
  const stepsPerBeat = clicksPerBeat(grid.subdivision);
  const stepsPerBar = grid.beatsPerBar * stepsPerBeat;
  const barShape = `${grid.beatsPerBar} beats x ${stepsPerBeat} ${grid.subdivision} step${stepsPerBeat === 1 ? '' : 's'}`;

  const lines: { lineNo: number; name: string; pad: Pad; steps: string }[] = [];
  text.split(/\r?\n/).forEach((raw, i) => {
    const lineNo = i + 1;
    const line = raw.trim();
    if (line === '' || line.startsWith('#')) return;
    const colon = line.indexOf(':');
    if (colon === -1) throw new LessonParseError(`Line ${lineNo}: expected "PAD: pattern", got "${line}".`);
    const name = line.slice(0, colon).trim();
    const pad = resolvePad(name);
    if (!pad) {
      throw new LessonParseError(
        `Line ${lineNo}: unknown pad "${name}". Use one of ${Object.keys(PAD_ALIASES).join(', ')} or a full pad name (${PADS.join(', ')}).`,
      );
    }
    const steps = line.slice(colon + 1).replace(/[\s|]/g, '');
    const bad = steps.search(/[^xX.\-]/);
    if (bad !== -1) {
      throw new LessonParseError(`Line ${lineNo} (${name}): unexpected character "${steps[bad]}" at step ${bad + 1}. Use x, X, - or .`);
    }
    const duplicate = lines.find((l) => l.pad === pad);
    if (duplicate) throw new LessonParseError(`Line ${lineNo} (${name}): pad ${pad} was already given on line ${duplicate.lineNo}.`);
    lines.push({ lineNo, name, pad, steps });
  });

  if (lines.length === 0) throw new LessonParseError('Lesson text has no pad lines.');

  const expectedLength = grid.bars !== undefined ? grid.bars * stepsPerBar : lines[0]!.steps.length;
  for (const l of lines) {
    if (l.steps.length === 0 || l.steps.length % stepsPerBar !== 0) {
      throw new LessonParseError(
        `Line ${l.lineNo} (${l.name}) has ${l.steps.length} steps; each bar needs ${stepsPerBar} (${barShape}), so the length must be a multiple of ${stepsPerBar}.`,
      );
    }
    if (l.steps.length !== expectedLength) {
      const why = grid.bars !== undefined ? `${grid.bars} bar${grid.bars === 1 ? '' : 's'} of ${stepsPerBar} steps` : `the same length as line ${lines[0]!.lineNo}`;
      throw new LessonParseError(`Line ${l.lineNo} (${l.name}) has ${l.steps.length} steps; expected ${expectedLength} (${why}).`);
    }
  }

  const notes: (LessonNote & { step: number; line: number })[] = [];
  lines.forEach((l, lineIndex) => {
    for (let step = 0; step < l.steps.length; step++) {
      const c = l.steps[step]!;
      if (c !== 'x' && c !== 'X') continue;
      notes.push({
        pad: l.pad,
        bar: Math.floor(step / stepsPerBar),
        beat: Math.floor((step % stepsPerBar) / stepsPerBeat),
        subdivision: step % stepsPerBeat,
        ...(c === 'X' ? { accent: true } : {}),
        step,
        line: lineIndex,
      });
    }
  });
  notes.sort((a, b) => a.step - b.step || a.line - b.line);
  return { notes: notes.map(({ step: _step, line: _line, ...n }) => n), bars: expectedLength / stepsPerBar };
}

export interface LessonSpec {
  id: string;
  title: string;
  /** Default 'beat'. */
  category?: LessonCategory;
  description: string;
  defaultBpm: number;
  beatsPerBar: number;
  subdivision: Subdivision;
  text: string;
  bars?: number;
  equivalentPads?: readonly (readonly Pad[])[];
  focus?: LessonFocus;
}

/** Build a Lesson from the text format. Throws LessonParseError with a clear message on bad input. */
export function lessonFromText(spec: LessonSpec): Lesson {
  const { notes, bars } = parseLessonText(spec.text, {
    beatsPerBar: spec.beatsPerBar,
    subdivision: spec.subdivision,
    ...(spec.bars !== undefined ? { bars: spec.bars } : {}),
  });
  return {
    id: spec.id,
    title: spec.title,
    category: spec.category ?? 'beat',
    description: spec.description,
    defaultBpm: spec.defaultBpm,
    beatsPerBar: spec.beatsPerBar,
    bars,
    subdivision: spec.subdivision,
    notes,
    ...(spec.equivalentPads ? { equivalentPads: spec.equivalentPads } : {}),
    ...(spec.focus ? { focus: checkFocus(spec.focus, { beatsPerBar: spec.beatsPerBar, subdivision: spec.subdivision, bars }) } : {}),
    source: spec.text.trim(),
  };
}

function checkFocus(focus: LessonFocus, grid: { beatsPerBar: number; subdivision: Subdivision; bars: number }): LessonFocus {
  const stepsPerBeat = clicksPerBeat(grid.subdivision);
  const step = (p: LessonPosition, name: string) => {
    const ok =
      [p.bar, p.beat, p.subdivision].every(Number.isInteger) &&
      p.bar >= 0 && p.bar < grid.bars &&
      p.beat >= 0 && p.beat < grid.beatsPerBar &&
      p.subdivision >= 0 && p.subdivision < stepsPerBeat;
    if (!ok) throw new LessonParseError(`Focus ${name} (bar ${p.bar}, beat ${p.beat}, step ${p.subdivision}) is outside the lesson's grid.`);
    return (p.bar * grid.beatsPerBar + p.beat) * stepsPerBeat + p.subdivision;
  };
  if (step(focus.start, 'start') > step(focus.end, 'end')) throw new LessonParseError('Focus start is after focus end.');
  return focus;
}

/** Render a lesson back to the text format (one line per pad, bars separated by " | "). */
export function formatLessonText(lesson: Lesson): string {
  const stepsPerBeat = clicksPerBeat(lesson.subdivision);
  const stepsPerBar = lesson.beatsPerBar * stepsPerBeat;
  const alias = (pad: Pad) => Object.entries(PAD_ALIASES).find(([, p]) => p === pad)?.[0] ?? pad;
  const pads: Pad[] = [];
  for (const n of lesson.notes) if (!pads.includes(n.pad)) pads.push(n.pad);
  return pads
    .map((pad) => {
      const steps = Array.from({ length: lesson.bars * stepsPerBar }, () => '-');
      for (const n of lesson.notes) {
        if (n.pad === pad) steps[n.bar * stepsPerBar + n.beat * stepsPerBeat + n.subdivision] = n.accent ? 'X' : 'x';
      }
      const bars = Array.from({ length: lesson.bars }, (_, b) => steps.slice(b * stepsPerBar, (b + 1) * stepsPerBar).join(''));
      return `${alias(pad)}: ${bars.join(' | ')}`;
    })
    .join('\n');
}

function resolvePad(name: string): Pad | undefined {
  const alias = PAD_ALIASES[name.toUpperCase()];
  if (alias) return alias;
  return (PADS as readonly string[]).includes(name) ? (name as Pad) : undefined;
}
