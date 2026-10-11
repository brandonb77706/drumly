import { ANY_HIHAT } from '../grading';
import { lessonFromText } from './parse';
import type { Lesson, LessonFocus } from './types';

/** Focus from (bar, beat) to the landing on beat 1 of bar 3. Arguments are 1-based, like counting. */
function fillFocus(bar: number, beat: number): LessonFocus {
  return { start: { bar: bar - 1, beat: beat - 1, subdivision: 0 }, end: { bar: 2, beat: 0, subdivision: 0 } };
}

/**
 * Fills, easiest to hardest: a bar of groove, the fill, and the landing on beat 1 of the next bar.
 * The landing is part of the lesson (bar 3) and of the focus range, because coming out of a fill
 * on time is half the skill.
 */
export const FILL_LESSONS: readonly Lesson[] = [
  lessonFromText({
    id: 'fill-snare-eighths',
    title: '8th-note snare fill',
    category: 'fill',
    description: 'One bar of groove, then the groove for 3 beats and two 8th snares on beat 4. Land on crash plus kick in bar 3.',
    defaultBpm: 80,
    beatsPerBar: 4,
    subdivision: 'eighth',
    equivalentPads: [ANY_HIHAT],
    focus: fillFocus(2, 4),
    text: `
HH: xxxxxxxx | xxxxxx-- | --------
SN: --x---x- | --x---xx | --------
KK: x---x--- | x---x--- | x-------
CR: -------- | -------- | X-------
`,
  }),
  lessonFromText({
    id: 'fill-snare-sixteenths',
    title: 'Snare 16ths fill',
    category: 'fill',
    description: 'One bar of groove, then the groove for 3 beats and four 16th snares on beat 4. Land on crash plus kick in bar 3.',
    defaultBpm: 75,
    beatsPerBar: 4,
    subdivision: 'sixteenth',
    equivalentPads: [ANY_HIHAT],
    focus: fillFocus(2, 4),
    text: `
HH: x-x-x-x-x-x-x-x- | x-x-x-x-x-x----- | ----------------
SN: ----x-------x--- | ----x-------xxxx | ----------------
KK: x-------x------- | x-------x------- | x---------------
CR: ---------------- | ---------------- | X---------------
`,
  }),
  lessonFromText({
    id: 'fill-snare-floor-tom',
    title: 'Snare to floor tom',
    category: 'fill',
    description: 'One bar of groove, then the groove for 3 beats and 16ths on beat 4: snare, snare, floor tom, floor tom. Land on crash plus kick in bar 3.',
    defaultBpm: 75,
    beatsPerBar: 4,
    subdivision: 'sixteenth',
    equivalentPads: [ANY_HIHAT],
    focus: fillFocus(2, 4),
    text: `
HH: x-x-x-x-x-x-x-x- | x-x-x-x-x-x----- | ----------------
SN: ----x-------x--- | ----x-------xx-- | ----------------
T3: ---------------- | --------------xx | ----------------
KK: x-------x------- | x-------x------- | x---------------
CR: ---------------- | ---------------- | X---------------
`,
  }),
  lessonFromText({
    id: 'fill-triplet',
    title: 'Triplet fill',
    category: 'fill',
    description: 'One bar of quarter-note groove, then the groove for 3 beats and a triplet on beat 4: snare, tom 1, tom 2. Land on crash plus kick in bar 3.',
    defaultBpm: 70,
    beatsPerBar: 4,
    subdivision: 'triplet',
    equivalentPads: [ANY_HIHAT],
    focus: fillFocus(2, 4),
    text: `
HH: x--x--x--x-- | x--x--x----- | ------------
SN: ---x-----x-- | ---x-----x-- | ------------
T1: ------------ | ----------x- | ------------
T2: ------------ | -----------x | ------------
KK: x-----x----- | x-----x----- | x-----------
CR: ------------ | ------------ | X-----------
`,
  }),
  lessonFromText({
    id: 'fill-around-toms',
    title: 'Around the toms',
    category: 'fill',
    description: 'One bar of groove, then a bar with the fill on beats 3 and 4 (snare, snare, tom 1, tom 1, tom 2, tom 2, tom 3, tom 3), landing on crash plus kick in bar 3.',
    defaultBpm: 70,
    beatsPerBar: 4,
    subdivision: 'sixteenth',
    equivalentPads: [ANY_HIHAT],
    focus: fillFocus(2, 3),
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
  lessonFromText({
    id: 'fill-full-bar-toms',
    title: 'Full-bar tom run',
    category: 'fill',
    description: 'One bar of groove, then a whole bar of 16ths: 4 on snare, 4 on tom 1, 4 on tom 2, 4 on tom 3. Land on crash plus kick in bar 3.',
    defaultBpm: 65,
    beatsPerBar: 4,
    subdivision: 'sixteenth',
    equivalentPads: [ANY_HIHAT],
    focus: fillFocus(2, 1),
    text: `
HH: x-x-x-x-x-x-x-x- | ---------------- | ----------------
SN: ----x-------x--- | xxxx------------ | ----------------
T1: ---------------- | ----xxxx-------- | ----------------
T2: ---------------- | --------xxxx---- | ----------------
T3: ---------------- | ------------xxxx | ----------------
KK: x-------x------- | ---------------- | x---------------
CR: ---------------- | ---------------- | X---------------
`,
  }),
];
