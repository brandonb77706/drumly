import { MAX_VELOCITY, type Pad } from '../input/types';

/**
 * Synthesized drum voices: pure parameters, no Web Audio. Every sound is built from a few layers,
 * each a pitched oscillator or a burst of filtered noise with an exponential decay. No sample
 * files, so nothing to license or download.
 */

/** A pitched layer: an oscillator gliding from startHz to endHz (the "thump" of kicks and toms). */
export interface ToneLayer {
  readonly kind: 'tone';
  readonly wave: 'sine' | 'triangle' | 'square';
  readonly startHz: number;
  readonly endHz: number;
  /** Time to glide from startHz to endHz, seconds. */
  readonly sweepS: number;
  /** Time to fade to silence, seconds. */
  readonly decayS: number;
  /** Peak level at full velocity, 0..1. */
  readonly level: number;
}

/** A noise layer through one filter (snare wires, hi-hats, cymbals, stick clicks). */
export interface NoiseLayer {
  readonly kind: 'noise';
  readonly filter: 'highpass' | 'bandpass' | 'lowpass';
  readonly hz: number;
  readonly q: number;
  readonly decayS: number;
  readonly level: number;
}

export type VoiceLayer = ToneLayer | NoiseLayer;

export interface DrumVoice {
  readonly layers: readonly VoiceLayer[];
}

const tone = (wave: ToneLayer['wave'], startHz: number, endHz: number, sweepS: number, decayS: number, level: number): ToneLayer => ({
  kind: 'tone',
  wave,
  startHz,
  endHz,
  sweepS,
  decayS,
  level,
});
const noise = (filter: NoiseLayer['filter'], hz: number, q: number, decayS: number, level: number): NoiseLayer => ({ kind: 'noise', filter, hz, q, decayS, level });

/** A tom: a sine with a pitch drop, plus a little stick noise. Lower toms are lower and ring longer. */
const tom = (hz: number, decayS: number): DrumVoice => ({
  layers: [tone('sine', hz * 1.45, hz, 0.12, decayS, 0.95), noise('lowpass', 2200, 0.7, 0.04, 0.18)],
});

/** One voice per pad. */
export const DRUM_VOICES: Readonly<Record<Pad, DrumVoice>> = {
  // Sine with a fast pitch drop, plus a short beater click.
  kick: { layers: [tone('sine', 160, 45, 0.09, 0.45, 1), noise('highpass', 2500, 0.7, 0.012, 0.25)] },
  // Noise burst for the wires plus a tone body.
  snare: { layers: [tone('triangle', 240, 180, 0.04, 0.14, 0.55), noise('highpass', 1400, 0.7, 0.19, 0.75)] },
  snareRim: { layers: [tone('triangle', 520, 430, 0.02, 0.07, 0.5), noise('bandpass', 3000, 1.5, 0.08, 0.85)] },
  // Short click.
  crossStick: { layers: [tone('sine', 1100, 900, 0.01, 0.035, 0.45), noise('bandpass', 2000, 6, 0.04, 0.9)] },
  // High-passed noise: short closed, long open, very short pedal.
  hihatClosed: { layers: [noise('highpass', 7500, 0.7, 0.05, 0.55)] },
  hihatOpen: { layers: [noise('highpass', 7000, 0.7, 0.45, 0.5)] },
  hihatPedal: { layers: [noise('highpass', 6000, 0.7, 0.025, 0.4)] },
  // Pitched sines, descending.
  tom1: tom(200, 0.35),
  tom2: tom(155, 0.42),
  tom3: tom(110, 0.55),
  // Band-passed noise, long decay.
  crash: { layers: [noise('bandpass', 5500, 0.5, 1.6, 0.6), noise('highpass', 9000, 0.7, 1.1, 0.25)] },
  crash2: { layers: [noise('bandpass', 4800, 0.5, 1.4, 0.6), noise('highpass', 8500, 0.7, 1, 0.25)] },
  ride: { layers: [noise('bandpass', 7500, 1.2, 1.1, 0.35), tone('triangle', 3100, 3100, 0, 0.7, 0.08)] },
  // The bell: brighter and shorter than the ride.
  rideBell: { layers: [tone('sine', 2650, 2650, 0, 0.55, 0.35), tone('sine', 3980, 3980, 0, 0.35, 0.18), noise('bandpass', 9500, 1.5, 0.25, 0.2)] },
};

/**
 * Loudness for a velocity (1..127), 0..1. A curve rather than a straight line, so soft notes are
 * clearly softer, like a real drum.
 */
export function velocityGain(velocity: number): number {
  const v = Math.min(MAX_VELOCITY, Math.max(0, Number.isFinite(velocity) ? velocity : 0)) / MAX_VELOCITY;
  return v ** 1.5;
}

/** Filter frequency multiplier for a velocity: harder hits are slightly brighter (0.85 at 0, 1.15 at 127). */
export function velocityBrightness(velocity: number): number {
  const v = Math.min(MAX_VELOCITY, Math.max(0, Number.isFinite(velocity) ? velocity : 0)) / MAX_VELOCITY;
  return 0.85 + 0.3 * v;
}

/** A pad's layers for one hit, with velocity applied to level and brightness, and an extra gain (e.g. a quiet guide track). */
export function voiceFor(pad: Pad, velocity: number, gain = 1): VoiceLayer[] {
  const loud = velocityGain(velocity) * gain;
  const bright = velocityBrightness(velocity);
  return DRUM_VOICES[pad].layers.map((layer) =>
    layer.kind === 'tone' ? { ...layer, level: layer.level * loud } : { ...layer, level: layer.level * loud, hz: layer.hz * bright },
  );
}

/** How long a voice rings, seconds (its longest layer). */
export function voiceLength(pad: Pad): number {
  return Math.max(...DRUM_VOICES[pad].layers.map((l) => l.decayS));
}
