import { ANY_HIHAT } from '../grading';
import { lessonFromText } from './parse';
import type { Lesson } from './types';

/**
 * Fills: a bar of groove, the fill, and the landing on beat 1 of the next bar. The landing is
 * part of the lesson (bar 3) because coming out of a fill on time is half the skill.
 */
export const FILL_LESSONS: readonly Lesson[] = [
  lessonFromText({
    id: 'fill-snare-sixteenths',
    title: 'Snare 16ths fill',
    category: 'fill',
    description: 'One bar of the 8th-note rock beat, then the beat for 3 beats and four 16th snares on beat 4. Land on crash plus kick.',
    defaultBpm: 75,
    beatsPerBar: 4,
    subdivision: 'sixteenth',
    equivalentPads: [ANY_HIHAT],
    text: `
HH: x-x-x-x-x-x-x-x- | x-x-x-x-x-x----- | ----------------
SN: ----x-------x--- | ----x-------xxxx | ----------------
KK: x-------x------- | x-------x------- | x---------------
CR: ---------------- | ---------------- | X---------------
`,
  }),
  lessonFromText({
    id: 'fill-around-toms',
    title: 'Around the toms',
    category: 'fill',
    description: 'One bar of beat, then 16ths on beats 3 and 4 going snare, snare, tom 1, tom 1, tom 2, tom 2, tom 3, tom 3. Land on crash plus kick.',
    defaultBpm: 70,
    beatsPerBar: 4,
    subdivision: 'sixteenth',
    equivalentPads: [ANY_HIHAT],
    text: `
HH: x-x-x-x-x-x-x-x- | x-x-x-x--------- | ----------------
SN: ----x-------x--- | ----x---xx------ | ----------------
T1: ---------------- | ----------xx---- | ----------------
T2: ---------------- | ------------xx-- | ----------------
T3: ---------------- | --------------xx | ----------------
KK: x-------x------- | x--------------- | x---------------
CR: ---------------- | ---------------- | X---------------
`,
  }),
];
