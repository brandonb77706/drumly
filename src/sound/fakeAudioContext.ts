/**
 * Test helper: a fake AudioContext that records every scheduled start(when), with the clock moved
 * by hand. Only what the metronome and DrumKit use. Not imported by the app.
 */

/** performance.now() value when the fake audio clock reads 0. */
export const PERF_AT_ZERO = 50_000;
/** Fake output latency reported through getOutputTimestamp, ms. */
export const OUTPUT_LATENCY_MS = 20;

export interface StartRecord {
  kind: 'oscillator' | 'buffer';
  when: number;
  stopped: boolean;
}

export function fakeAudioContext() {
  const starts: StartRecord[] = [];
  const pans: number[] = [];
  const param = () => {
    const p = {
      value: 0,
      setValueAtTime: (v: number) => {
        p.value = v;
      },
      linearRampToValueAtTime: () => {},
      exponentialRampToValueAtTime: () => {},
      setTargetAtTime: (v: number) => {
        p.value = v;
      },
    };
    return p;
  };
  const node = () => ({ connect: (n: unknown) => n, disconnect: () => {} });
  const source = (kind: StartRecord['kind']) => {
    let record: StartRecord | null = null;
    return {
      ...node(),
      onended: null as null | (() => void),
      start(when: number) {
        record = { kind, when, stopped: false };
        starts.push(record);
      },
      stop(when?: number) {
        // stop() with no time means "now": a cancel.
        if (record && when === undefined) record.stopped = true;
      },
    };
  };
  const ctx = {
    currentTime: 1,
    sampleRate: 48_000,
    state: 'running',
    baseLatency: 0.005,
    outputLatency: 0.02,
    destination: {},
    resume: async () => {},
    close: async () => {},
    getOutputTimestamp: () => ({ contextTime: ctx.currentTime, performanceTime: PERF_AT_ZERO + ctx.currentTime * 1000 + OUTPUT_LATENCY_MS }),
    createGain: () => ({ ...node(), gain: param() }),
    createOscillator: () => ({ ...source('oscillator'), type: 'sine', frequency: param() }),
    createBufferSource: () => ({ ...source('buffer'), buffer: null as unknown, loop: false }),
    createBiquadFilter: () => ({ ...node(), type: 'lowpass', frequency: param(), Q: param() }),
    createStereoPanner: () => ({
      ...node(),
      pan: {
        set value(v: number) {
          pans.push(v);
        },
      },
    }),
    createBuffer: (_channels: number, length: number) => {
      const data = new Float32Array(length);
      return { getChannelData: () => data };
    },
  };
  return { ctx, starts, pans, audio: ctx as unknown as AudioContext };
}
