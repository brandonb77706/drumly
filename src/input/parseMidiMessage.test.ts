import { describe, expect, it } from 'vitest';
import { parseMidiMessage } from './parseMidiMessage';

const T = 1234.5;

describe('parseMidiMessage', () => {
  it('parses a note-on into a hit using the given timestamp', () => {
    expect(parseMidiMessage([0x99, 38, 100], T)).toEqual({ pad: 'snare', velocity: 100, time: T, source: 'midi' });
  });

  it('accepts note-on on every channel', () => {
    for (let channel = 0; channel < 16; channel++) {
      expect(parseMidiMessage([0x90 | channel, 36, 64], T)?.pad).toBe('kick');
    }
  });

  it('accepts Uint8Array data like MIDIMessageEvent provides', () => {
    expect(parseMidiMessage(new Uint8Array([0x99, 42, 80]), T)?.pad).toBe('hihatClosed');
  });

  it('ignores note-on with velocity 0 (running-status note-off)', () => {
    expect(parseMidiMessage([0x99, 38, 0], T)).toBeNull();
  });

  it('ignores note-off messages', () => {
    expect(parseMidiMessage([0x89, 38, 64], T)).toBeNull();
    expect(parseMidiMessage([0x80, 38, 0], T)).toBeNull();
  });

  it('ignores control change messages (e.g. hi-hat pedal position CC4)', () => {
    expect(parseMidiMessage([0xb9, 4, 90], T)).toBeNull();
    expect(parseMidiMessage([0xb0, 38, 100], T)).toBeNull();
  });

  it('ignores polyphonic aftertouch (cymbal choke)', () => {
    expect(parseMidiMessage([0xa9, 49, 127], T)).toBeNull();
  });

  it('ignores unmapped notes', () => {
    expect(parseMidiMessage([0x99, 60, 100], T)).toBeNull();
    expect(parseMidiMessage([0x99, 0, 100], T)).toBeNull();
  });

  it('maps General MIDI notes', () => {
    const cases: [number, string][] = [
      [35, 'kick'], [36, 'kick'], [38, 'snare'], [42, 'hihatClosed'], [46, 'hihatOpen'],
      [44, 'hihatPedal'], [48, 'tom1'], [45, 'tom2'], [43, 'tom3'], [49, 'crash'],
      [51, 'ride'], [53, 'rideBell'],
    ];
    for (const [note, pad] of cases) expect(parseMidiMessage([0x99, note, 100], T)?.pad).toBe(pad);
  });

  it('maps Roland V-Drums zone notes', () => {
    const cases: [number, string][] = [
      [22, 'hihatClosed'], // closed hi-hat edge
      [26, 'hihatOpen'], // open hi-hat edge
      [40, 'snareRim'],
      [37, 'crossStick'],
      [50, 'tom1'], // tom 1 rim
      [47, 'tom2'], // tom 2 rim
      [58, 'tom3'], // tom 3 rim
      [55, 'crash'], // crash 1 edge
      [59, 'ride'], // ride edge
    ];
    for (const [note, pad] of cases) expect(parseMidiMessage([0x99, note, 100], T)?.pad).toBe(pad);
  });

  it('ignores short or empty messages', () => {
    expect(parseMidiMessage([], T)).toBeNull();
    expect(parseMidiMessage([0x99], T)).toBeNull();
    expect(parseMidiMessage([0x99, 38], T)).toBeNull();
    expect(parseMidiMessage(null, T)).toBeNull();
  });

  it('ignores system messages such as clock and active sensing', () => {
    expect(parseMidiMessage([0xf8, 0, 0], T)).toBeNull();
    expect(parseMidiMessage([0xfe, 0, 0], T)).toBeNull();
  });
});
