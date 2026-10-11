import { describe, expect, it } from 'vitest';
import { PADS, type Pad } from '../input';
import { FILL_LESSONS, STARTER_LESSONS, drumGainForPass, lessonToExpectedNotes, sectionLesson, turnPlan } from '../lessons';
import { LOOKAHEAD_S, Metronome, type MetronomeClick, type Subdivision, type Ticker } from '../metronome';
import { DrumKit } from './DrumKit';
import { LessonSounds, LESSON_NOTE_VELOCITY } from './LessonSounds';
import { fakeAudioContext, OUTPUT_LATENCY_MS, PERF_AT_ZERO } from './fakeAudioContext';
import { shouldPlayHitSound } from './hitSounds';
import { DRUM_VOICES, velocityBrightness, velocityGain, voiceFor, voiceLength } from './voices';

class ManualTicker implements Ticker {
  private onTick: (() => void) | null = null;
  start(onTick: () => void): void {
    this.onTick = onTick;
  }
  stop(): void {
    this.onTick = null;
  }
  dispose(): void {}
  tick(): void {
    this.onTick?.();
  }
}

/** A metronome and drum kit sharing one fake AudioContext, with every booked drum recorded. */
async function rig(settings: { bpm: number; subdivision: Subdivision }) {
  const fake = fakeAudioContext();
  const ticker = new ManualTicker();
  const metronome = new Metronome({
    bpm: settings.bpm,
    beatsPerBar: 4,
    subdivision: settings.subdivision,
    countIn: true,
    createAudioContext: () => fake.audio,
    createTicker: () => ticker,
    now: () => PERF_AT_ZERO + fake.ctx.currentTime * 1000,
  });
  const kit = new DrumKit(metronome.getAudioContext());
  const played: { pad: Pad; velocity: number; when: number; gain: number }[] = [];
  const play = (pad: Pad, velocity: number, when: number, options: { gain?: number } = {}) => {
    played.push({ pad, velocity, when, gain: options.gain ?? 1 });
    kit.play(pad, velocity, when, options);
  };
  const clicks: MetronomeClick[] = [];
  metronome.onClick((c) => clicks.push(c));
  const advance = (seconds: number) => {
    const end = fake.ctx.currentTime + seconds;
    while (fake.ctx.currentTime < end - 1e-9) {
      fake.ctx.currentTime = Math.min(end, fake.ctx.currentTime + 0.025);
      ticker.tick();
    }
  };
  return { fake, metronome, kit, play, played, clicks, advance };
}

