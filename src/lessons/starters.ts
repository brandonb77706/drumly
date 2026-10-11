import { ANY_HIHAT } from '../grading';
import { lessonFromText } from './parse';
import type { Lesson } from './types';

export const STARTER_LESSONS: readonly Lesson[] = [
  lessonFromText({
    id: 'rock-quarters',
    title: 'Quarter-note rock beat',
    description: 'Hi-hat on every beat, kick on 1 and 3, snare on 2 and 4. Any hi-hat sound counts.',
    defaultBpm: 80,
    beatsPerBar: 4,
    subdivision: 'quarter',
    equivalentPads: [ANY_HIHAT],
    text: `
HH: xxxx | xxxx
SN: -x-x | -x-x
KK: x-x- | x-x-
`,
  }),
  lessonFromText({
    id: 'rock-eighths',
    title: '8th-note rock beat',
    description: 'Hi-hat 8ths, kick on 1 and 3, snare on 2 and 4. Any hi-hat sound counts.',
    defaultBpm: 90,
    beatsPerBar: 4,
    subdivision: 'eighth',
    equivalentPads: [ANY_HIHAT],
    text: `
HH: xxxxxxxx | xxxxxxxx
SN: --x---x- | --x---x-
KK: x---x--- | x---x---
`,
  }),
  lessonFromText({
    id: 'rock-kick-variation',
    title: 'Kick variation',
    description: '8th-note beat with the kick on 1, the "and" of 2, and 3.',
    defaultBpm: 85,
    beatsPerBar: 4,
    subdivision: 'eighth',
    text: `
HH: xxxxxxxx | xxxxxxxx
SN: --x---x- | --x---x-
KK: x--xx--- | x--xx---
`,
  }),
  lessonFromText({
    id: 'rock-sixteenths',
    title: '16th-note hi-hat beat',
    description: 'Hi-hat 16ths, kick on 1 and 3, snare on 2 and 4. Start slow and keep the hi-hat even.',
    defaultBpm: 65,
    beatsPerBar: 4,
    subdivision: 'sixteenth',
    text: `
HH: xxxxxxxxxxxxxxxx | xxxxxxxxxxxxxxxx
SN: ----x-------x--- | ----x-------x---
KK: x-------x------- | x-------x-------
`,
  }),
];
