import type { HitSourceKind } from '../input/types';

/**
 * Which hits play a drum sound as they happen. The default plays the keyboard (and scripted test
 * hits, which stand in for it) but not MIDI, because the Roland module makes its own sound.
 */
export type HitSoundMode = 'keyboard' | 'all' | 'off';

export const HIT_SOUND_MODES: readonly HitSoundMode[] = ['keyboard', 'all', 'off'];

export function isHitSoundMode(v: unknown): v is HitSoundMode {
  return (HIT_SOUND_MODES as readonly unknown[]).includes(v);
}

export function shouldPlayHitSound(mode: HitSoundMode, source: HitSourceKind): boolean {
  if (mode === 'off') return false;
  return mode === 'all' || source !== 'midi';
}