describe('drum voices', () => {
  it('every pad has a voice with sane parameters', () => {
    for (const pad of PADS) {
      const voice = DRUM_VOICES[pad];
      expect(voice.layers.length, pad).toBeGreaterThan(0);
      for (const layer of voice.layers) {
        expect(layer.level, pad).toBeGreaterThan(0);
        expect(layer.level, pad).toBeLessThanOrEqual(1);
        expect(layer.decayS, pad).toBeGreaterThan(0);
        if (layer.kind === 'tone') expect(Math.min(layer.startHz, layer.endHz), pad).toBeGreaterThan(20);
        else expect(layer.hz, pad).toBeGreaterThan(20);
      }
    }
  });

  it('the kit sounds like a kit: toms descend, the bell is shorter than the ride, open hi-hat rings longer than closed', () => {
    const pitch = (pad: Pad) => DRUM_VOICES[pad].layers.find((l) => l.kind === 'tone')!;
    const toms = (['tom1', 'tom2', 'tom3'] as const).map((p) => pitch(p)).map((l) => (l.kind === 'tone' ? l.endHz : NaN));
    expect(toms[0]!).toBeGreaterThan(toms[1]!);
    expect(toms[1]!).toBeGreaterThan(toms[2]!);
    expect(voiceLength('rideBell')).toBeLessThan(voiceLength('ride'));
    expect(voiceLength('hihatOpen')).toBeGreaterThan(voiceLength('hihatClosed') * 5);
    expect(voiceLength('hihatPedal')).toBeLessThan(voiceLength('hihatClosed'));
    expect(voiceLength('crash')).toBeGreaterThan(1);
    // The kick drops in pitch fast.
    const kick = pitch('kick');
    expect(kick.kind === 'tone' && kick.startHz > 2 * kick.endHz && kick.sweepS < 0.15).toBe(true);
  });

  it('velocity scales loudness (full at 127, none at 0, softer is clearly quieter) and slightly the brightness', () => {
    expect(velocityGain(127)).toBe(1);
    expect(velocityGain(0)).toBe(0);
    expect(velocityGain(64)).toBeLessThan(0.5);
    for (let v = 1; v <= 127; v++) expect(velocityGain(v)).toBeGreaterThan(velocityGain(v - 1));
    expect(velocityBrightness(127)).toBeCloseTo(1.15);
    expect(velocityBrightness(0)).toBeCloseTo(0.85);

    const soft = voiceFor('snare', 40);
    const hard = voiceFor('snare', 127);
    soft.forEach((layer, i) => expect(layer.level).toBeLessThan(hard[i]!.level));
    const noise = (layers: typeof soft) => layers.find((l) => l.kind === 'noise')!;
    expect(noise(soft).kind === 'noise' && noise(hard).kind === 'noise' && noise(soft).hz < noise(hard).hz).toBe(true);
    // An extra gain (the guide track) scales on top.
    expect(voiceFor('kick', 127, 0.3)[0]!.level).toBeCloseTo(DRUM_VOICES.kick.layers[0]!.level * 0.3);
  });

  it('hit sounds: keyboard on by default, MIDI off (the module makes its own sound)', () => {
    expect(shouldPlayHitSound('keyboard', 'keyboard')).toBe(true);
    expect(shouldPlayHitSound('keyboard', 'test')).toBe(true);
    expect(shouldPlayHitSound('keyboard', 'midi')).toBe(false);
    expect(shouldPlayHitSound('all', 'midi')).toBe(true);
    expect(shouldPlayHitSound('off', 'keyboard')).toBe(false);
  });
});

describe('DrumKit', () => {
  it('books every layer at the exact AudioContext time, pans when asked, and cancels only future sounds', () => {
    const fake = fakeAudioContext();
    const kit = new DrumKit(fake.audio);
    kit.play('snare', 100, 1.5);
    expect(fake.starts.map((s) => s.when)).toEqual([1.5, 1.5]); // tone body + noise
    kit.play('kick', 100, 0.2); // in the past: plays now
    expect(fake.starts.slice(2).every((s) => s.when === 1)).toBe(true);
    kit.play('crash', 100, 2, { pan: -0.8 });
    expect(fake.pans).toEqual([-0.8]);

    fake.ctx.currentTime = 1.6;
    kit.cancelScheduled();
    expect(fake.starts.filter((s) => s.stopped).map((s) => s.when)).toEqual([2, 2]); // only the crash, still ahead
  });
});

