import type { ScriptedHit } from './input';

/**
 * Basic rock beat: 8th-note closed hi-hats, kick on 1 and 3, snare on 2 and 4.
 * Hi-hats on the beat are slightly accented.
 */
export function rockBeat(bpm: number, bars = 2): ScriptedHit[] {
  const beatMs = 60_000 / bpm;
  const eighthMs = beatMs / 2;
  const hits: ScriptedHit[] = [];
  for (let bar = 0; bar < bars; bar++) {
    const barStart = bar * 4 * beatMs;
    for (let i = 0; i < 8; i++) {
      hits.push({ pad: 'hihatClosed', at: barStart + i * eighthMs, velocity: i % 2 === 0 ? 100 : 70 });
    }
    hits.push({ pad: 'kick', at: barStart, velocity: 110 });
    hits.push({ pad: 'kick', at: barStart + 2 * beatMs, velocity: 110 });
    hits.push({ pad: 'snare', at: barStart + beatMs, velocity: 115 });
    hits.push({ pad: 'snare', at: barStart + 3 * beatMs, velocity: 115 });
  }
  return hits.sort((a, b) => a.at - b.at);
}
