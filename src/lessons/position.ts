/**
 * Drummer counting for one subdivision step within a beat, or null on the beat itself.
 * 16ths: 1 e & a. 8ths: 1 &. Triplets: 1 trip let.
 */
export function countSyllable(subdivision: number, subdivisionsPerBeat: number): string | null {
  if (subdivision === 0) return null;
  switch (subdivisionsPerBeat) {
    case 2:
      return 'and';
    case 3:
      return subdivision === 1 ? 'trip' : 'let';
    case 4:
      return (['e', 'and', 'a'] as const)[subdivision - 1] ?? null;
    default:
      return null;
  }
}

/**
 * Plain-language name of a position, from 0-based bar, beat and subdivision:
 * "beat 3 (bar 2)", "the 'e' of beat 4 (bar 2)", "the 'let' of beat 4 (bar 2)".
 */
export function positionLabel(bar: number, beat: number, subdivision: number, subdivisionsPerBeat: number): string {
  const syllable = countSyllable(subdivision, subdivisionsPerBeat);
  const where = syllable === null ? `beat ${beat + 1}` : `the '${syllable}' of beat ${beat + 1}`;
  return `${where} (bar ${bar + 1})`;
}