describe('LessonSounds', () => {
  it('books each lesson note at its click’s audioTime: the clock conversion grading uses puts it on the expected note time', async () => {
    const lesson = STARTER_LESSONS.find((l) => l.id === 'rock-eighths')!;
    const r = await rig({ bpm: 120, subdivision: 'eighth' });
    const sounds = new LessonSounds(lesson, r.play);
    r.metronome.onClick((c) => sounds.onClick(c));
    await r.metronome.start();
    r.advance(7);

    const expected = lessonToExpectedNotes(lesson, r.clicks);
    expect(expected).toHaveLength(lesson.notes.length);
    expect(r.played).toHaveLength(expected.length);
    const sorted = [...r.played].sort((a, b) => a.when - b.when);
    expected.forEach((note, i) => {
      const play = sorted.filter((p) => p.when === sorted[i]!.when);
      const click = r.clicks.find((c) => c.audioTime === sorted[i]!.when)!;
      // Same click: the drum starts exactly when that click sounds...
      expect(click).toBeDefined();
      // ...and that click, on the performance clock, is the note's graded time.
      expect(click.time).toBeCloseTo(note.time, 9);
      expect(click.time).toBeCloseTo(PERF_AT_ZERO + click.audioTime * 1000 + OUTPUT_LATENCY_MS, 6);
      expect(play.map((p) => p.pad)).toContain(note.pad);
    });
    // The fake AudioContext saw start(when) at exactly those times, and nothing during the count-in.
    const starts = new Set(r.fake.starts.map((s) => s.when));
    const clickTimes = new Set(r.clicks.map((c) => c.audioTime));
    for (const p of r.played) expect(starts.has(p.when)).toBe(true);
    for (const when of starts) expect(clickTimes.has(when)).toBe(true);
    const countIn = r.clicks.filter((c) => c.isCountIn).map((c) => c.audioTime);
    for (const when of countIn) expect(r.played.some((p) => p.when === when)).toBe(false);
    expect(r.played.every((p) => p.velocity === LESSON_NOTE_VELOCITY)).toBe(true);
  });

  it('notes are booked ahead, inside the metronome lookahead, never late', async () => {
    const lesson = STARTER_LESSONS[0]!;
    const r = await rig({ bpm: 100, subdivision: 'quarter' });
    const booked: { when: number; at: number }[] = [];
    const sounds = new LessonSounds(lesson, (_pad, _v, when) => booked.push({ when, at: r.fake.ctx.currentTime }));
    r.metronome.onClick((c) => sounds.onClick(c));
    await r.metronome.start();
    r.advance(6);
    expect(booked.length).toBeGreaterThan(0);
    for (const b of booked) {
      expect(b.when).toBeGreaterThanOrEqual(b.at);
      expect(b.when - b.at).toBeLessThanOrEqual(LOOKAHEAD_S + 0.03);
    }
  });

  it('accented notes play at 127', async () => {
    const fill = FILL_LESSONS[0]!; // lands on an accented crash
    const r = await rig({ bpm: 120, subdivision: 'eighth' });
    const sounds = new LessonSounds(fill, r.play);
    r.metronome.onClick((c) => sounds.onClick(c));
    await r.metronome.start();
    r.advance(8);
    expect(r.played.find((p) => p.pad === 'crash')?.velocity).toBe(127);
  });

  it('listen, then play: full drums on the app’s turns, silence on the player’s, the guide quietly when on', async () => {
    const toms = FILL_LESSONS.find((l) => l.id === 'fill-around-toms')!;
    const section = sectionLesson(toms);
    const plan = turnPlan(section.bars, true);
    let guide = false;
    const r = await rig({ bpm: 120, subdivision: 'sixteenth' });
    const sounds = new LessonSounds(section, r.play, { passes: Infinity, gainForPass: drumGainForPass(plan, () => guide) });
    r.metronome.onClick((c) => sounds.onClick(c));
    await r.metronome.start();
    // Count-in (2 s) + listen turn (4 s) + player turn (4 s), then turn the guide on for the next cycle.
    r.advance(2 + 8);
    const passOf = (when: number) => {
      const click = r.clicks.find((c) => c.audioTime === when)!;
      return Math.floor(click.bar / section.bars);
    };
    expect(new Set(r.played.map((p) => passOf(p.when)))).toEqual(new Set([0]));
    expect(r.played).toHaveLength(section.notes.length);
    guide = true;
    r.advance(8);
    const second = r.played.filter((p) => passOf(p.when) === 3);
    expect(second.length).toBe(section.notes.length);
    expect(second.every((p) => p.gain < 0.5)).toBe(true);
    expect(r.played.filter((p) => passOf(p.when) === 2).every((p) => p.gain === 1)).toBe(true);
  });
});
