import type { Pad } from '../input/types';
import { voiceFor, type NoiseLayer, type ToneLayer } from './voices';

export interface PlayOptions {
  /** Extra gain on top of velocity, e.g. 0.35 for a quiet guide track. Default 1. */
  gain?: number;
  /** Stereo position, -1 (left) .. 1 (right). Default 0. */
  pan?: number;
}

const ATTACK_S = 0.002;
/** Exponential ramps can't reach 0. */
const SILENT = 0.0001;
/** Seconds of noise in the shared buffer (looped for longer cymbals). */
const NOISE_SECONDS = 1;

interface Voice {
  /** AudioContext time the voice starts. */
  when: number;
  sources: AudioScheduledSourceNode[];
  nodes: AudioNode[];
}

/**
 * Thin Web Audio wrapper that plays DRUM_VOICES. Every sound is booked at an exact AudioContext
 * time with start(when); nothing here uses timers. Shares the metronome's AudioContext, with its
 * own volume ("Drums"), separate from the click.
 */
export class DrumKit {
  private readonly output: GainNode;
  private noiseBuffer: AudioBuffer | null = null;
  private readonly voices = new Set<Voice>();
  private volume: number;

  constructor(
    readonly ctx: AudioContext,
    volume = 0.8,
  ) {
    this.volume = clamp01(volume);
    this.output = ctx.createGain();
    this.output.gain.value = this.volume;
    this.output.connect(ctx.destination);
  }

  /** 0..1, applied smoothly. */
  setVolume(volume: number): void {
    this.volume = clamp01(volume);
    this.output.gain.setTargetAtTime(this.volume, this.ctx.currentTime, 0.01);
  }

  getVolume(): number {
    return this.volume;
  }

  /**
   * Play `pad` at AudioContext time `when` (seconds). A time already in the past plays now.
   * Returns the time it was booked for.
   */
  play(pad: Pad, velocity: number, when: number, options: PlayOptions = {}): number {
    const ctx = this.ctx;
    const t = Math.max(when, ctx.currentTime);
    const layers = voiceFor(pad, velocity, options.gain ?? 1);
    if (layers.every((l) => l.level <= 0)) return t;

    let bus: AudioNode = this.output;
    const voice: Voice = { when: t, sources: [], nodes: [] };
    const pan = options.pan ?? 0;
    if (pan !== 0 && typeof ctx.createStereoPanner === 'function') {
      const panner = ctx.createStereoPanner();
      panner.pan.value = Math.max(-1, Math.min(1, pan));
      panner.connect(this.output);
      voice.nodes.push(panner);
      bus = panner;
    }

    let longest = 0;
    for (const layer of layers) {
      if (layer.level <= 0) continue;
      const envelope = ctx.createGain();
      envelope.gain.setValueAtTime(0, t);
      envelope.gain.linearRampToValueAtTime(layer.level, t + ATTACK_S);
      envelope.gain.exponentialRampToValueAtTime(SILENT, t + layer.decayS);
      envelope.connect(bus);
      voice.nodes.push(envelope);
      const source = layer.kind === 'tone' ? this.tone(layer, t, envelope, voice) : this.noise(layer, t, envelope, voice);
      source.start(t);
      source.stop(t + layer.decayS + 0.02);
      voice.sources.push(source);
      longest = Math.max(longest, layer.decayS);
    }

    // Clean up once the longest layer has ended.
    const last = voice.sources[voice.sources.length - 1];
    if (last) {
      last.onended = () => this.release(voice);
    }
    this.voices.add(voice);
    return t;
  }

  /** Silence every sound booked to start after now (e.g. the rest of a "Listen" turn when Stop is pressed). Ringing sounds decay naturally. */
  cancelScheduled(): void {
    const now = this.ctx.currentTime;
    for (const voice of [...this.voices]) {
      if (voice.when <= now) continue;
      for (const source of voice.sources) {
        source.onended = null;
        try {
          source.stop();
        } catch {
          // never started
        }
      }
      this.release(voice);
    }
  }

  /** Number of voices booked or still ringing (for tests and debugging). */
  get activeVoices(): number {
    return this.voices.size;
  }

  private tone(layer: ToneLayer, t: number, out: AudioNode, voice: Voice): OscillatorNode {
    const osc = this.ctx.createOscillator();
    osc.type = layer.wave;
    osc.frequency.setValueAtTime(layer.startHz, t);
    if (layer.sweepS > 0 && layer.endHz !== layer.startHz) osc.frequency.exponentialRampToValueAtTime(layer.endHz, t + layer.sweepS);
    osc.connect(out);
    voice.nodes.push(osc);
    return osc;
  }

  private noise(layer: NoiseLayer, t: number, out: AudioNode, voice: Voice): AudioBufferSourceNode {
    const source = this.ctx.createBufferSource();
    source.buffer = this.getNoise();
    source.loop = true;
    const filter = this.ctx.createBiquadFilter();
    filter.type = layer.filter;
    filter.frequency.setValueAtTime(Math.min(layer.hz, this.ctx.sampleRate / 2 - 100), t);
    filter.Q.setValueAtTime(layer.q, t);
    source.connect(filter);
    filter.connect(out);
    voice.nodes.push(source, filter);
    return source;
  }

  private getNoise(): AudioBuffer {
    if (!this.noiseBuffer) {
      const length = Math.round(this.ctx.sampleRate * NOISE_SECONDS);
      const buffer = this.ctx.createBuffer(1, length, this.ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
      this.noiseBuffer = buffer;
    }
    return this.noiseBuffer;
  }

  private release(voice: Voice): void {
    if (!this.voices.delete(voice)) return;
    for (const node of voice.nodes) node.disconnect();
  }
}

function clamp01(v: number): number {
  return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0;
}
